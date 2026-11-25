const EventEmitter = require('events');
const { performance } = require('perf_hooks');
const { scoreFor } = require('./scoring');

/**
 * The race state machine. The server owns the state and the clock, so a page
 * refresh never loses a race.
 *
 *   idle -> arming -> countdown -> racing -> result -> idle
 *
 * Times are milliseconds from a monotonic clock (performance.now), never Date.now.
 * Emits 'change' after every state change and 'event' for one-off moments
 * (hit, docked, failed, go, falseStart, undo, reset) that drive sounds and effects.
 */
const PLAYER_IDS = [1, 2];
const MAX_NAME = 24;
const MAX_KEY_LOG = 16;
const MAX_MANUAL_HOLD_MS = 5000;

class Game extends EventEmitter {
  /**
   * @param {object} opts
   * @param {() => object} opts.getConfig current settings (see defaults.js)
   * @param {import('./store').Store} opts.store
   * @param {() => number} [opts.now] monotonic clock in ms
   */
  constructor({ getConfig, store, now = () => performance.now() }) {
    super();
    this.getConfig = getConfig;
    this.store = store;
    this.now = now;
    this.keyLog = [];
    this.raceCounter = 0;
    this.state = {
      phase: 'idle',
      mode: 'duel',
      soloPlayer: null,
      raceId: null,
      countdownStartAt: null,
      goAt: null,
      fuelMs: 0,
      cooldownMs: 0,
      scoring: { perSecond: 0, perShield: 0 },
      resultUntil: null,
      notice: null,
      result: null,
      players: {},
    };
    for (const id of PLAYER_IDS) this.state.players[id] = this.freshPlayer(id, '');
  }

  // ---------------------------------------------------------------- helpers

  freshPlayer(id, name) {
    const cfg = this.getConfig();
    return {
      id,
      name,
      ready: false,
      onPad: false,
      active: false,
      status: 'waiting', // waiting | ready | racing | docked | shieldsDown | outOfFuel | sittingOut
      shields: cfg.shields,
      maxShields: cfg.shields,
      hits: 0,
      ignoredHits: 0,
      hitTimesMs: [],
      cooldownUntil: 0,
      finishAt: null,
      doneAt: null,
      manualFinish: false,
      nameSetAt: null,
    };
  }

  player(id) {
    return this.state.players[Number(id)] || null;
  }

  displayName(p) {
    return p.name || `Player ${p.id}`;
  }

  /** Points for a docked run; 0 for anything else. */
  scoreOf(p) {
    const s = this.state;
    if (p.status !== 'docked' || p.finishAt == null) return 0;
    return scoreFor(s.fuelMs - (p.finishAt - s.goAt), p.shields, s.scoring);
  }

  activePlayers() {
    return PLAYER_IDS.map((id) => this.state.players[id]).filter((p) => p.active);
  }

  changed() {
    this.emit('change');
  }

  event(kind, player, extra = {}) {
    this.emit('event', { kind, player: player || null, ...extra });
  }

  /** Move time-driven transitions forward: GO, fuel running out, result screen ending. */
  advance() {
    const now = this.now();
    const s = this.state;
    let changed = false;

    if (s.phase === 'countdown' && now >= s.goAt) {
      s.phase = 'racing';
      for (const p of this.activePlayers()) p.status = 'racing';
      this.event('go');
      changed = true;
    }

    if (s.phase === 'racing') {
      const fuelEnd = s.goAt + s.fuelMs;
      if (now >= fuelEnd) {
        for (const p of this.activePlayers()) {
          if (p.status !== 'racing') continue;
          p.status = 'outOfFuel';
          p.doneAt = fuelEnd;
          this.event('failed', p.id, { reason: 'outOfFuel' });
          changed = true;
        }
      }
      if (this.checkEnd()) changed = true;
    }

    if (s.phase === 'result' && now >= s.resultUntil) {
      this.toIdle({ clearNames: true });
      changed = true;
    }

    if (s.notice && now >= s.notice.until) {
      s.notice = null;
      changed = true;
    }

    if (changed) this.changed();
    return changed;
  }

  logKey(code, effect) {
    this.keyLog.unshift({ code, effect, at: this.now() });
    if (this.keyLog.length > MAX_KEY_LOG) this.keyLog.length = MAX_KEY_LOG;
  }

  mapKey(code) {
    const keys = this.getConfig().keys;
    for (const id of PLAYER_IDS) {
      const map = keys[`p${id}`];
      for (const action of Object.keys(map)) if (map[action] === code) return { id, action };
    }
    return null;
  }

  // ---------------------------------------------------------------- inputs

  /** A key press from the Pro Micro, forwarded by the display page. */
  key(code) {
    this.advance();
    const mapped = this.mapKey(code);
    if (!mapped) {
      this.logKey(code, 'not mapped');
      this.changed();
      return 'not mapped';
    }
    const p = this.player(mapped.id);
    let effect;
    switch (mapped.action) {
      case 'hit': effect = this.hit(p); break;
      case 'dock': effect = this.dock(p); break;
      case 'padOn': p.onPad = true; effect = 'on pad'; break;
      case 'padOff': effect = this.padOff(p); break;
      default: effect = 'ignored';
    }
    this.logKey(code, `P${p.id} ${mapped.action}: ${effect}`);
    this.changed();
    return effect;
  }

  padOff(p) {
    p.onPad = false;
    if (this.state.phase === 'countdown' && p.active) {
      this.falseStart(p);
      return 'false start';
    }
    return 'off pad';
  }

  hit(p) {
    const s = this.state;
    if (s.phase !== 'racing' || !p.active || p.status !== 'racing') return 'ignored (not racing)';
    const now = this.now();
    if (now < p.cooldownUntil) {
      p.ignoredHits += 1;
      return 'ignored (cooldown)';
    }
    p.shields = Math.max(0, p.shields - 1);
    p.hits += 1;
    p.hitTimesMs.push(Math.round(now - s.goAt));
    p.cooldownUntil = now + s.cooldownMs;
    this.event('hit', p.id, { shields: p.shields });
    if (p.shields === 0) {
      p.status = 'shieldsDown';
      p.doneAt = now;
      this.event('failed', p.id, { reason: 'shieldsDown' });
      this.checkEnd();
      return 'shields down';
    }
    return 'shield lost';
  }

  dock(p) {
    if (this.state.phase !== 'racing' || !p.active || p.status !== 'racing' || p.shields <= 0) return 'ignored';
    this.finish(p, this.now(), false);
    return 'docked';
  }

  finish(p, at, manual) {
    p.status = 'docked';
    p.finishAt = at;
    p.doneAt = at;
    p.manualFinish = manual;
    p.cooldownUntil = 0;
    this.event('docked', p.id, { timeMs: Math.round(at - this.state.goAt), manual });
    this.checkEnd();
  }

  /** Ends the race when every active player is done. Returns true if it ended. */
  checkEnd() {
    const s = this.state;
    if (s.phase !== 'racing') return false;
    const active = this.activePlayers();
    if (active.length === 0 || active.some((p) => p.status === 'racing')) return false;
    s.phase = 'result';
    s.resultStartAt = this.now();
    s.resultUntil = s.resultStartAt + this.getConfig().resultSeconds * 1000;
    s.result = this.computeResult();
    this.store.saveRace(this.raceRecord());
    this.event('result', s.result.winner, { outcome: s.result.outcome });
    return true;
  }

  computeResult() {
    const s = this.state;
    const active = this.activePlayers();
    if (s.mode === 'solo') {
      const p = active[0];
      return { outcome: p.status === 'docked' ? 'soloDocked' : 'soloFailed', winner: p.status === 'docked' ? p.id : null };
    }
    // Both docked: the higher score wins (time left plus shields), then the earlier dock.
    const docked = active.filter((p) => p.status === 'docked')
      .sort((a, b) => this.scoreOf(b) - this.scoreOf(a) || a.finishAt - b.finishAt);
    if (docked.length === 2) {
      const [x, y] = docked;
      if (this.scoreOf(x) === this.scoreOf(y) && x.finishAt === y.finishAt) return { outcome: 'tie', winner: null };
      return { outcome: 'score', winner: x.id };
    }
    if (docked.length === 1) return { outcome: 'docked', winner: docked[0].id };
    const [a, b] = active;
    const lastedA = a.doneAt - s.goAt;
    const lastedB = b.doneAt - s.goAt;
    if (lastedA !== lastedB) return { outcome: 'lasted', winner: lastedA > lastedB ? a.id : b.id };
    if (a.shields !== b.shields) return { outcome: 'shields', winner: a.shields > b.shields ? a.id : b.id };
    return { outcome: 'tie', winner: null };
  }

  raceRecord() {
    const s = this.state;
    const winner = s.result && s.result.winner ? this.player(s.result.winner) : null;
    return {
      id: s.raceId,
      date: new Date().toISOString(), // wall-clock label only; race times use the monotonic clock
      mode: s.mode,
      outcome: s.result ? s.result.outcome : null,
      winner: winner ? winner.id : null,
      winnerName: winner ? this.displayName(winner) : null,
      players: this.activePlayers().map((p) => ({
        player: p.id,
        name: this.displayName(p),
        result: p.status,
        timeMs: p.status === 'docked' ? Math.round(p.finishAt - s.goAt) : null,
        lastedMs: p.doneAt == null ? null : Math.round(p.doneAt - s.goAt),
        shieldsLeft: p.shields,
        score: this.scoreOf(p),
        hits: p.hits,
        hitTimesMs: [...p.hitTimesMs],
        manualFinish: p.manualFinish,
      })),
      fuelMs: s.fuelMs,
      scoring: { ...s.scoring },
    };
  }

  // ---------------------------------------------------------------- referee and laptop actions

  setName(id, name) {
    const p = this.player(id);
    if (!p) return;
    p.name = String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME);
    p.nameSetAt = this.now();
    this.changed();
  }

  /** Leaves the result screen early so the next round can be set up. */
  leaveResultIfShowing() {
    if (this.state.phase === 'result') this.toIdle({ clearNames: false });
  }

  setReady(id, ready) {
    this.advance();
    const p = this.player(id);
    const s = this.state;
    if (!p || !['idle', 'arming', 'result'].includes(s.phase)) return false;
    this.leaveResultIfShowing();
    p.ready = Boolean(ready);
    p.status = p.ready ? 'ready' : 'waiting';
    s.phase = PLAYER_IDS.some((i) => s.players[i].ready) ? 'arming' : 'idle';
    if (PLAYER_IDS.every((i) => s.players[i].ready)) this.startCountdown('duel', null);
    this.changed();
    return true;
  }

  /** Laptop Enter key: both players ready, start the countdown. */
  bothReady() {
    this.advance();
    if (!['idle', 'arming', 'result'].includes(this.state.phase)) return false;
    this.leaveResultIfShowing();
    for (const id of PLAYER_IDS) this.state.players[id].ready = true;
    this.startCountdown('duel', null);
    this.changed();
    return true;
  }

  /** Solo race for one player. Like every race, the player must be Ready first. */
  startSolo(id) {
    this.advance();
    const p = this.player(id);
    if (!p || this.state.phase !== 'arming' || !p.ready) return false;
    this.startCountdown('solo', p.id);
    this.changed();
    return true;
  }

  startCountdown(mode, soloPlayer) {
    const cfg = this.getConfig();
    const s = this.state;
    const now = this.now();
    this.raceCounter += 1;
    s.mode = mode;
    s.soloPlayer = soloPlayer;
    s.raceId = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${this.raceCounter}`;
    s.fuelMs = cfg.fuelSeconds * 1000;
    s.cooldownMs = cfg.hitCooldownMs;
    s.scoring = { perSecond: cfg.pointsPerSecond, perShield: cfg.pointsPerShield };
    s.countdownStartAt = now;
    s.goAt = now + cfg.countdownSeconds * 1000;
    s.result = null;
    s.resultUntil = null;
    s.notice = null;
    s.phase = 'countdown';
    for (const id of PLAYER_IDS) {
      const old = s.players[id];
      const p = this.freshPlayer(id, old.name);
      p.nameSetAt = old.nameSetAt;
      p.onPad = old.onPad;
      p.active = mode === 'duel' || id === soloPlayer;
      p.ready = p.active;
      p.status = p.active ? 'ready' : 'sittingOut';
      s.players[id] = p;
    }
    this.event('countdown');
  }

  falseStart(p) {
    const s = this.state;
    const cfg = this.getConfig();
    s.phase = 'arming';
    s.notice = { kind: 'falseStart', player: p.id, name: this.displayName(p), until: this.now() + cfg.falseStartSeconds * 1000 };
    for (const id of PLAYER_IDS) {
      const q = s.players[id];
      q.ready = false;
      q.active = false;
      q.status = 'waiting';
    }
    s.mode = 'duel';
    s.soloPlayer = null;
    s.goAt = null;
    this.event('falseStart', p.id, { name: this.displayName(p) });
  }

  /** Give back one shield (a false hit). Works while racing and on the result screen. */
  undoHit(id) {
    this.advance();
    const s = this.state;
    const p = this.player(id);
    if (!p || !p.active || !['racing', 'result'].includes(s.phase)) return false;
    if (p.shields >= p.maxShields) return false;
    p.shields += 1;
    p.hits = Math.max(0, p.hits - 1);
    p.hitTimesMs.pop();
    p.cooldownUntil = 0;
    if (p.status === 'shieldsDown' && this.now() < s.goAt + s.fuelMs) {
      // The hit that knocked them out was false, and they still have fuel: back into the race.
      p.status = 'racing';
      p.doneAt = null;
      if (s.phase === 'result') {
        this.store.removeRace(s.raceId);
        s.phase = 'racing';
        s.result = null;
        s.resultUntil = null;
      }
    }
    if (s.phase === 'result') {
      s.result = this.computeResult();
      this.store.saveRace(this.raceRecord());
    }
    this.event('undo', p.id, { shields: p.shields });
    this.changed();
    return true;
  }

  /**
   * Referee says the loop docked but the docking pad did not register.
   * The finish time is when the referee started pressing (now - heldMs).
   */
  manualFinish(id, heldMs) {
    this.advance();
    const s = this.state;
    const p = this.player(id);
    if (!p || !p.active || !['racing', 'result'].includes(s.phase)) return false;
    const held = Math.min(MAX_MANUAL_HOLD_MS, Math.max(0, Number(heldMs) || 0));
    const at = Math.max(s.goAt, this.now() - held);
    const canFinish = p.status === 'racing' || ((p.status === 'outOfFuel' || p.status === 'shieldsDown') && at < p.doneAt);
    if (!canFinish) return false;
    if (p.status === 'shieldsDown') {
      // The finish came before the last hit, so that hit happened after docking: undo it.
      p.shields = Math.min(p.maxShields, p.shields + 1);
      p.hits = Math.max(0, p.hits - 1);
      p.hitTimesMs.pop();
    }
    if (s.phase === 'racing') {
      this.finish(p, at, true);
    } else {
      p.status = 'docked';
      p.finishAt = at;
      p.doneAt = at;
      p.manualFinish = true;
      s.result = this.computeResult();
      this.store.saveRace(this.raceRecord());
      this.event('docked', p.id, { timeMs: Math.round(at - s.goAt), manual: true });
    }
    this.changed();
    return true;
  }

  /** Referee hold-to-reset or laptop Backspace. Nothing from an unfinished race is saved. */
  reset() {
    const wasRacing = ['countdown', 'racing'].includes(this.state.phase);
    this.toIdle({ clearNames: false });
    this.event('reset', null, { wasRacing });
    this.changed();
  }

  toIdle({ clearNames }) {
    const s = this.state;
    s.phase = 'idle';
    s.mode = 'duel';
    s.soloPlayer = null;
    s.goAt = null;
    s.countdownStartAt = null;
    s.result = null;
    s.resultUntil = null;
    for (const id of PLAYER_IDS) {
      const old = s.players[id];
      // After a finished race the next players are usually different people, so clear
      // the names, but keep any name a referee typed while the result was showing.
      const typedDuringResult = old.nameSetAt != null && s.resultStartAt != null && old.nameSetAt >= s.resultStartAt;
      const keep = !clearNames || typedDuringResult;
      const p = this.freshPlayer(id, keep ? old.name : '');
      p.nameSetAt = keep ? old.nameSetAt : null;
      p.onPad = old.onPad;
      s.players[id] = p;
    }
    s.resultStartAt = null;
  }

  // ---------------------------------------------------------------- output

  currentScoring() {
    const cfg = this.getConfig();
    return { perSecond: cfg.pointsPerSecond, perShield: cfg.pointsPerShield };
  }

  snapshot() {
    const s = this.state;
    const now = this.now();
    const players = {};
    for (const id of PLAYER_IDS) {
      const p = s.players[id];
      players[id] = {
        ...p,
        displayName: this.displayName(p),
        inCooldown: now < p.cooldownUntil,
        timeMs: p.finishAt == null ? null : Math.round(p.finishAt - s.goAt),
        lastedMs: p.doneAt == null ? null : Math.round(p.doneAt - s.goAt),
        score: this.scoreOf(p),
      };
    }
    return {
      now,
      phase: s.phase,
      mode: s.mode,
      soloPlayer: s.soloPlayer,
      raceId: s.raceId,
      countdownStartAt: s.countdownStartAt,
      goAt: s.goAt,
      fuelMs: s.fuelMs,
      cooldownMs: s.cooldownMs,
      scoring: s.phase === 'idle' || s.phase === 'arming' ? this.currentScoring() : s.scoring,
      resultUntil: s.resultUntil,
      notice: s.notice,
      result: s.result,
      players,
      keyLog: this.keyLog,
    };
  }
}

module.exports = { Game, PLAYER_IDS };
