// The flying scene behind the HUD: one canvas, two halves.
// Theme: escape the black hole. Each half has a black hole at its outer edge that
// grows as the fuel runs down; docking means escaping (it shrinks away) and running
// out of fuel means being swallowed. Player 2's half is drawn as a mirror image of
// Player 1's, so both players see exactly the same thing.
// The website cannot know where the loop is on the wire, so nothing here pretends
// to show progress along the track: the ship stays near the middle of its half and
// drifts gently while stars and debris stream past, back into the black hole.

import { shipStateFor } from './assets.js';

// Ships point up and to the right, so the world streams down and to the left.
const DIR = { x: -Math.cos(0.6), y: Math.sin(0.6) };
const STAR_LAYERS = [
  { count: 70, size: 1, speed: 0.12, alpha: 0.45 },
  { count: 45, size: 1.6, speed: 0.32, alpha: 0.7 },
  { count: 18, size: 2.4, speed: 0.8, alpha: 0.95 },
];
const IMPACT_APPROACH_MS = 90;
// The bright ring's radius as a fraction of the black hole picture's width
// (see tools/prepare_blackhole.py).
const RING_FRACTION = 0.25;

function rand(a, b) { return a + Math.random() * (b - a); }

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

class Half {
  constructor(player) {
    this.player = player;
    this.stars = STAR_LAYERS.map((l) => Array.from({ length: l.count }, () => ({ x: Math.random(), y: Math.random() })));
    this.speed = 0.05;
    this.passing = [];
    this.nextPassAt = 0;
    this.impacts = [];
    this.particles = [];
    this.shakeUntil = 0;
    this.shakeStrength = 0;
    this.flashAt = -1e9;
    this.flashColor = '255,77,106';
    this.drift = Math.random() * 10;
    this.dockedAt = null;
    this.failedAt = null;
    this.tumble = 0;
    this.view = null; // latest player snapshot
    this.phase = 'idle';
    this.winnerGlow = false;
    this.smokeAcc = 0;
  }
}

export class Scene {
  constructor(canvasEl, assets, colors) {
    this.canvas = canvasEl;
    this.g = canvasEl.getContext('2d', { alpha: false });
    this.assets = assets;
    this.colors = colors;
    this.halves = { 1: new Half(1), 2: new Half(2) };
    this.bgCache = null;
    this.w = 0;
    this.h = 0;
    this.t = 0;
    this.state = null;
    this.clock = () => performance.now(); // replaced by the server clock (display.js)
  }

  setAssets(assets) { this.assets = assets; }

  setColors(colors) {
    this.colors = colors;
    this.bgCache = null;
  }

  resize(cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    // Cap the pixel count so a 4K screen does not drop below 60 fps.
    const scale = Math.min(dpr, Math.sqrt(2400000 / Math.max(1, cssW * cssH)));
    this.canvas.width = Math.round(cssW * scale);
    this.canvas.height = Math.round(cssH * scale);
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    this.bgCache = null;
  }

  /** Feed the latest race snapshot. */
  update(state) {
    this.state = state;
    for (const id of [1, 2]) {
      const half = this.halves[id];
      const p = state.players[id];
      const prev = half.view;
      half.view = p;
      half.phase = state.phase;
      half.winnerGlow = state.phase === 'result' && state.result && state.result.winner === id;
      if (p.status === 'docked' && (!prev || prev.status !== 'docked')) half.dockedAt = this.t;
      if (p.status !== 'docked') half.dockedAt = null;
      const failed = p.status === 'shieldsDown' || p.status === 'outOfFuel';
      if (failed && half.failedAt == null) half.failedAt = this.t;
      if (!failed) { half.failedAt = null; half.tumble = 0; }
    }
  }

  /** A hit: a piece of debris strikes the ship, the half flashes and shakes. */
  hit(player) {
    const half = this.halves[player];
    const angle = -0.6 + rand(-0.5, 0.5); // comes from ahead of the ship
    half.impacts.push({ t0: this.t, angle, sprite: this.pick(this.assets.debris), spin: rand(-6, 6), hitDone: false });
  }

  pulse(player, color) {
    const half = this.halves[player];
    half.flashAt = this.t;
    half.flashColor = color;
  }

  pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  shakeOffset(player) {
    const half = this.halves[player];
    if (this.t > half.shakeUntil) return { x: 0, y: 0 };
    const k = (half.shakeUntil - this.t) / 380;
    const a = half.shakeStrength * k;
    return { x: rand(-a, a), y: rand(-a, a) };
  }

  // ---------------------------------------------------------------- drawing

  backgroundFor(id, hw) {
    if (!this.bgCache) this.bgCache = {};
    if (this.bgCache[id]) return this.bgCache[id];
    const c = document.createElement('canvas');
    c.width = hw;
    c.height = this.h;
    const g = c.getContext('2d');
    g.fillStyle = '#060818';
    g.fillRect(0, 0, hw, this.h);
    const [r, gg, b] = hexToRgb(this.colors[`p${id}`]);
    // Two soft nebula clouds in the player's colour, very faint.
    for (const [x, y, rad, a] of [[0.15, 0.25, 0.7, 0.09], [0.85, 0.85, 0.6, 0.06]]) {
      const grad = g.createRadialGradient(hw * x, this.h * y, 0, hw * x, this.h * y, this.h * rad);
      grad.addColorStop(0, `rgba(${r},${gg},${b},${a})`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, hw, this.h);
    }
    const vignette = g.createRadialGradient(hw / 2, this.h / 2, this.h * 0.3, hw / 2, this.h / 2, this.h);
    vignette.addColorStop(0, 'rgba(4,6,20,0)');
    vignette.addColorStop(1, 'rgba(2,3,10,0.85)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, hw, this.h);
    this.bgCache[id] = c;
    return c;
  }

  targetSpeed(half) {
    const p = half.view;
    if (!p) return 0.05;
    if (half.phase === 'racing' || half.phase === 'result') {
      if (p.status === 'racing') return 0.32;
      if (p.status === 'docked') return 0.015;
      if (p.status === 'outOfFuel') return 0.0;
      if (p.status === 'shieldsDown') return 0.04;
    }
    if (half.phase === 'countdown') return 0.08;
    return 0.05;
  }

  frame(dtMs) {
    const dt = Math.min(dtMs, 50) / 1000;
    this.t += dtMs;
    const g = this.g;
    const hw = Math.floor(this.w / 2);
    for (const id of [1, 2]) {
      const half = this.halves[id];
      const x0 = id === 1 ? 0 : this.w - hw;
      g.save();
      g.beginPath();
      g.rect(x0, 0, hw, this.h);
      g.clip();
      const shake = this.shakeOffset(id);
      g.translate(x0 + shake.x, shake.y);
      if (id === 2) {
        // Mirror image of Player 1's half: black hole at the right edge, ship facing left.
        g.translate(hw, 0);
        g.scale(-1, 1);
      }
      this.drawHalf(g, half, hw, dt);
      g.restore();
    }
    // Centre seam: a thin bright line between the two flights.
    g.fillStyle = 'rgba(238,242,255,0.18)';
    g.fillRect(Math.floor(this.w / 2) - 1, 0, 2, this.h);
  }

  drawHalf(g, half, hw, dt) {
    const H = this.h;
    const target = this.targetSpeed(half);
    half.speed += (target - half.speed) * Math.min(1, dt * (target > half.speed ? 2.5 : 1.2));
    const v = half.speed * H; // px per second for a speed-1 layer

    // background
    if (this.assets.background) {
      const bg = this.assets.background;
      const s = Math.max(hw / bg.width, H / bg.height) * 1.15;
      const bw = bg.width * s;
      const bh = bg.height * s;
      half.bgX = ((half.bgX || 0) + DIR.x * v * 0.03 * dt) % bw;
      g.drawImage(bg, half.bgX, (H - bh) / 2, bw, bh);
      g.drawImage(bg, half.bgX + bw, (H - bh) / 2, bw, bh);
    } else {
      g.drawImage(this.backgroundFor(half.player, hw), 0, 0);
    }

    // the black hole behind the ship, growing with the race clock
    this.drawBlackHole(g, half, hw, dt);

    // stars, far and mid layers
    this.drawStars(g, half, hw, dt, v, 0, 2);

    // ambient debris streaming past (never touching the ship)
    this.updatePassing(half, hw, dt, v);
    for (const d of half.passing) if (!d.front) this.drawPassing(g, d);

    // In the lobby the ship sits higher and smaller so the QR code and the
    // leaderboard have room; it glides into racing position at the countdown.
    const lobbyTarget = half.phase === 'idle' || half.phase === 'arming' ? 1 : 0;
    half.lobbyK = half.lobbyK == null ? lobbyTarget : half.lobbyK + (lobbyTarget - half.lobbyK) * Math.min(1, dt * 3);
    half.sizeK = 1 - 0.2 * half.lobbyK;

    // station slides in when docked
    const cx = hw * 0.56;
    const cy = H * (0.55 - 0.14 * half.lobbyK);
    if (half.dockedAt != null) {
      const k = Math.min(1, (this.t - half.dockedAt) / 1400);
      const e = 1 - (1 - k) ** 3;
      const st = this.assets.station;
      // Glides in from the right edge to sit just ahead of the ship, below the
      // name and the result text.
      const sw = H * 0.36;
      const sh = (st.height / st.width) * sw;
      const sx = hw * (1.2 - 0.36 * e);
      const sy = H * (0.36 + 0.06 * e);
      g.globalAlpha = Math.min(1, k * 2);
      g.drawImage(st, sx - sw / 2, sy - sh / 2, sw, sh);
      g.globalAlpha = 1;
    }

    // the ship
    this.drawShip(g, half, cx, cy, hw, H, dt);

    for (const d of half.passing) if (d.front) this.drawPassing(g, d);
    this.drawImpacts(g, half, cx, cy, H);
    this.drawParticles(g, half, dt);

    // nearest star layer in front
    this.drawStars(g, half, hw, dt, v, 2, 3);

    // hit flash
    const since = this.t - half.flashAt;
    if (since < 420) {
      g.fillStyle = `rgba(${half.flashColor},${0.42 * (1 - since / 420)})`;
      g.fillRect(0, 0, hw, H);
    }
  }

  /** Ring radius in px the black hole should have right now. */
  holeTarget(half, hw) {
    const p = half.view;
    const s = this.state;
    if (!p || !s) return hw * 0.26;
    const phase = half.phase;
    if (phase === 'idle' || phase === 'arming' || p.status === 'sittingOut') {
      return hw * 0.26 * (1 + 0.03 * Math.sin(this.t / 900)); // slow breathing while waiting
    }
    if (phase === 'countdown') return hw * 0.3;
    if (p.status === 'docked') return hw * 0.14;   // escaped: it falls away behind
    if (p.status === 'outOfFuel') return hw * 1.7; // swallowed
    // Grows continuously, every frame, from GO until the fuel runs out (no steps).
    // It is driven by the fraction of fuel used, so it fills the whole race whatever
    // the fuel time is set to. Frozen when shields go down.
    const fuel = s.fuelMs || 60000;
    const elapsed = p.doneAt != null ? p.lastedMs : this.clock() - s.goAt;
    const progress = Math.max(0, Math.min(1, elapsed / fuel));
    return hw * (0.3 + 0.95 * progress ** 1.3);
  }

  drawBlackHole(g, half, hw, dt) {
    const target = this.holeTarget(half, hw);
    if (half.holeR == null) half.holeR = target;
    const swallowing = half.view && half.view.status === 'outOfFuel';
    const rate = target < half.holeR ? 1.4 : swallowing ? 1.1 : 3;
    half.holeR += (target - half.holeR) * Math.min(1, dt * rate);
    half.holeX = -0.02 * hw;
    half.holeY = this.h * 0.52;
    const size = half.holeR / RING_FRACTION;
    g.drawImage(this.assets.blackhole, half.holeX - size / 2, half.holeY - size / 2, size, size);
  }

  drawStars(g, half, hw, dt, v, from, to) {
    const H = this.h;
    for (let li = from; li < to; li++) {
      const layer = STAR_LAYERS[li];
      const dx = (DIR.x * v * layer.speed * dt) / hw;
      const dy = (DIR.y * v * layer.speed * dt) / H;
      const streak = half.speed * layer.speed * H * 0.12;
      g.fillStyle = `rgba(238,242,255,${layer.alpha})`;
      g.strokeStyle = `rgba(238,242,255,${layer.alpha * 0.8})`;
      g.lineWidth = layer.size;
      const size = layer.size * (H / 900);
      for (const s of half.stars[li]) {
        s.x += dx;
        s.y += dy;
        if (s.x < -0.02) s.x += 1.04;
        if (s.y > 1.02) s.y -= 1.04;
        const px = s.x * hw;
        const py = s.y * H;
        if (streak > 3) {
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px - DIR.x * streak, py - DIR.y * streak);
          g.stroke();
        } else {
          g.fillRect(px, py, size, size);
        }
      }
    }
  }

  updatePassing(half, hw, dt, v) {
    const H = this.h;
    const racing = half.view && half.view.status === 'racing';
    if (this.t >= half.nextPassAt) {
      half.nextPassAt = this.t + (racing ? rand(700, 1800) : rand(2500, 5000));
      const front = Math.random() < 0.3;
      // Spawn ahead (top or right edge) in a lane that misses the ship.
      const lane = (Math.random() < 0.5 ? -1 : 1) * rand(0.28, 0.55) * H;
      const nx = -DIR.y;
      const ny = DIR.x; // perpendicular to the flight direction
      const start = { x: hw * 0.5 - DIR.x * H * 0.95 + nx * lane, y: H * 0.55 - DIR.y * H * 0.95 + ny * lane };
      half.passing.push({
        x: start.x, y: start.y,
        size: H * (front ? rand(0.07, 0.11) : rand(0.025, 0.055)),
        speed: front ? rand(1.4, 2.0) : rand(0.5, 0.9),
        rot: rand(0, 6.28), spin: rand(-1.5, 1.5),
        sprite: this.pick(this.assets.debris), front,
        alpha: front ? 1 : 0.55,
      });
    }
    for (const d of half.passing) {
      d.x += DIR.x * v * d.speed * dt;
      d.y += DIR.y * v * d.speed * dt;
      d.rot += d.spin * dt;
    }
    half.passing = half.passing.filter((d) => d.x > -H * 0.3 && d.y < H * 1.3);
  }

  drawPassing(g, d) {
    g.save();
    g.globalAlpha = d.alpha;
    g.translate(d.x, d.y);
    g.rotate(d.rot);
    g.drawImage(d.sprite, -d.size / 2, -d.size / 2, d.size, d.size);
    g.restore();
  }

  drawShip(g, half, cx, cy, hw, H, dt) {
    const p = half.view;
    const sprite = this.assets.ships[half.player][shipStateFor(p)];
    let size = Math.min(hw * 0.62, H * 0.52) * (half.sizeK || 1);
    const tt = this.t / 1000 + half.drift;
    let x = cx + Math.sin(tt * 0.55) * hw * 0.025;
    let y = cy + Math.sin(tt * 0.8 + 1.3) * H * 0.02;
    let rot = Math.sin(tt * 0.45) * 0.035;
    let alpha = 1;

    if (p && p.status === 'shieldsDown' && half.failedAt != null) {
      half.tumble += dt * 0.5;
      rot += half.tumble;
      y += Math.min(H * 0.06, half.tumble * H * 0.03);
      half.smokeAcc += dt;
      if (half.smokeAcc > 0.08) {
        half.smokeAcc = 0;
        half.particles.push({ x: x + rand(-10, 10), y: y + rand(-10, 10), vx: rand(-20, 20), vy: rand(-40, -10), life: 1.6, age: 0, smoke: true, size: H * rand(0.015, 0.03) });
      }
    }
    if (p && p.status === 'outOfFuel' && half.failedAt != null && half.holeX != null) {
      // Out of fuel: the black hole pulls the ship in, spinning and shrinking.
      const k = Math.min(1, (this.t - half.failedAt) / 3000);
      const e = k * k;
      x += (half.holeX - x) * e * 0.9;
      y += (half.holeY - y) * e * 0.9;
      size *= 1 - 0.88 * e;
      rot += e * 7;
      alpha = 1 - 0.75 * e;
    }
    if (p && p.active === false && half.phase !== 'idle' && half.phase !== 'arming') alpha = 0.25; // sitting out a solo race

    if (half.winnerGlow) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t / 260);
      const [r, gg, b] = hexToRgb(this.colors[`p${half.player}`]);
      const grad = g.createRadialGradient(x, y, size * 0.15, x, y, size * 0.75);
      grad.addColorStop(0, `rgba(${r},${gg},${b},${0.35 + 0.2 * pulse})`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(x - size, y - size, size * 2, size * 2);
    }

    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.rotate(rot);
    g.drawImage(sprite, -size / 2, -size / 2, size, size);
    g.restore();
    half.shipPos = { x, y, size };
  }

  drawImpacts(g, half, cx, cy, H) {
    const pos = half.shipPos || { x: cx, y: cy, size: H * 0.5 };
    const r0 = pos.size * 0.95;
    const r1 = pos.size * 0.3; // contact radius: the shield surface
    half.impacts = half.impacts.filter((im) => this.t - im.t0 < 1000);
    for (const im of half.impacts) {
      const age = this.t - im.t0;
      const ux = Math.cos(im.angle);
      const uy = Math.sin(im.angle);
      let dist;
      let alpha = 1;
      if (age < IMPACT_APPROACH_MS) {
        dist = r0 + (r1 - r0) * (age / IMPACT_APPROACH_MS);
      } else {
        if (!im.hitDone) {
          im.hitDone = true;
          half.flashAt = this.t;
          half.flashColor = '255,77,106';
          half.shakeUntil = this.t + 380;
          half.shakeStrength = H * 0.018;
          const hx = pos.x + ux * r1;
          const hy = pos.y + uy * r1;
          for (let i = 0; i < 26; i++) {
            const a = im.angle + rand(-1.3, 1.3);
            const sp = rand(120, 520) * (H / 900);
            half.particles.push({ x: hx, y: hy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.7), age: 0, size: H * rand(0.012, 0.03) });
          }
        }
        const k = (age - IMPACT_APPROACH_MS) / (1000 - IMPACT_APPROACH_MS);
        dist = r1 + k * pos.size * 1.1;
        alpha = 1 - k;
      }
      const size = H * 0.08;
      g.save();
      g.globalAlpha = Math.max(0, alpha);
      g.translate(pos.x + ux * dist, pos.y + uy * dist);
      g.rotate((age / 1000) * im.spin);
      g.drawImage(im.sprite, -size / 2, -size / 2, size, size);
      g.restore();
    }
  }

  drawParticles(g, half, dt) {
    const spark = this.assets.spark;
    const alive = [];
    for (const p of half.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      const k = 1 - p.age / p.life;
      if (p.smoke) {
        g.fillStyle = `rgba(140,140,155,${0.35 * k})`;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (2 - k), 0, Math.PI * 2);
        g.fill();
      } else {
        g.globalAlpha = k;
        const s = p.size * (0.6 + k);
        g.drawImage(spark, p.x - s / 2, p.y - s / 2, s, s);
        g.globalAlpha = 1;
      }
      alive.push(p);
    }
    half.particles = alive.length > 300 ? alive.slice(-300) : alive;
  }
}
