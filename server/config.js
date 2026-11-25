const fs = require('fs');
const path = require('path');
const DEFAULTS = require('./defaults');
const { writeJsonAtomic } = require('./fsutil');

const RESERVED_CODES = new Set(['Enter', 'NumpadEnter', 'Backspace', 'KeyF', 'F2']);
const CODE_RE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-2]))$/;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/** Merge an untrusted settings object onto the defaults. Throws on a broken key map. */
function normalize(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {
    fuelSeconds: clampNumber(src.fuelSeconds, 5, 600, DEFAULTS.fuelSeconds),
    shields: Math.round(clampNumber(src.shields, 1, 9, DEFAULTS.shields)),
    hitCooldownMs: Math.round(clampNumber(src.hitCooldownMs, 0, 10000, DEFAULTS.hitCooldownMs)),
    countdownSeconds: Math.round(clampNumber(src.countdownSeconds, 1, 10, DEFAULTS.countdownSeconds)),
    resultSeconds: clampNumber(src.resultSeconds, 1, 120, DEFAULTS.resultSeconds),
    pointsPerSecond: clampNumber(src.pointsPerSecond, 0, 1000, DEFAULTS.pointsPerSecond),
    pointsPerShield: clampNumber(src.pointsPerShield, 0, 10000, DEFAULTS.pointsPerShield),
    falseStartSeconds: clampNumber(src.falseStartSeconds, 1, 30, DEFAULTS.falseStartSeconds),
    port: Math.round(clampNumber(src.port, 1, 65535, DEFAULTS.port)),
    hostOverride: typeof src.hostOverride === 'string' ? src.hostOverride.trim().slice(0, 64) : '',
    requireRefKey: src.requireRefKey === undefined ? DEFAULTS.requireRefKey : Boolean(src.requireRefKey),
    refTestButtons: src.refTestButtons === undefined ? DEFAULTS.refTestButtons : Boolean(src.refTestButtons),
    colors: {
      p1: cleanColor(src.colors && src.colors.p1, DEFAULTS.colors.p1),
      p2: cleanColor(src.colors && src.colors.p2, DEFAULTS.colors.p2),
    },
    keys: { p1: {}, p2: {} },
    facts: [],
  };

  const used = new Map();
  for (const p of ['p1', 'p2']) {
    for (const action of ['hit', 'dock', 'padOn', 'padOff']) {
      const given = src.keys && src.keys[p] && src.keys[p][action];
      const code = typeof given === 'string' && given.trim() ? given.trim() : DEFAULTS.keys[p][action];
      if (!CODE_RE.test(code)) throw new Error(`Key for ${p} ${action} must be a KeyboardEvent.code such as KeyQ (got "${code}")`);
      if (RESERVED_CODES.has(code)) throw new Error(`${code} is reserved for the laptop fallback keys`);
      if (used.has(code)) throw new Error(`${code} is used twice (${used.get(code)} and ${p} ${action})`);
      used.set(code, `${p} ${action}`);
      out.keys[p][action] = code;
    }
  }

  const facts = Array.isArray(src.facts) ? src.facts : DEFAULTS.facts;
  for (const f of facts) {
    if (!f || typeof f !== 'object') continue;
    const text = String(f.text || f.en || '').trim().slice(0, 400);
    const source = String(f.source || '').trim().slice(0, 120);
    if (text) out.facts.push({ text, source });
  }
  return out;
}

class Config {
  constructor(file) {
    this.file = file;
    this.value = null;
    this.load();
  }

  load() {
    let raw = {};
    if (fs.existsSync(this.file)) {
      try {
        raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch (err) {
        console.error(`! Could not read ${this.file} (${err.message}). Using the defaults.`);
      }
    }
    try {
      this.value = normalize(raw);
    } catch (err) {
      console.error(`! ${err.message}. Using the default key map.`);
      this.value = normalize({ ...raw, keys: undefined });
    }
    if (!fs.existsSync(this.file)) this.save(this.value);
    return this.value;
  }

  get() {
    return this.value;
  }

  /** Validate and store new settings. Throws with a readable message when invalid. */
  save(next) {
    const value = normalize(next);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    writeJsonAtomic(this.file, value);
    this.value = value;
    return value;
  }
}

module.exports = { Config, normalize, DEFAULTS };
