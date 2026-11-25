// Rule tests for the race state machine, with a fake clock. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game');
const { Store } = require('../server/store');
const { normalize, DEFAULTS } = require('../server/config');

function setup(overrides = {}) {
  let t = 1000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrs-'));
  const file = path.join(dir, 'results.json');
  const store = new Store(file);
  const cfg = normalize({ ...DEFAULTS, ...overrides });
  const game = new Game({ getConfig: () => cfg, store, now: () => t });
  const events = [];
  game.on('event', (e) => events.push(e));
  const clock = {
    get t() { return t; },
    tick(ms) { t += ms; game.advance(); },
  };
  return { game, store, clock, events, file, s: () => game.snapshot() };
}

/** Every race needs Ready first: the referee presses Ready, then Start solo race. */
function solo(g, id) {
  g.game.setReady(id, true);
  assert.equal(g.game.startSolo(id), true);
}

function startDuel(g, clock, names = ['Amal', 'Badr']) {
  g.game.setName(1, names[0]);
  g.game.setName(2, names[1]);
  g.game.setReady(1, true);
  g.game.setReady(2, true);
  assert.equal(g.s().phase, 'countdown');
  clock.tick(3000);
  assert.equal(g.s().phase, 'racing');
}

test('normal race: both ready, countdown, P1 docks first and wins; leaderboard updates', () => {
  const g = setup();
  g.game.setName(1, 'Amal');
  g.game.setReady(1, true);
  assert.equal(g.s().phase, 'arming');
  g.game.setName(2, 'Badr');
  g.game.setReady(2, true);
  const s0 = g.s();
  assert.equal(s0.phase, 'countdown');
  assert.equal(s0.goAt - s0.countdownStartAt, 3000);
  g.clock.tick(2999);
  assert.equal(g.s().phase, 'countdown');
  g.clock.tick(1);
  assert.equal(g.s().phase, 'racing');
  g.clock.tick(20000);
  g.game.key('KeyW');
  assert.equal(g.s().players[1].status, 'docked');
  assert.equal(g.s().players[1].timeMs, 20000);
  g.clock.tick(5000);
  g.game.key('KeyI');
  const s = g.s();
  assert.equal(s.phase, 'result');
  assert.equal(s.result.winner, 1);
  assert.equal(s.result.outcome, 'score');
  const lb = g.store.leaderboard();
  // 40 s left × 10 + 3 shields × 100 = 700; 35 s left × 10 + 300 = 650
  assert.deepEqual(lb.map((e) => [e.name, e.timeMs, e.score]), [['Amal', 20000, 700], ['Badr', 25000, 650]]);
  const saved = JSON.parse(fs.readFileSync(g.file, 'utf8'));
  assert.equal(saved.races.length, 1);
});

test('both fuel timers start on the same GO tick', () => {
  const g = setup();
  startDuel(g, g.clock);
  g.clock.tick(60000);
  const s = g.s();
  assert.equal(s.players[1].status, 'outOfFuel');
  assert.equal(s.players[2].status, 'outOfFuel');
  assert.equal(s.players[1].lastedMs, s.players[2].lastedMs);
});

test('false start: KeyR during countdown cancels and returns to arming with a notice', () => {
  const g = setup();
  g.game.setName(1, 'Amal');
  g.game.setReady(1, true);
  g.game.setReady(2, true);
  g.clock.tick(1500);
  g.game.key('KeyR');
  const s = g.s();
  assert.equal(s.phase, 'arming');
  assert.equal(s.notice.kind, 'falseStart');
  assert.equal(s.notice.name, 'Amal');
  assert.equal(s.players[1].ready, false);
  assert.equal(s.players[2].ready, false);
  g.clock.tick(5000);
  assert.equal(g.s().phase, 'arming', 'does not start by itself');
  assert.equal(g.s().notice, null, 'notice clears');
});

test('KeyP false start for player 2 too, and KeyR/KeyP while racing are harmless', () => {
  const g = setup();
  g.game.bothReady();
  g.game.key('KeyP');
  assert.equal(g.s().notice.player, 2);
  g.game.bothReady();
  g.clock.tick(3000);
  g.game.key('KeyR');
  assert.equal(g.s().phase, 'racing');
});

test('cooldown: three hits within 500 ms remove only one shield', () => {
  const g = setup();
  startDuel(g, g.clock);
  g.game.key('KeyQ');
  g.clock.tick(200);
  g.game.key('KeyQ');
  g.clock.tick(250);
  g.game.key('KeyQ');
  const p = g.s().players[1];
  assert.equal(p.shields, 2);
  assert.equal(p.hits, 1);
  assert.equal(p.ignoredHits, 2);
});

test('shields down: three hits >1 s apart knock P1 out while P2 keeps racing', () => {
  const g = setup();
  startDuel(g, g.clock);
  for (let i = 0; i < 3; i++) { g.game.key('KeyQ'); g.clock.tick(1001); }
  const s = g.s();
  assert.equal(s.players[1].status, 'shieldsDown');
  assert.equal(s.players[1].shields, 0);
  assert.equal(s.players[2].status, 'racing');
  assert.equal(s.phase, 'racing');
});

test('out of fuel when nobody docks; winner is who lasted longer', () => {
  const g = setup();
  startDuel(g, g.clock);
  for (let i = 0; i < 3; i++) { g.game.key('KeyU'); g.clock.tick(1001); }
  g.clock.tick(60000);
  const s = g.s();
  assert.equal(s.players[1].status, 'outOfFuel');
  assert.equal(s.result.winner, 1);
  assert.equal(s.result.outcome, 'lasted');
});

test('both fail at the same time: more shields wins, else tie', () => {
  const g = setup();
  startDuel(g, g.clock);
  g.game.key('KeyQ');
  g.clock.tick(60000);
  assert.equal(g.s().result.winner, 2);
  assert.equal(g.s().result.outcome, 'shields');

  const h = setup();
  startDuel(h, h.clock);
  h.clock.tick(60000);
  assert.equal(h.s().result.outcome, 'tie');
  assert.equal(h.s().result.winner, null);
  assert.equal(h.store.leaderboard().length, 0, 'failed runs never go on the leaderboard');
});

test('a dock during a cooldown still counts', () => {
  const g = setup();
  startDuel(g, g.clock);
  g.game.key('KeyQ');
  g.clock.tick(100);
  g.game.key('KeyW');
  assert.equal(g.s().players[1].status, 'docked');
  assert.equal(g.s().players[1].shields, 2);
});

test('a dock after shields down is ignored', () => {
  const g = setup();
  startDuel(g, g.clock);
  for (let i = 0; i < 3; i++) { g.game.key('KeyQ'); g.clock.tick(1001); }
  g.game.key('KeyW');
  assert.equal(g.s().players[1].status, 'shieldsDown');
});

test('undo hit gives a shield back, never above the maximum', () => {
  const g = setup();
  startDuel(g, g.clock);
  g.game.key('KeyQ');
  g.game.undoHit(1);
  assert.equal(g.s().players[1].shields, 3);
  assert.equal(g.s().players[1].hits, 0);
  g.game.undoHit(1);
  assert.equal(g.s().players[1].shields, 3);
});

test('undo on the result screen updates the saved shields', () => {
  const g = setup();
  startDuel(g, g.clock);
  g.game.key('KeyQ');
  g.clock.tick(1000);
  g.game.key('KeyW');
  g.game.key('KeyI');
  assert.equal(g.s().phase, 'result');
  assert.equal(g.store.leaderboard().find((e) => e.player === 1).shieldsLeft, 2);
  g.game.undoHit(1);
  assert.equal(g.store.leaderboard().find((e) => e.player === 1).shieldsLeft, 3);
  assert.equal(g.store.races().length, 1);
});

test('undo of a false "shields down" hit puts the player back in the race', () => {
  const g = setup({});
  solo(g, 1);
  g.clock.tick(3000);
  for (let i = 0; i < 3; i++) { g.game.key('KeyQ'); g.clock.tick(1001); }
  assert.equal(g.s().phase, 'result');
  assert.equal(g.store.races().length, 1);
  g.game.undoHit(1);
  assert.equal(g.s().phase, 'racing');
  assert.equal(g.s().players[1].status, 'racing');
  assert.equal(g.store.races().length, 0, 'reopened race is not double-counted');
  g.clock.tick(1000);
  g.game.key('KeyW');
  assert.equal(g.s().phase, 'result');
  assert.equal(g.store.leaderboard()[0].shieldsLeft, 1);
});

test('manual finish records the moment the press started', () => {
  const g = setup();
  startDuel(g, g.clock);
  g.clock.tick(30000);
  g.game.manualFinish(1, 1000);
  assert.equal(g.s().players[1].status, 'docked');
  assert.equal(g.s().players[1].timeMs, 29000);
  assert.equal(g.s().players[1].manualFinish, true);
});

test('manual finish just after fuel ran out still counts if the press began before', () => {
  const g = setup();
  solo(g, 2);
  g.clock.tick(3000);
  g.clock.tick(59500);
  g.clock.tick(600); // out of fuel at 60.0 s
  assert.equal(g.s().phase, 'result');
  g.game.manualFinish(2, 1000); // press began at 59.1 s
  assert.equal(g.s().players[2].status, 'docked');
  assert.equal(g.s().players[2].timeMs, 59100);
  assert.equal(g.store.leaderboard().length, 1);
});

test('reset mid-race saves nothing', () => {
  const g = setup();
  startDuel(g, g.clock);
  g.game.key('KeyW');
  g.game.reset();
  assert.equal(g.s().phase, 'idle');
  assert.equal(g.store.races().length, 0);
  assert.equal(g.store.leaderboard().length, 0);
});

test('no race starts without Ready: solo is refused until the player is Ready', () => {
  const g = setup();
  assert.equal(g.game.startSolo(1), false);
  assert.equal(g.s().phase, 'idle');
  g.game.setReady(2, true);
  assert.equal(g.game.startSolo(1), false, 'the other player being ready is not enough');
  assert.equal(g.s().phase, 'arming');
  g.game.setReady(1, true); // both ready: the duel starts on its own
  assert.equal(g.s().phase, 'countdown');
  assert.equal(g.s().mode, 'duel');
});

test('finish is a quick tap: the finish time is the moment of the tap', () => {
  const g = setup();
  startDuel(g, g.clock);
  g.clock.tick(12345);
  g.game.manualFinish(1, 0);
  assert.equal(g.s().players[1].timeMs, 12345);
});

test('solo mode: one player races alone and P2 keys are ignored', () => {
  const g = setup();
  g.game.setName(1, 'Sara');
  solo(g, 1);
  assert.equal(g.s().mode, 'solo');
  assert.equal(g.s().players[2].active, false);
  g.game.key('KeyP'); // the empty board must not cause a false start
  assert.equal(g.s().phase, 'countdown');
  g.clock.tick(3000);
  g.game.key('KeyU');
  assert.equal(g.s().players[2].hits, 0);
  g.clock.tick(12345);
  g.game.key('KeyW');
  const s = g.s();
  assert.equal(s.phase, 'result');
  assert.equal(s.result.outcome, 'soloDocked');
  assert.equal(g.store.leaderboard()[0].timeMs, 12345);
});

test('result screen returns to idle after 10 s and clears names, keeping one typed meanwhile', () => {
  const g = setup();
  startDuel(g, g.clock);
  g.game.key('KeyW');
  g.game.key('KeyI');
  g.clock.tick(2000);
  g.game.setName(2, 'Next');
  g.clock.tick(8000);
  const s = g.s();
  assert.equal(s.phase, 'idle');
  assert.equal(s.players[1].name, '');
  assert.equal(s.players[2].name, 'Next');
});

test('leaderboard: docked only, highest score first, top 10, survives restart', () => {
  const g = setup();
  // run i docks after 10 + i seconds; run 0 also takes a hit
  for (let i = 0; i < 12; i++) {
    solo(g, 1);
    g.clock.tick(3000);
    if (i === 0) g.game.key('KeyQ');
    g.clock.tick(10000 + i * 1000);
    g.game.key('KeyW');
    g.clock.tick(10000);
  }
  const lb = g.store.leaderboard();
  assert.equal(lb.length, 10);
  // run 1: 49 s left -> 490 + 300 = 790 beats run 0: 50 s left -> 500 + 200 = 700
  assert.equal(lb[0].score, 790);
  assert.deepEqual(lb.map((e) => e.score), [...lb.map((e) => e.score)].sort((a, b) => b - a));
  // run 0 and run 10 both score 700: the faster dock (run 0, 10 s) takes 10th place
  assert.equal(lb[9].score, 700);
  assert.equal(lb[9].timeMs, 10000);
  const again = new Store(g.file);
  assert.equal(again.leaderboard().length, 10);
});

test('score = seconds of fuel left × 10 + shields × 100, and 0 for a failed run', () => {
  const g = setup();
  solo(g, 1);
  g.clock.tick(3000);
  g.game.key('KeyQ');
  g.clock.tick(34200 - 0);
  g.game.key('KeyW');
  const p = g.s().players[1];
  assert.equal(p.timeMs, 34200);
  assert.equal(p.score, 258 + 200); // 25.8 s left, 2 shields
  assert.equal(g.store.races()[0].players[0].score, 458);

  const h = setup({ pointsPerSecond: 5, pointsPerShield: 50 });
  solo(h, 2);
  h.clock.tick(3000);
  h.clock.tick(60000);
  assert.equal(h.s().players[2].score, 0);
  assert.equal(h.store.races()[0].players[0].score, 0);
});

test('duel: the higher score wins even if it docked later', () => {
  const g = setup();
  startDuel(g, g.clock);
  for (let i = 0; i < 2; i++) { g.game.key('KeyQ'); g.clock.tick(1001); } // P1 loses 2 shields
  g.game.key('KeyW'); // P1 docks at ~2 s with 1 shield: 580 + 100 = 680
  g.clock.tick(3000);
  g.game.key('KeyI'); // P2 docks at ~5 s with 3 shields: 550 + 300 = 850
  const s = g.s();
  assert.equal(s.result.winner, 2);
  assert.equal(s.result.outcome, 'score');
  assert.ok(s.players[2].score > s.players[1].score);
});

test('unmapped keys and Arabic-layout events are judged by code only', () => {
  const g = setup();
  startDuel(g, g.clock);
  assert.equal(g.game.key('KeyZ'), 'not mapped');
  // The display page sends event.code, so an Arabic "ض" press still arrives as KeyQ.
  g.game.key('KeyQ');
  assert.equal(g.s().players[1].hits, 1);
});

test('settings reject a key map that reuses a key or a laptop fallback key', () => {
  assert.throws(() => normalize({ keys: { p1: { hit: 'KeyW' } } }), /used twice/);
  assert.throws(() => normalize({ keys: { p1: { hit: 'KeyF' } } }), /reserved/);
  assert.equal(normalize({ fuelSeconds: 'abc' }).fuelSeconds, 60);
});

test('CSV export escapes names that look like formulas', () => {
  const g = setup();
  g.game.setName(1, '=HYPERLINK("x")');
  solo(g, 1);
  g.clock.tick(3000);
  g.game.key('KeyW');
  const csv = g.store.toCsv();
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
});
