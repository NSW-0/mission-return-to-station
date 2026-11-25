// Loads the art in public/assets. The server says which files exist, so a missing
// file is never requested (no 404s) and is replaced by a simple drawing made here.

const SHIP_STATES = ['shield3', 'shield2', 'shield1', 'broken', 'winner'];

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // a broken file is treated as missing
    img.src = src;
  });
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Copy an image into a canvas no larger than max px, so drawing it every frame stays cheap. */
function fit(img, max) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = canvas(Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ------------------------------------------------------------------ placeholders

function hexPath(g, cx, cy, r) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  g.closePath();
}

function drawSatellite(g, size, color) {
  const c = size / 2;
  g.save();
  g.translate(c, c);
  g.rotate(-0.6);
  // solar panels
  for (const side of [-1, 1]) {
    g.fillStyle = '#1d2f6b';
    g.strokeStyle = '#8fa6e8';
    g.lineWidth = size * 0.006;
    const x = side < 0 ? -size * 0.42 : size * 0.12;
    g.fillRect(x, -size * 0.07, size * 0.3, size * 0.14);
    g.strokeRect(x, -size * 0.07, size * 0.3, size * 0.14);
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(x + (i * size * 0.3) / 4, -size * 0.07);
      g.lineTo(x + (i * size * 0.3) / 4, size * 0.07);
      g.stroke();
    }
  }
  // body
  g.fillStyle = '#d7dcea';
  g.fillRect(-size * 0.12, -size * 0.1, size * 0.24, size * 0.2);
  g.fillStyle = color;
  g.fillRect(-size * 0.12, -size * 0.02, size * 0.24, size * 0.04);
  // dish
  g.fillStyle = '#eef2ff';
  g.beginPath();
  g.arc(0, -size * 0.15, size * 0.06, Math.PI, 0);
  g.fill();
  g.restore();
}

function drawBubble(g, size, color, cracked) {
  const c = size / 2;
  const r = size * 0.42;
  const grad = g.createRadialGradient(c, c, r * 0.6, c, c, r);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, color + '88');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = size * 0.012;
  g.setLineDash(cracked ? [size * 0.08, size * 0.05] : []);
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
}

function placeholderShip(player, state, color) {
  const size = 512;
  const c = canvas(size);
  const g = c.getContext('2d');
  if (state === 'shield3') drawBubble(g, size, color, false);
  if (state === 'shield2') drawBubble(g, size, color, true);
  drawSatellite(g, size, color);
  if (state === 'broken') {
    g.fillStyle = 'rgba(150,150,160,0.6)';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(size * (0.62 + i * 0.03), size * (0.42 - i * 0.04), size * (0.03 + i * 0.01), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ff7a3d';
    g.beginPath();
    g.arc(size * 0.6, size * 0.45, size * 0.025, 0, Math.PI * 2);
    g.fill();
  }
  if (state === 'winner') {
    g.fillStyle = '#ffd76a';
    for (const [x, y] of [[0.3, 0.25], [0.72, 0.28], [0.68, 0.7]]) {
      g.save();
      g.translate(size * x, size * y);
      g.rotate(Math.PI / 4);
      g.fillRect(-size * 0.015, -size * 0.015, size * 0.03, size * 0.03);
      g.restore();
    }
  }
  return c;
}

function placeholderDebris(kind, seed) {
  const size = 128;
  const c = canvas(size);
  const g = c.getContext('2d');
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.translate(size / 2, size / 2);
  if (kind === 'meteoroid') {
    g.fillStyle = '#6b5f57';
    g.beginPath();
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = size * (0.3 + rnd() * 0.15);
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.fillStyle = '#4a403a';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.arc((rnd() - 0.5) * size * 0.4, (rnd() - 0.5) * size * 0.4, size * (0.04 + rnd() * 0.05), 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // a torn metal panel
    g.rotate(rnd() * Math.PI);
    g.fillStyle = '#9aa3b8';
    g.strokeStyle = '#c8cfdf';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-size * 0.35, -size * 0.18);
    g.lineTo(size * 0.3, -size * 0.25);
    g.lineTo(size * 0.38, size * 0.05);
    g.lineTo(size * 0.1, size * 0.12);
    g.lineTo(size * 0.05, size * 0.28);
    g.lineTo(-size * 0.3, size * 0.2);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = '#5f6a85';
    g.beginPath();
    g.moveTo(-size * 0.2, -size * 0.1);
    g.lineTo(size * 0.2, -size * 0.14);
    g.stroke();
  }
  return c;
}

function placeholderStation() {
  const w = 512;
  const h = 320;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.translate(w / 2, h / 2);
  // truss
  g.fillStyle = '#8f98ad';
  g.fillRect(-w * 0.45, -6, w * 0.9, 12);
  // solar arrays
  for (const x of [-0.42, -0.3, 0.22, 0.34]) {
    g.fillStyle = '#25356e';
    g.fillRect(w * x, -h * 0.38, w * 0.09, h * 0.3);
    g.fillRect(w * x, h * 0.08, w * 0.09, h * 0.3);
  }
  // modules
  g.fillStyle = '#dfe4f0';
  g.fillRect(-w * 0.12, -h * 0.09, w * 0.24, h * 0.18);
  g.fillRect(-w * 0.04, -h * 0.25, w * 0.08, h * 0.5);
  // docking port glow
  g.fillStyle = '#7dffb2';
  g.beginPath();
  g.arc(-w * 0.12, 0, 8, 0, Math.PI * 2);
  g.fill();
  return c;
}

/** A simple drawn black hole, used only when blackhole.png is missing. Same layout as the picture. */
function placeholderBlackHole() {
  const size = 1024;
  const c = canvas(size);
  const g = c.getContext('2d');
  const cx = size / 2;
  const ring = size * 0.2875;
  const glow = g.createRadialGradient(cx, cx, ring * 0.5, cx, cx, size / 2);
  glow.addColorStop(0, 'rgba(255,140,60,0.55)');
  glow.addColorStop(0.45, 'rgba(255,90,40,0.18)');
  glow.addColorStop(1, 'rgba(255,60,30,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = 'rgba(255,' + (190 - i * 20) + ',' + (120 - i * 15) + ',' + (0.75 - i * 0.1) + ')';
    g.lineWidth = ring * 0.07;
    g.beginPath();
    g.arc(cx, cx, ring * (0.62 + i * 0.07), 0, Math.PI * 2);
    g.stroke();
  }
  g.save();
  g.translate(cx, cx);
  g.scale(1, 0.18);
  const disk = g.createRadialGradient(0, 0, ring * 0.5, 0, 0, size * 0.48);
  disk.addColorStop(0, 'rgba(255,220,160,0.9)');
  disk.addColorStop(1, 'rgba(255,80,30,0)');
  g.fillStyle = disk;
  g.beginPath();
  g.arc(0, 0, size * 0.48, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.fillStyle = '#05030c';
  g.beginPath();
  g.arc(cx, cx, ring * 0.55, 0, Math.PI * 2);
  g.fill();
  return c;
}

function placeholderSpark() {
  const size = 64;
  const c = canvas(size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.3, 'rgba(255,200,90,0.9)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Shield icon for the HUD as a data URL (used only when shield_full/shield_broken.png are missing). */
function placeholderShieldIcon(full) {
  const size = 96;
  const c = canvas(size);
  const g = c.getContext('2d');
  hexPath(g, size / 2, size / 2, size * 0.44);
  g.fillStyle = full ? 'rgba(238,242,255,0.95)' : 'rgba(238,242,255,0.12)';
  g.fill();
  g.lineWidth = size * 0.06;
  g.strokeStyle = full ? 'rgba(238,242,255,1)' : 'rgba(238,242,255,0.45)';
  g.stroke();
  if (!full) {
    g.beginPath();
    g.moveTo(size * 0.35, size * 0.2);
    g.lineTo(size * 0.52, size * 0.45);
    g.lineTo(size * 0.42, size * 0.58);
    g.lineTo(size * 0.62, size * 0.82);
    g.stroke();
  }
  return c.toDataURL();
}

// ------------------------------------------------------------------ public

export async function loadAssets(files, colors) {
  const have = new Set(files || []);
  const get = (name) => (have.has(name) ? loadImage(`/assets/${name}`) : Promise.resolve(null));

  const names = ['background.png', 'blackhole.png', 'satellite_p1.png', 'satellite_p2.png', 'debris_1.png', 'debris_2.png', 'debris_3.png',
    'meteoroid_1.png', 'meteoroid_2.png', 'shield_full.png', 'shield_broken.png', 'spark.png', 'station.png', 'logo.png'];
  const shipNames = [];
  for (const p of [1, 2]) for (const s of SHIP_STATES) shipNames.push(`ship/p${p}_${s}.png`);
  const loaded = await Promise.all([...names, ...shipNames].map(get));
  const img = {};
  [...names, ...shipNames].forEach((n, i) => { img[n] = loaded[i]; });

  const ships = { 1: {}, 2: {} };
  for (const p of [1, 2]) {
    const sat = img[`satellite_p${p}.png`] ? fit(img[`satellite_p${p}.png`], 640) : null;
    for (const s of SHIP_STATES) {
      const own = img[`ship/p${p}_${s}.png`];
      // Order: ship state art -> satellite_pN.png -> drawn placeholder.
      ships[p][s] = own ? fit(own, 640) : sat || placeholderShip(p, s, colors[`p${p}`]);
    }
  }

  const debris = [];
  ['debris_1.png', 'debris_2.png', 'debris_3.png'].forEach((n, i) => debris.push(img[n] ? fit(img[n], 160) : placeholderDebris('panel', i + 1)));
  ['meteoroid_1.png', 'meteoroid_2.png'].forEach((n, i) => debris.push(img[n] ? fit(img[n], 160) : placeholderDebris('meteoroid', i + 7)));

  return {
    ships,
    debris,
    background: img['background.png'] ? fit(img['background.png'], 1920) : null,
    blackhole: img['blackhole.png'] ? fit(img['blackhole.png'], 1400) : placeholderBlackHole(),
    spark: img['spark.png'] ? fit(img['spark.png'], 96) : placeholderSpark(),
    station: img['station.png'] ? fit(img['station.png'], 720) : placeholderStation(),
    logo: img['logo.png'] ? img['logo.png'].src : null,
    shieldFull: img['shield_full.png'] ? img['shield_full.png'].src : placeholderShieldIcon(true),
    shieldBroken: img['shield_broken.png'] ? img['shield_broken.png'].src : placeholderShieldIcon(false),
    usingShipArt: { 1: Boolean(img['ship/p1_shield3.png']), 2: Boolean(img['ship/p2_shield3.png']) },
  };
}

/** Which ship picture shows a player's state. */
export function shipStateFor(p) {
  if (!p) return 'shield3';
  if (p.status === 'docked') return 'winner';
  if (p.status === 'shieldsDown' || p.shields <= 0) return 'broken';
  if (p.shields >= p.maxShields) return 'shield3';
  if (p.shields === 1) return 'shield1';
  return 'shield2';
}
