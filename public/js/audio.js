// Game sounds made with the Web Audio API (no files). Player 1 sounds lean left,
// Player 2 sounds lean right, so the room can tell which side was hit.

let ctx = null;
let master = null;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Browsers only allow sound after a click or key press; call this from one. */
export function unlockAudio() { ensure(); }

function out(player) {
  const c = ensure();
  if (!c) return null;
  if (!player || !c.createStereoPanner) return master;
  const pan = c.createStereoPanner();
  pan.pan.value = player === 1 ? -0.6 : 0.6;
  pan.connect(master);
  return pan;
}

function tone({ freq, to, type = 'sine', start = 0, dur = 0.2, vol = 0.4, player }) {
  const c = ensure();
  const dest = out(player);
  if (!c || !dest) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise({ start = 0, dur = 0.25, vol = 0.5, filter = 1200, player }) {
  const c = ensure();
  const dest = out(player);
  if (!c || !dest) return;
  const t0 = c.currentTime + start;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = filter;
  bp.Q.value = 0.8;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(bp).connect(g).connect(dest);
  src.start(t0);
}

export const sounds = {
  countdownBeep() { tone({ freq: 660, type: 'square', dur: 0.16, vol: 0.22 }); },
  go() {
    tone({ freq: 880, type: 'square', dur: 0.5, vol: 0.22 });
    tone({ freq: 1320, type: 'sine', dur: 0.5, vol: 0.18 });
  },
  hit(player) {
    noise({ dur: 0.28, vol: 0.9, filter: 900, player });
    tone({ freq: 150, to: 50, type: 'sine', dur: 0.3, vol: 0.6, player });
  },
  shieldLost(player) {
    tone({ freq: 620, to: 140, type: 'sawtooth', start: 0.07, dur: 0.38, vol: 0.18, player });
  },
  docked(player) {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', start: i * 0.09, dur: 0.32, vol: 0.3, player }));
  },
  failed(player) {
    tone({ freq: 330, to: 220, type: 'square', dur: 0.35, vol: 0.18, player });
    tone({ freq: 220, to: 110, type: 'square', start: 0.32, dur: 0.6, vol: 0.18, player });
  },
  falseStart() {
    tone({ freq: 200, type: 'square', dur: 0.18, vol: 0.25 });
    tone({ freq: 200, type: 'square', start: 0.24, dur: 0.18, vol: 0.25 });
  },
  undo(player) { tone({ freq: 440, to: 660, type: 'sine', dur: 0.18, vol: 0.2, player }); },
};
