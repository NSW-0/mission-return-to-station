#!/usr/bin/env node
/**
 * Mission: Return to Station: one command starts the game server.
 *   npm start           (or: node server/index.js)
 * Options: --no-open   do not open the display page in the browser
 * Env:     PORT, MRS_CONFIG (settings file), MRS_DATA (results file), MRS_NO_OPEN=1
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const { Config } = require('./config');
const { Store } = require('./store');
const { Game } = require('./game');
const { listAddresses, pickHost, isLocalAddress } = require('./net');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const CONFIG_PATH = process.env.MRS_CONFIG ? path.resolve(process.env.MRS_CONFIG) : path.join(ROOT, 'config', 'settings.json');
const DATA_PATH = process.env.MRS_DATA ? path.resolve(process.env.MRS_DATA) : path.join(ROOT, 'data', 'results.json');
const KEY_PATH = path.join(path.dirname(DATA_PATH), 'referee-key.json');

// The art files the Manus images will use. Anything missing is drawn in code.
const ASSET_NAMES = [
  'background.png', 'blackhole.png', 'satellite_p1.png', 'satellite_p2.png', 'debris_1.png', 'debris_2.png', 'debris_3.png',
  'meteoroid_1.png', 'meteoroid_2.png', 'shield_full.png', 'shield_broken.png', 'spark.png', 'station.png', 'logo.png',
];
const SHIP_STATES = ['shield3', 'shield2', 'shield1', 'broken', 'winner'];

const config = new Config(CONFIG_PATH);
const store = new Store(DATA_PATH);
const game = new Game({ getConfig: () => config.get(), store });
const refKey = loadRefKey();
const port = Number(process.env.PORT) || config.get().port;

function loadRefKey() {
  try {
    const saved = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
    if (saved && /^[a-z0-9]{4,12}$/.test(saved.key)) return saved.key;
  } catch { /* first start */ }
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alike characters
  let key = '';
  for (const b of crypto.randomBytes(5)) key += alphabet[b % alphabet.length];
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  fs.writeFileSync(KEY_PATH, JSON.stringify({ key }, null, 2));
  return key;
}

function urls() {
  const host = pickHost(config.get().hostOverride);
  const base = `http://${host}:${port}`;
  const k = config.get().requireRefKey ? `?k=${refKey}` : '';
  return {
    host,
    display: `http://localhost:${port}/`,
    connect: `http://localhost:${port}/connect`,
    admin: `http://localhost:${port}/admin`,
    ref1: `${base}/ref/1${k}`,
    ref2: `${base}/ref/2${k}`,
  };
}

/**
 * A fingerprint of the page files. Open pages (phones especially, which stay open
 * all event) reload themselves when it changes, so they never run an old version.
 */
function pageVersion() {
  const parts = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const st = fs.statSync(full);
        parts.push(`${full}:${st.size}:${st.mtimeMs}`);
      }
    }
  };
  try { walk(PUBLIC); } catch { /* folder being edited */ }
  return crypto.createHash('sha1').update(parts.sort().join('|')).digest('hex').slice(0, 12);
}
let currentVersion = pageVersion();

function availableAssets() {
  const files = ASSET_NAMES.filter((n) => fs.existsSync(path.join(PUBLIC, 'assets', n)));
  for (const p of ['p1', 'p2']) {
    for (const s of SHIP_STATES) {
      const n = `ship/${p}_${s}.png`;
      if (fs.existsSync(path.join(PUBLIC, 'assets', n))) files.push(n);
    }
  }
  return files;
}

// ------------------------------------------------------------------ HTTP

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));

function localOnly(req, res, next) {
  if (isLocalAddress(req.socket.remoteAddress)) return next();
  res.status(403).type('text').send('This page only opens on the game laptop.');
}

const noCache = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html'), noCache));
app.get('/ref/:player(1|2)', (req, res) => res.sendFile(path.join(PUBLIC, 'ref.html'), noCache));
app.get('/connect', localOnly, (req, res) => res.sendFile(path.join(PUBLIC, 'connect.html'), noCache));
app.get('/admin', localOnly, (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html'), noCache));
app.use(express.static(PUBLIC, { index: false, ...noCache }));
app.use('/vendor/chakra-petch', express.static(path.join(ROOT, 'node_modules', '@fontsource', 'chakra-petch'), { maxAge: '7d' }));

app.get('/api/assets', (req, res) => res.json({ files: availableAssets() }));
app.get('/api/info', localOnly, (req, res) => res.json({ urls: urls(), addresses: listAddresses(), refKey, port }));
app.get('/api/settings', localOnly, (req, res) => res.json(config.get()));
app.post('/api/settings', localOnly, (req, res) => {
  try {
    const before = config.get();
    const saved = config.save(req.body);
    broadcastConfig();
    res.json({ ok: true, settings: saved, restartNeeded: saved.port !== before.port });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});
app.post('/api/leaderboard/clear', localOnly, (req, res) => {
  store.clearLeaderboard();
  broadcastState();
  res.json({ ok: true });
});
app.get('/api/state', localOnly, (req, res) => res.json({ state: game.snapshot(), clients: clientSummary() }));
app.get('/api/races', localOnly, (req, res) => res.json({ races: store.races(), leaderboard: store.leaderboard() }));
app.get('/api/export.csv', localOnly, (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="mission-results-${stamp}.csv"`);
  res.type('text/csv; charset=utf-8').send(store.toCsv());
});
app.get('/api/qr/:player(1|2).svg', localOnly, async (req, res) => {
  const url = urls()[`ref${req.params.player}`];
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0B1033', light: '#EEF2FF' } });
  res.type('image/svg+xml').setHeader('Cache-Control', 'no-cache');
  res.send(svg);
});

// ------------------------------------------------------------------ WebSocket

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const clients = new Set();

function send(client, msg) {
  if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
}

function clientSummary() {
  return [...clients].filter((c) => c.role).map((c) => ({ role: c.role, player: c.player, ip: c.ip, since: c.since }));
}

function publicConfig() {
  const c = config.get();
  return {
    fuelSeconds: c.fuelSeconds, shields: c.shields, hitCooldownMs: c.hitCooldownMs,
    countdownSeconds: c.countdownSeconds, resultSeconds: c.resultSeconds,
    pointsPerSecond: c.pointsPerSecond, pointsPerShield: c.pointsPerShield,
    refTestButtons: c.refTestButtons,
    colors: c.colors, keys: c.keys, facts: c.facts,
  };
}

function stateMessage() {
  return { t: 'state', state: game.snapshot(), leaderboard: store.leaderboard(), clients: clientSummary() };
}

function broadcastState() {
  const msg = JSON.stringify(stateMessage());
  for (const c of clients) if (c.role && c.ws.readyState === 1) c.ws.send(msg);
}

function broadcastConfig() {
  for (const c of clients) {
    if (c.role) send(c, { t: 'config', config: publicConfig(), urls: c.local ? urls() : null, version: currentVersion });
  }
}

game.on('change', broadcastState);
game.on('event', (e) => {
  const msg = JSON.stringify({ t: 'event', ...e, at: game.now() });
  for (const c of clients) if (c.role && c.ws.readyState === 1) c.ws.send(msg);
});

wss.on('connection', (ws, req) => {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const client = { ws, ip, local: isLocalAddress(ip), role: null, player: null, since: Date.now(), alive: true };
  clients.add(client);

  ws.on('pong', () => { client.alive = true; });
  ws.on('close', () => { clients.delete(client); broadcastState(); });
  ws.on('error', () => {});
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      handle(client, msg);
    } catch (err) {
      console.error('! Message failed:', msg.t, err);
    }
  });
});

function handle(client, msg) {
  if (msg.t === 'hello') {
    const role = msg.role;
    if ((role === 'display' || role === 'admin' || role === 'connect') && !client.local) {
      send(client, { t: 'denied', reason: 'notLocal' });
      return client.ws.close();
    }
    if (role === 'ref') {
      const player = Number(msg.player);
      if (player !== 1 && player !== 2) return client.ws.close();
      if (config.get().requireRefKey && !client.local && msg.key !== refKey) {
        send(client, { t: 'denied', reason: 'badKey' });
        return client.ws.close();
      }
      client.player = player;
    }
    if (!['display', 'admin', 'connect', 'ref'].includes(role)) return client.ws.close();
    client.role = role;
    send(client, { t: 'config', config: publicConfig(), urls: client.local ? urls() : null, version: currentVersion });
    send(client, { t: 'assets', files: availableAssets() });
    broadcastState();
    return;
  }

  if (msg.t === 'ping') return send(client, { t: 'pong', id: msg.id, now: game.now() });
  if (!client.role) return;

  // The display page forwards the Pro Micro's key presses and the laptop fallback keys.
  if (client.role === 'display') {
    if (msg.t === 'key' && typeof msg.code === 'string') return void game.key(msg.code.slice(0, 32));
    if (msg.t === 'fallback' && msg.action === 'bothReady') return void game.bothReady();
    if (msg.t === 'fallback' && msg.action === 'reset') return void game.reset();
    return;
  }

  // Referee phones act on their own player only.
  if (client.role === 'ref') {
    const id = client.player;
    switch (msg.t) {
      case 'name': return void game.setName(id, msg.name);
      case 'ready': return void game.setReady(id, Boolean(msg.ready));
      case 'solo': return void game.startSolo(id);
      case 'undo': return void game.undoHit(id);
      case 'manualFinish': return void game.manualFinish(id, msg.heldMs);
      case 'reset': return void game.reset();
      // Test hit: the same as the loop touching this player's wire. Only when enabled on /admin.
      case 'testHit':
        if (config.get().refTestButtons) game.key(config.get().keys[`p${id}`].hit);
        return;
      default:
    }
  }
}

// Time-driven transitions (GO, fuel running out, result screen ending).
setInterval(() => game.advance(), 20);
// Heartbeat: keeps phone clocks in step and lets clients notice a dropped connection.
setInterval(broadcastState, 1000);
// Page files changed (an update was copied in): tell every open page to reload.
setInterval(() => {
  const v = pageVersion();
  if (v === currentVersion) return;
  currentVersion = v;
  const msg = JSON.stringify({ t: 'reload', version: v });
  setTimeout(() => { for (const c of clients) if (c.role && c.ws.readyState === 1) c.ws.send(msg); }, 500);
}, 2000);

// Drop connections that stopped answering (phone left the Wi-Fi without closing).
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); clients.delete(c); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch { /* closed */ }
  }
}, 10000);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n! Port ${port} is already in use. Is the game already running in another window?`);
    console.error('  Close it, or start on another port:  set PORT=3001 && npm start\n');
  } else {
    console.error(err);
  }
  process.exit(1);
});

// No host given: Node listens on IPv6 and IPv4 together. Listening on 0.0.0.0 only
// made every "localhost" request on Windows wait ~2 s for IPv6 to fail first.
server.listen(port, () => {
  const u = urls();
  console.log('\n  Mission: Return to Station is running.\n');
  console.log(`  1. Connect the referee phones (QR codes):         ${u.connect}`);
  console.log(`  2. Display (this laptop, press F for fullscreen): ${u.display}`);
  console.log(`  Referee phone, Player 1:                          ${u.ref1}`);
  console.log(`  Referee phone, Player 2:                          ${u.ref2}`);
  console.log(`  Admin (this laptop only):                         ${u.admin}`);
  const others = listAddresses().filter((a) => a.address !== u.host);
  if (others.length) console.log(`\n  Other addresses on this laptop: ${others.map((a) => `${a.address} (${a.name})`).join(', ')}`);
  console.log('\n  Leave this window open. Press Ctrl+C to stop.\n');
  const noOpen = process.argv.includes('--no-open') || process.env.MRS_NO_OPEN === '1';
  if (!noOpen) {
    // Two tabs in the default browser: the QR codes (keep it open to reconnect a
    // phone later) and the display. The display opens second so it ends up in front.
    openTab(u.connect);
    setTimeout(() => openTab(u.display), 1500);
  }
});

function openTab(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

module.exports = { app, server, game };
