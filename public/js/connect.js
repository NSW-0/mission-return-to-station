// Connect page (/connect, laptop only): the two referee QR codes and whether each phone is connected.

import { connect } from './link.js';

const cards = { 1: document.querySelector('[data-player="1"]'), 2: document.querySelector('[data-player="2"]') };
const displayState = document.querySelector('.display-state');
const goButton = document.querySelector('.go');

// The display opens in its own tab (never in this one), so the QR codes stay available.
// A second display would play every sound twice, so ask first if one is already open.
goButton.addEventListener('click', (e) => {
  e.preventDefault();
  if (displayState.dataset.on === 'true' && !confirm('A game display tab is already open. Open another one? (Sounds will play twice.)')) return;
  window.open('/', 'mrs-display');
});
let lastUrls = '';

// Laptop only: this page and the endpoint refuse phones.
document.querySelector('.reset-scores').addEventListener('click', async () => {
  if (!confirm('Reset the scores? The top scores list will be empty. Race records stay in the CSV export on the admin page.')) return;
  const res = await fetch('/api/leaderboard/clear', { method: 'POST' });
  document.querySelector('.scores-msg').textContent = res.ok ? 'Scores reset.' : 'Could not reset the scores.';
});

connect({
  role: 'connect',
  onConfig(msg) {
    document.body.style.setProperty('--p1', msg.config.colors.p1);
    document.body.style.setProperty('--p2', msg.config.colors.p2);
    if (!msg.urls) return;
    const sig = `${msg.urls.ref1}|${msg.urls.ref2}`;
    if (sig === lastUrls) return;
    lastUrls = sig;
    const bust = Date.now();
    for (const id of [1, 2]) {
      cards[id].querySelector('.qr').src = `/api/qr/${id}.svg?v=${bust}`;
      cards[id].querySelector('.url').textContent = msg.urls[`ref${id}`];
    }
  },
  onState(msg) {
    const displays = msg.clients.filter((c) => c.role === 'display').length;
    const showing = String(displays > 0);
    if (displayState.dataset.on !== showing) {
      displayState.dataset.on = showing;
      displayState.querySelector('.label').textContent = displays > 0 ? 'Game display tab is open' : 'Game display tab is not open';
      goButton.textContent = displays > 0 ? 'Open another display tab' : 'Open the game display tab';
    }
    const online = new Set(msg.clients.filter((c) => c.role === 'ref').map((c) => c.player));
    for (const id of [1, 2]) {
      const state = cards[id].querySelector('.state');
      const on = online.has(id);
      if (state.dataset.on === String(on)) continue;
      state.dataset.on = String(on);
      state.querySelector('.label').textContent = on ? 'Phone connected' : 'Waiting for the phone…';
    }
  },
});
