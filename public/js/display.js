// Display page: receives the Pro Micro key presses, forwards them to the server,
// and draws the split-screen race from the server's state.

import { connect } from './link.js';
import { text, put, seconds, scoreFor } from './strings.js';
import { loadAssets } from './assets.js';
import { Scene } from './scene.js';
import { sounds, unlockAudio } from './audio.js';

const $ = (sel, root = document) => root.querySelector(sel);
const stage = $('#stage');
const canvas = $('#scene');

let config = null;
let assetFiles = null;
let assets = null;
let scene = null;
let loadingAssets = false;
let state = null;
let leaderboard = [];
let clients = [];
let lastLeaderboardJson = '';
let freshRaceId = null;
let scrollToFresh = false; // see revealFreshRow()
let lastCountdownNum = null;
let factIndex = 0;
let linkOpen = false;
let fps = 0;

// ------------------------------------------------------------------ build the two halves

const halves = {};
for (const id of [1, 2]) {
  const sec = $(`#half${id}`);
  sec.append($('#halfTemplate').content.cloneNode(true));
  const h = {
    sec,
    inner: $('.half-inner', sec),
    tag: $('.tag', sec),
    name: $('.name', sec),
    alert: $('.alert', sec),
    vMain: $('.v-main', sec),
    vScore: $('.v-score', sec),
    vDetail: $('.v-detail', sec),
    idleStatus: $('.idle-status', sec),
    pad: $('.pad', sec),
    ref: $('.ref', sec),
    status: $('.status', sec),
    score: $('.score', sec),
    scoreNum: $('.score-num', sec),
    fuel: $('.fuel', sec),
    fill: $('.fill', sec),
    fuelSec: $('.fuel-sec', sec),
    shieldRow: $('.shield-row', sec),
    hits: $('.hits', sec),
    shieldKey: '',
    lastSec: '',
    lastScore: '',
  };
  put(h.tag, 'player', { n: id });
  put($('.fuel-label', sec), 'fuel');
  put($('.score-label', sec), 'score');
  put(h.alert, 'collisionAlert');
  halves[id] = h;
}

put($('.lb-title'), 'leaderboard');
put($('#leaderboard .c-name'), 'colName');
put($('#leaderboard .c-score'), 'colScore');
put($('#leaderboard .c-time'), 'colTime');
put($('#leaderboard .c-shields'), 'colShields');
put($('.lb-empty'), 'leaderboardEmpty');
put($('.waiting'), 'waitingPlayers');
put($('#focusOverlay .big'), 'focusLost');
put($('#serverOverlay p'), 'serverLost');
put($('.fact-label'), 'spaceFact');

// ------------------------------------------------------------------ server link

const link = connect({
  role: 'display',
  onConfig(msg) {
    config = msg.config;
    stage.style.setProperty('--p1', config.colors.p1);
    stage.style.setProperty('--p2', config.colors.p2);
    put($('.lb-rule'), 'scoreRule', { perSecond: config.pointsPerSecond, perShield: config.pointsPerShield });
    if (scene) scene.setColors(config.colors);
    buildTestPad();
    showFact(false);
    maybeLoadAssets();
  },
  onAssets(files) {
    assetFiles = files;
    maybeLoadAssets();
  },
  onState(msg) {
    state = msg.state;
    leaderboard = msg.leaderboard;
    clients = msg.clients;
    if (state.phase === 'result' && state.raceId) freshRaceId = state.raceId;
    if (scene) scene.update(state);
    render();
  },
  onEvent(e) {
    switch (e.kind) {
      case 'hit':
        if (scene) scene.hit(e.player);
        sounds.hit(e.player);
        if (e.shields > 0) sounds.shieldLost(e.player);
        flashAlert(e.player);
        break;
      case 'failed': sounds.failed(e.player); break;
      case 'docked':
        sounds.docked(e.player);
        if (scene) scene.pulse(e.player, '125,255,178');
        break;
      case 'go': sounds.go(); break;
      case 'falseStart': sounds.falseStart(); break;
      case 'undo':
        sounds.undo(e.player);
        if (scene) scene.pulse(e.player, '125,255,178');
        break;
      default:
    }
  },
  onStatus(s) {
    linkOpen = s === 'open';
    if (linkOpen) $('#serverOverlay').hidden = true;
    else setTimeout(() => { if (!linkOpen) $('#serverOverlay').hidden = false; }, 1500);
  },
});

async function maybeLoadAssets() {
  if (!config || !assetFiles || loadingAssets) return;
  loadingAssets = true;
  try {
    assets = await loadAssets(assetFiles, config.colors);
  } finally {
    loadingAssets = false;
  }
  if (scene) scene.setAssets(assets);
  else {
    scene = new Scene(canvas, assets, config.colors);
    scene.clock = () => link.serverNow(); // the black hole grows with the race clock
    resize();
  }
  if (state) scene.update(state);
  if (assets.logo) { $('#logo').src = assets.logo; $('#logo').hidden = false; }
  for (const id of [1, 2]) halves[id].shieldKey = '';
  render();
}

// ------------------------------------------------------------------ keyboard (the Pro Micro is a keyboard)

window.addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.repeat) return; // a held key must not count twice
  const code = e.code;  // physical key, so the keyboard layout (e.g. Arabic) does not matter
  if (code === 'F2') { e.preventDefault(); toggleDebug(); return; }
  if (code === 'KeyF') { toggleFullscreen(); return; }
  if (code === 'Enter' || code === 'NumpadEnter') { e.preventDefault(); link.send({ t: 'fallback', action: 'bothReady' }); return; }
  if (code === 'Backspace') { e.preventDefault(); link.send({ t: 'fallback', action: 'reset' }); return; }
  if (!code) return;
  e.preventDefault();
  link.send({ t: 'key', code });
}, { capture: true });

window.addEventListener('pointerdown', unlockAudio);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

// Test buttons in the F2 panel: they send exactly what the Pro Micro would send.
const TEST_ACTIONS = [['hit', 'Hit'], ['dock', 'Dock'], ['padOn', 'On pad'], ['padOff', 'Off pad']];
function buildTestPad() {
  if (!config) return;
  for (const id of [1, 2]) {
    const row = $(`.test-row[data-player="${id}"]`);
    row.replaceChildren();
    const label = document.createElement('b');
    label.textContent = `P${id}`;
    row.append(label);
    for (const [action, name] of TEST_ACTIONS) {
      const code = config.keys[`p${id}`][action];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action;
      btn.dataset.code = code;
      const kbd = document.createElement('kbd');
      kbd.textContent = code.replace(/^Key/, '');
      btn.append(name, kbd);
      btn.addEventListener('click', () => {
        unlockAudio();
        link.send({ t: 'key', code });
        btn.blur(); // keep Enter/Backspace for the game, not this button
      });
      row.append(btn);
    }
  }
}

function toggleDebug() {
  const d = $('#debug');
  d.hidden = !d.hidden;
  if (!d.hidden) renderDebug();
}

// ------------------------------------------------------------------ focus warning

const focusOverlay = $('#focusOverlay');
function checkFocus() {
  focusOverlay.hidden = document.hasFocus();
}
window.addEventListener('blur', checkFocus);
window.addEventListener('focus', checkFocus);
document.addEventListener('visibilitychange', checkFocus);
setInterval(checkFocus, 400);
focusOverlay.addEventListener('click', () => { window.focus(); unlockAudio(); checkFocus(); });
checkFocus();

// ------------------------------------------------------------------ rendering the HUD from state

function statusFor(p) {
  switch (p.status) {
    case 'ready': return { key: 'statusReady', tone: 'good' };
    case 'racing': return { key: 'statusRacing' };
    case 'docked': return { key: 'statusDocked', vars: { time: seconds(p.timeMs) }, tone: 'good' };
    case 'shieldsDown': return { key: 'statusShieldsDown', tone: 'bad' };
    case 'outOfFuel': return { key: 'statusOutOfFuel', tone: 'bad' };
    case 'sittingOut': return { key: 'statusSittingOut' };
    default: return { key: 'statusWaiting' };
  }
}

function setText(el, value, tone) {
  if (el.textContent !== value) el.textContent = value;
  if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
}

function render() {
  if (!state) return;
  stage.dataset.phase = state.phase;
  const refs = new Set(clients.filter((c) => c.role === 'ref').map((c) => c.player));
  const lobby = state.phase === 'idle' || state.phase === 'arming';

  for (const id of [1, 2]) {
    const h = halves[id];
    const p = state.players[id];
    setText(h.name, p.name || text('player', { n: id }));

    h.sec.classList.toggle('sitting-out', p.status === 'sittingOut');
    const st = statusFor(p);
    setText(h.status, text(st.key, st.vars), st.tone);
    if (lobby) setText(h.idleStatus, text(p.ready ? 'statusReady' : 'statusWaiting'), p.ready ? 'good' : '');
    else if (p.status === 'sittingOut') setText(h.idleStatus, text('statusSittingOut'));
    setText(h.pad, text(p.onPad ? 'loopOnPad' : 'loopOffPad'));
    h.pad.classList.toggle('on', p.onPad);
    setText(h.ref, text(refs.has(id) ? 'refOnline' : 'refOffline'));
    h.ref.classList.toggle('on', refs.has(id));

    // shields
    const shieldKey = `${p.shields}/${p.maxShields}/${assets ? 1 : 0}`;
    if (h.shieldKey !== shieldKey && assets) {
      h.shieldKey = shieldKey;
      h.shieldRow.replaceChildren();
      for (let i = 0; i < p.maxShields; i++) {
        const img = document.createElement('img');
        const intact = i < p.shields;
        img.src = intact ? assets.shieldFull : assets.shieldBroken;
        img.alt = '';
        if (!intact) img.className = 'lost';
        h.shieldRow.append(img);
      }
      h.shieldRow.setAttribute('aria-label', `${text('shields')} ${p.shields} / ${p.maxShields}`);
    }

    // hits
    if (h.hits.dataset.sig !== String(p.hits)) {
      h.hits.dataset.sig = String(p.hits);
      const b = document.createElement('b');
      b.textContent = p.hits;
      h.hits.replaceChildren(b, ` ${text('hits')}`);
    }

    // result verdict
    const res = state.phase === 'result' ? state.result : null;
    const isWinner = Boolean(res && res.winner === id);
    h.sec.classList.toggle('winner', isWinner);
    h.sec.classList.toggle('loser', Boolean(res && p.active && !isWinner));
    if (res && p.active) renderVerdict(h, p, res, isWinner);
  }

  // notice (false start)
  const notice = $('#notice');
  if (state.notice && state.notice.kind === 'falseStart') {
    setText($('.msg', notice), text('falseStart', { name: state.notice.name }));
    setText($('.help', notice), text('falseStartHelp'));
    notice.classList.add('show');
  } else notice.classList.remove('show');

  renderLeaderboard();
  if (lobby) revealFreshRow();
  if (!$('#debug').hidden) renderDebug();
}

function renderVerdict(h, p, res, isWinner) {
  let main;
  if (res.outcome === 'tie') main = 'tie';
  else if (res.outcome === 'soloDocked') main = 'missionComplete';
  else if (res.outcome === 'soloFailed') main = 'missionFailed';
  else if (isWinner) main = { docked: 'winnerScore', score: 'winnerScore', lasted: 'lastedLonger', shields: 'moreShields' }[res.outcome];
  else main = statusFor(p).key;
  const st = statusFor(p);
  setText(h.vMain, text(main, st.vars));
  setText(h.vScore, p.status === 'docked' ? text('points', { points: p.score }) : '');
  const detail = main === st.key ? '' : text(st.key, st.vars);
  setText(h.vDetail, `${detail}${p.manualFinish ? ` (${text('manualFinishTag')})` : ''}`);
}

function renderLeaderboard() {
  const json = JSON.stringify(leaderboard) + freshRaceId;
  if (json === lastLeaderboardJson) return;
  lastLeaderboardJson = json;
  const tbody = $('#leaderboard tbody');
  tbody.replaceChildren();
  leaderboard.forEach((e, i) => {
    const tr = document.createElement('tr');
    tr.dataset.player = e.player;
    if (i === 0) tr.classList.add('first');
    if (e.raceId === freshRaceId) tr.classList.add('fresh');
    const cells = [String(i + 1), null, String(e.score ?? ''), `${seconds(e.timeMs)} s`, String(e.shieldsLeft)];
    cells.forEach((value, ci) => {
      const td = document.createElement('td');
      td.className = ['rank', 'c-name', 'c-score', 'c-time', 'c-shields'][ci];
      if (ci === 1) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.textContent = '●';
        td.append(dot, document.createTextNode(e.name));
        td.title = e.name;
      } else td.textContent = value;
      tr.append(td);
    });
    tbody.append(tr);
  });
  $('.lb-scroll').style.display = leaderboard.length ? '' : 'none';
  $('.lb-empty').style.display = leaderboard.length ? 'none' : '';
  scrollToFresh = true;
}

/**
 * A run that just made the list may be below the fold: scroll the list to it once
 * the lobby is on screen (it is hidden while the result shows). Only the list box
 * scrolls; scrollIntoView could also shift the whole stage.
 */
function revealFreshRow() {
  const box = $('.lb-scroll');
  if (!scrollToFresh || !box.clientHeight) return;
  scrollToFresh = false;
  const fresh = box.querySelector('tr.fresh');
  if (!fresh) return;
  const head = $('#leaderboard thead').offsetHeight;
  if (fresh.offsetTop + fresh.offsetHeight > box.scrollTop + box.clientHeight) {
    box.scrollTop = fresh.offsetTop + fresh.offsetHeight - box.clientHeight;
  } else if (fresh.offsetTop - head < box.scrollTop) {
    box.scrollTop = fresh.offsetTop - head;
  }
}

function showFact(animate) {
  if (!config || !config.facts.length) { $('#fact').style.display = 'none'; return; }
  $('#fact').style.display = '';
  const f = config.facts[factIndex % config.facts.length];
  $('#fact .fact-text').textContent = f.text;
  $('#fact .fact-source').textContent = f.source ? text('source', { name: f.source }) : '';
  if (animate) {
    const el = $('#fact');
    el.classList.remove('swap');
    void el.offsetWidth;
    el.classList.add('swap');
  }
}
setInterval(() => {
  if (!state || (state.phase !== 'idle' && state.phase !== 'arming')) return;
  factIndex += 1;
  showFact(true);
}, 12000);

function flashAlert(id) {
  const el = halves[id].alert;
  el.classList.remove('on');
  void el.offsetWidth; // restart the animation
  el.classList.add('on');
}

// ------------------------------------------------------------------ per-frame: fuel, live score, countdown, shake

function fuelLeftMs(p) {
  if (!state || !config) return 0;
  const full = state.fuelMs || config.fuelSeconds * 1000;
  if (state.goAt == null || state.phase === 'countdown' || state.phase === 'idle' || state.phase === 'arming') return full;
  if (p.doneAt != null) return Math.max(0, full - p.lastedMs);
  return Math.max(0, full - (link.serverNow() - state.goAt));
}

function tickHud() {
  if (!state) return;
  const now = link.serverNow();
  for (const id of [1, 2]) {
    const h = halves[id];
    const p = state.players[id];
    const full = state.fuelMs || (config ? config.fuelSeconds * 1000 : 60000);
    const left = fuelLeftMs(p);
    h.fill.style.transform = `scaleX(${(left / full).toFixed(4)})`;
    const sec = seconds(left);
    if (sec !== h.lastSec) { h.lastSec = sec; h.fuelSec.textContent = `${sec} s`; }
    h.fuel.classList.toggle('low', left < 10000 && p.status === 'racing');

    // Score: while racing it shows what docking right now would score, so it
    // counts down with the fuel. Once docked it is final; a failed run scores 0.
    let score;
    if (p.status === 'docked') score = p.score;
    else if (p.status === 'shieldsDown' || p.status === 'outOfFuel') score = 0;
    else score = scoreFor(left, p.shields, state.scoring);
    const scoreText = String(score);
    if (scoreText !== h.lastScore) { h.lastScore = scoreText; h.scoreNum.textContent = scoreText; }
    h.score.classList.toggle('final', p.status === 'docked');
    h.score.classList.toggle('zero', p.status === 'shieldsDown' || p.status === 'outOfFuel');

    if (scene) {
      const off = scene.shakeOffset(id);
      const k = stage.clientWidth / (canvas.width || 1);
      h.inner.style.transform = off.x || off.y ? `translate(${off.x * k}px, ${off.y * k}px)` : '';
    }
  }

  // countdown 3-2-1-GO
  const cd = $('#countdown');
  const num = $('.num', cd);
  if (state.phase === 'countdown' && state.goAt != null) {
    const n = Math.max(1, Math.ceil((state.goAt - now) / 1000));
    if (n !== lastCountdownNum) {
      lastCountdownNum = n;
      num.textContent = String(n);
      put($('.sub', cd), 'getReady');
      restart(num, 'tick');
      sounds.countdownBeep();
    }
    cd.classList.add('show');
    cd.classList.remove('go');
  } else if (state.phase === 'racing' && state.goAt != null && now - state.goAt < 900) {
    if (lastCountdownNum !== 'go') {
      lastCountdownNum = 'go';
      put(num, 'go');
      $('.sub', cd).textContent = '';
      restart(num, 'tick');
    }
    cd.classList.add('show', 'go');
  } else {
    lastCountdownNum = null;
    cd.classList.remove('show', 'go');
  }
}

function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

let lastFrame = performance.now();
let frames = 0;
let fpsAt = performance.now();
function loop(ts) {
  const dt = ts - lastFrame;
  lastFrame = ts;
  if (scene) scene.frame(dt);
  tickHud();
  frames += 1;
  if (ts - fpsAt >= 1000) {
    fps = Math.round((frames * 1000) / (ts - fpsAt));
    frames = 0;
    fpsAt = ts;
    if (!$('#debug').hidden) renderDebug();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function resize() {
  if (scene) scene.resize(stage.clientWidth, stage.clientHeight);
}
new ResizeObserver(resize).observe(stage);

// ------------------------------------------------------------------ debug panel (F2)

function renderDebug() {
  if (!state) return;
  const now = link.serverNow();
  const lines = [];
  lines.push(`phase ${state.phase}   mode ${state.mode}${state.soloPlayer ? ` (P${state.soloPlayer})` : ''}   race ${state.raceId || '-'}`);
  lines.push(`fps ${fps}   window focused ${document.hasFocus() ? 'yes' : 'NO'}   server link ${linkOpen ? 'open' : 'DOWN'}`);
  if (state.goAt != null) lines.push(`race clock ${seconds(now - state.goAt, 2)} s`);
  lines.push('');
  for (const id of [1, 2]) {
    const p = state.players[id];
    lines.push(`P${id} ${p.displayName}: ${p.status}  shields ${p.shields}/${p.maxShields}  hits ${p.hits}  ignored ${p.ignoredHits}  cooldown ${p.inCooldown ? 'yes' : 'no'}  on pad ${p.onPad ? 'yes' : 'no'}${p.timeMs != null ? `  time ${seconds(p.timeMs, 2)} s  score ${p.score}` : ''}`);
  }
  lines.push('');
  lines.push('Connected:');
  for (const c of clients) lines.push(`  ${c.role}${c.player ? ` ${c.player}` : ''}  ${c.ip}`);
  if (!clients.some((c) => c.role === 'ref')) lines.push('  (no referee phones)');
  lines.push('');
  lines.push('Last keys received (newest first):');
  for (const k of state.keyLog || []) lines.push(`  ${k.code.padEnd(10)} ${seconds(now - k.at, 1).padStart(6)} s ago  ${k.effect}`);
  $('#debugText').textContent = lines.join('\n');
}
