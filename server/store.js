const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./fsutil');

const LEADERBOARD_SIZE = 10;

/**
 * Saves every race and the leaderboard to one JSON file so they survive a restart.
 * Shape: { races: RaceRecord[], leaderboard: Entry[] }
 * Only docked runs go on the leaderboard: highest score first, then fastest, then most shields.
 */
class Store {
  constructor(file) {
    this.file = file;
    this.data = { races: [], leaderboard: [] };
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.races = Array.isArray(raw.races) ? raw.races : [];
      this.data.leaderboard = Array.isArray(raw.leaderboard) ? raw.leaderboard : [];
    } catch (err) {
      // Keep the broken file for a human to look at, and start fresh.
      const backup = `${this.file}.broken-${Date.now()}`;
      fs.copyFileSync(this.file, backup);
      console.error(`! ${this.file} could not be read (${err.message}). A copy was kept at ${backup}.`);
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    writeJsonAtomic(this.file, this.data);
  }

  /** Add a race, or replace it if the same race id was saved before (undo hit / manual finish on the result screen). */
  saveRace(record) {
    const i = this.data.races.findIndex((r) => r.id === record.id);
    if (i >= 0) this.data.races[i] = record;
    else this.data.races.push(record);

    this.data.leaderboard = this.data.leaderboard.filter((e) => e.raceId !== record.id);
    for (const p of record.players) {
      if (p.result !== 'docked') continue;
      this.data.leaderboard.push({
        raceId: record.id,
        date: record.date,
        mode: record.mode,
        player: p.player,
        name: p.name,
        timeMs: p.timeMs,
        shieldsLeft: p.shieldsLeft,
        score: p.score,
      });
    }
    this.persist();
  }

  /** Forget a race that was reopened (undo hit brought a "Shields down" player back into the race). */
  removeRace(id) {
    this.data.races = this.data.races.filter((r) => r.id !== id);
    this.data.leaderboard = this.data.leaderboard.filter((e) => e.raceId !== id);
    this.persist();
  }

  leaderboard(limit = LEADERBOARD_SIZE) {
    return [...this.data.leaderboard]
      .sort((a, b) => (b.score || 0) - (a.score || 0) || a.timeMs - b.timeMs || b.shieldsLeft - a.shieldsLeft
        || String(a.date).localeCompare(String(b.date)))
      .slice(0, limit);
  }

  clearLeaderboard() {
    this.data.leaderboard = [];
    this.persist();
  }

  races() {
    return this.data.races;
  }

  toCsv() {
    const header = [
      'race_id', 'date', 'mode', 'player', 'name', 'result', 'score', 'time_s', 'lasted_s',
      'shields_left', 'hits', 'hit_times_s', 'manual_finish', 'race_winner', 'on_leaderboard',
    ];
    const onBoard = new Set(this.data.leaderboard.map((e) => `${e.raceId}:${e.player}`));
    const rows = [header];
    for (const r of this.data.races) {
      for (const p of r.players) {
        rows.push([
          r.id, r.date, r.mode, p.player, p.name, p.result, p.score == null ? '' : p.score,
          p.timeMs == null ? '' : (p.timeMs / 1000).toFixed(2),
          p.lastedMs == null ? '' : (p.lastedMs / 1000).toFixed(2),
          p.shieldsLeft, p.hits,
          (p.hitTimesMs || []).map((t) => (t / 1000).toFixed(2)).join(' '),
          p.manualFinish ? 'yes' : 'no',
          r.outcome === 'tie' ? 'tie' : r.winnerName || '',
          onBoard.has(`${r.id}:${p.player}`) ? 'yes' : 'no',
        ]);
      }
    }
    return '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
}

function csvCell(value) {
  let s = value == null ? '' : String(value);
  // Stop spreadsheet apps from running a typed name such as "=1+1" as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { Store, LEADERBOARD_SIZE };
