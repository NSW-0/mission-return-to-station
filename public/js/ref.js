// Referee phone page: /ref/1 or /ref/2. Open it once from the Connect page QR code;
// it stays connected (and reconnects by itself) for the whole event.

import { connect } from './link.js';
import { text, put, seconds, scoreFor } from './strings.js';

const $ = (sel) => document.querySelector(sel);
const match = location.pathname.match(/\/ref\/([12])/);
const me = match ? Number(match[1]) : 1;
const key = new URLSearchParams(location.search).get('k') || '';
document.body.dataset.player = String(me);
document.title = `${text('refTitle')} ${me}: ${text('title')}`;

let state = null;
let config = null;
let shipFiles = new Set();
let linkState = 'connecting';
let nameTimer = null;
const lastSig = {};

/** Run fn only when sig changed since last time (keeps the DOM quiet). */
function setOnce(sigKey, sig, fn) {
  if (lastSig[sigKey] === sig) return;
  lastSig[sigKey] = sig;
  fn();
}

// ------------------------------------------------------------------ static text

put($('.role'), 'refTitle');
put($('.player'), 'player', { n: me });
put($('.name-label'), 'nameLabel');
$('#name').placeholder = text('namePlaceholder');
put($('.fuel-label'), 'fuel');
put($('.score-label'), 'score');
btnText($('#solo'), 'startSolo', 'soloHelp');
btnText($('#undo'), 'undoHit');
btnText($('#testHit'), 'testHit', 'testHitHelp');
btnText($('#finish'), 'manualFinish', 'manualFinishHelp');
btnText($('#reset'), 'reset', 'resetHelp');

function btnText(el, k, helpKey) {
  el.textContent = text(k);
  if (helpKey) {
    const small = document.createElement('small');
    small.textContent = text(helpKey);
    el.append(small);
  }
}

// ------------------------------------------------------------------ link

const link = connect({
  role: 'ref',
  player: me,
  key,
  onConfig(msg) {
    config = msg.config;
    document.body.style.setProperty('--p1', config.colors.p1);
    document.body.style.setProperty('--p2', config.colors.p2);
    $('#testHit').hidden = !config.refTestButtons;
  },
  onAssets(files) {
    shipFiles = new Set(files.filter((f) => f.startsWith('ship/')));
    render();
  },
  onState(msg) {
    state = msg.state;
    render();
  },
  onEvent(e) {
    if (e.player !== me) return;
    if (e.kind === 'hit' && navigator.vibrate) navigator.vibrate(e.shields === 0 ? [120, 60, 220] : 120);
    if (e.kind === 'docked' && navigator.vibrate) navigator.vibrate([60, 40, 60]);
  },
  onStatus(s) {
    linkState = s;
    render();
  },
  onDenied() {
    $('#denied').hidden = false;
    put($('#denied p'), 'badKey');
  },
});

// ------------------------------------------------------------------ name

const nameInput = $('#name'); // the server keeps the name, so a reloaded phone gets it back
nameInput.addEventListener('input', () => {
  clearTimeout(nameTimer);
  nameTimer = setTimeout(sendName, 250);
});
nameInput.addEventListener('change', sendName);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });

function sendName() {
  clearTimeout(nameTimer);
  nameTimer = null;
  link.send({ t: 'name', name: nameInput.value.trim() });
}

// ------------------------------------------------------------------ buttons

$('#ready').addEventListener('click', () => {
  if (!state) return;
  sendName();
  const p = state.players[me];
  const lobby = state.phase === 'idle' || state.phase === 'arming';
  link.send({ t: 'ready', ready: lobby ? !p.ready : true });
});
$('#solo').addEventListener('click', () => link.send({ t: 'solo' }));
$('#undo').addEventListener('click', () => link.send({ t: 'undo' }));
$('#testHit').addEventListener('click', () => link.send({ t: 'testHit' }));
// Finish and Reset are quick taps.
// Finish: the loop docked but the pad did not register, so the finish time is now.
$('#finish').addEventListener('click', () => {
  if (navigator.vibrate) navigator.vibrate(60);
  link.send({ t: 'manualFinish', heldMs: 0 });
});
// Reset: ends the round at once and saves nothing.
$('#reset').addEventListener('click', () => {
  if (navigator.vibrate) navigator.vibrate(60);
  link.send({ t: 'reset' });
});


// ------------------------------------------------------------------ render

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

function shipState(p) {
  if (p.status === 'docked') return 'winner';
  if (p.status === 'shieldsDown' || p.shields <= 0) return 'broken';
  if (p.shields >= p.maxShields) return 'shield3';
  if (p.shields === 1) return 'shield1';
  return 'shield2';
}

function render() {
  $('.link').dataset.state = linkState;
  setOnce('link', linkState, () => put($('.link-text'), linkState === 'open' ? 'connected' : 'reconnecting'));
  if (!state) return;
  const p = state.players[me];
  const phase = state.phase;
  const online = linkState === 'open';
  const lobby = phase === 'idle' || phase === 'arming';

  const st = statusFor(p);
  const statusEl = $('.status');
  setOnce('status', JSON.stringify(st), () => {
    put(statusEl, st.key, st.vars);
    if (st.tone) statusEl.dataset.tone = st.tone; else delete statusEl.dataset.tone;
  });

  let hint = 'phaseIdle';
  if (phase === 'arming' && p.ready) hint = 'phaseSoloOrWait';
  if (phase === 'countdown') hint = 'phaseCountdown';
  if (phase === 'racing') hint = '';
  if (phase === 'result') hint = state.result && state.result.winner === me ? 'youWon' : 'phaseResult';
  if (state.notice && state.notice.kind === 'falseStart') hint = 'falseStart';
  const hintText = hint ? text(hint, { name: state.notice ? state.notice.name : '' }) : '';
  if ($('.phase-hint').textContent !== hintText) $('.phase-hint').textContent = hintText;

  // ship picture shows the player's state
  const ship = $('.ship');
  const file = `ship/p${me}_${shipState(p)}.png`;
  if (shipFiles.has(file)) {
    if (!ship.src.endsWith(file)) ship.src = `/assets/${file}`;
    ship.hidden = false;
  } else ship.hidden = true;

  setOnce('shields', `${p.shields}/${p.maxShields}`, () => {
    const row = $('.shields');
    row.replaceChildren();
    for (let i = 0; i < p.maxShields; i++) {
      const d = document.createElement('div');
      d.className = i < p.shields ? 'hex' : 'hex lost';
      row.append(d);
    }
    row.setAttribute('aria-label', `${text('shields')} ${p.shields} / ${p.maxShields}`);
  });
  setOnce('hits', String(p.hits), () => {
    const b = document.createElement('b');
    b.textContent = p.hits;
    $('.hits').replaceChildren(b, ` ${text('hits')}`);
  });

  // name field: the server is the source of truth unless the referee is typing
  if (document.activeElement !== nameInput && nameInput.value !== p.name && !nameTimer) nameInput.value = p.name;
  nameInput.disabled = !online || !(lobby || phase === 'result');

  const ready = $('#ready');
  const readyKey = lobby && p.ready ? 'cancelReady' : 'ready';
  setOnce('ready', readyKey, () => put(ready, readyKey));
  ready.classList.toggle('is-ready', lobby && p.ready);
  ready.disabled = !online || !(lobby || phase === 'result');
  // No race of any kind starts without Ready: solo needs this player Ready first.
  const soloOk = online && phase === 'arming' && p.ready;
  $('#solo').disabled = !soloOk;
  setOnce('soloHelp', String(soloOk), () => { $('#solo small').textContent = soloOk ? '' : text('soloHelp'); });
  $('#undo').disabled = !online || !p.active || !(phase === 'racing' || phase === 'result') || p.shields >= p.maxShields;
  const canFinish = p.active && (phase === 'racing' || phase === 'result') && p.status !== 'docked';
  $('#finish').disabled = !online || !canFinish;
  $('#reset').disabled = !online || phase === 'idle';
  $('#testHit').disabled = !online || phase !== 'racing' || p.status !== 'racing';
}

// fuel and live score tick every frame
function frame() {
  if (state && config) {
    const p = state.players[me];
    const full = state.fuelMs || config.fuelSeconds * 1000;
    let left = full;
    if (state.goAt != null && (state.phase === 'racing' || state.phase === 'result')) {
      left = p.doneAt != null ? full - p.lastedMs : full - (link.serverNow() - state.goAt);
    }
    left = Math.max(0, Math.min(full, left));
    $('.bar-track .fill').style.transform = `scaleX(${(left / full).toFixed(4)})`;
    const txt = `${seconds(left)} s`;
    const sec = $('.fuel-sec');
    if (sec.textContent !== txt) sec.textContent = txt;
    $('.fuel').classList.toggle('low', left < 10000 && p.status === 'racing');

    let score;
    if (p.status === 'docked') score = p.score;
    else if (p.status === 'shieldsDown' || p.status === 'outOfFuel') score = 0;
    else score = scoreFor(left, p.shields, state.scoring);
    const num = $('.score-num');
    if (num.textContent !== String(score)) num.textContent = String(score);
    $('.score').classList.toggle('final', p.status === 'docked');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
