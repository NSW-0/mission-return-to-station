// Admin page (/admin, laptop only): settings, leaderboard, CSV export.

const $ = (sel, root = document) => root.querySelector(sel);
const form = $('#settings');

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function addFact(f = { text: '', source: '' }) {
  const node = $('#factTemplate').content.firstElementChild.cloneNode(true);
  $('[name=text]', node).value = f.text;
  $('[name=source]', node).value = f.source;
  $('.remove', node).addEventListener('click', () => node.remove());
  $('#facts').append(node);
}
$('#addFact').addEventListener('click', () => addFact());

/** A worked example so staff can see what the score numbers mean. */
function updateExample() {
  const pps = Number(form.elements.pointsPerSecond.value) || 0;
  const ppsh = Number(form.elements.pointsPerShield.value) || 0;
  const fuel = Number(form.elements.fuelSeconds.value) || 60;
  const time = Math.min(fuel, 34.2);
  const left = (fuel - time).toFixed(1);
  const score = Math.round((fuel - time) * pps) + 2 * ppsh;
  $('#scoreExample').textContent = `Example: docked at ${time} s with 2 shields left = ${left} × ${pps} + 2 × ${ppsh} = ${score} points.`;
}
for (const n of ['pointsPerSecond', 'pointsPerShield', 'fuelSeconds']) form.elements[n].addEventListener('input', updateExample);

async function loadInfo() {
  const info = await getJson('/api/info');
  const settings = await getJson('/api/settings');
  $('#urlDisplay').textContent = info.urls.display;
  $('#urlDisplay').href = info.urls.display;

  const select = $('#hostSelect');
  select.replaceChildren();
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = `Automatic (now ${settings.hostOverride ? 'overridden' : info.urls.host})`;
  select.append(auto);
  const seen = new Set();
  for (const a of info.addresses) {
    seen.add(a.address);
    const o = document.createElement('option');
    o.value = a.address;
    o.textContent = `${a.address} (${a.name})`;
    select.append(o);
  }
  if (settings.hostOverride && !seen.has(settings.hostOverride)) {
    const o = document.createElement('option');
    o.value = settings.hostOverride;
    o.textContent = `${settings.hostOverride} (saved, not found now)`;
    select.append(o);
  }
  fillForm(settings);
}

function fillForm(s) {
  for (const k of ['fuelSeconds', 'shields', 'hitCooldownMs', 'countdownSeconds', 'resultSeconds', 'falseStartSeconds', 'pointsPerSecond', 'pointsPerShield']) form.elements[k].value = s[k];
  updateExample();
  form.elements.hostOverride.value = s.hostOverride || '';
  form.elements.requireRefKey.checked = s.requireRefKey;
  form.elements.refTestButtons.checked = s.refTestButtons;
  form.elements.color_p1.value = s.colors.p1;
  form.elements.color_p2.value = s.colors.p2;
  for (const p of ['p1', 'p2']) for (const a of ['hit', 'dock', 'padOn', 'padOff']) form.elements[`k_${p}_${a}`].value = s.keys[p][a];
  $('#facts').replaceChildren();
  s.facts.forEach(addFact);
  form.dataset.port = s.port;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#saveMsg');
  const el = form.elements;
  const body = {
    fuelSeconds: Number(el.fuelSeconds.value),
    shields: Number(el.shields.value),
    hitCooldownMs: Number(el.hitCooldownMs.value),
    countdownSeconds: Number(el.countdownSeconds.value),
    resultSeconds: Number(el.resultSeconds.value),
    falseStartSeconds: Number(el.falseStartSeconds.value),
    pointsPerSecond: Number(el.pointsPerSecond.value),
    pointsPerShield: Number(el.pointsPerShield.value),
    port: Number(form.dataset.port),
    hostOverride: el.hostOverride.value,
    requireRefKey: el.requireRefKey.checked,
    refTestButtons: el.refTestButtons.checked,
    colors: { p1: el.color_p1.value, p2: el.color_p2.value },
    keys: { p1: {}, p2: {} },
    facts: [...document.querySelectorAll('#facts .fact')].map((f) => ({
      text: $('[name=text]', f).value, source: $('[name=source]', f).value,
    })),
  };
  for (const p of ['p1', 'p2']) for (const a of ['hit', 'dock', 'padOn', 'padOff']) body.keys[p][a] = el[`k_${p}_${a}`].value.trim();
  try {
    const res = await getJson('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    msg.className = 'ok';
    msg.textContent = 'Saved. New values apply from the next round.';
    fillForm(res.settings);
    await loadInfo();
  } catch (err) {
    msg.className = 'err';
    msg.textContent = `Not saved: ${err.message}`;
  }
});

$('#clearBoard').addEventListener('click', async () => {
  if (!confirm('Reset the scores? The top scores list will be empty. Race records stay in the CSV export.')) return;
  await getJson('/api/leaderboard/clear', { method: 'POST' });
  $('#resultsMsg').className = 'ok';
  $('#resultsMsg').textContent = 'Scores reset.';
  loadResults();
});

function td(text) {
  const c = document.createElement('td');
  c.textContent = text;
  return c;
}

async function loadResults() {
  const { races, leaderboard } = await getJson('/api/races');
  const board = $('#boardTable tbody');
  board.replaceChildren();
  leaderboard.forEach((e, i) => {
    const tr = document.createElement('tr');
    tr.append(td(i + 1), td(e.name), td(e.score ?? ''), td(`${(e.timeMs / 1000).toFixed(2)} s`), td(e.shieldsLeft), td(`Player ${e.player}`), td(e.raceId));
    board.append(tr);
  });
  if (!leaderboard.length) board.append(Object.assign(document.createElement('tr'), { innerHTML: '<td colspan="7">No dockings yet.</td>' }));
  const list = $('#raceTable tbody');
  list.replaceChildren();
  for (const r of [...races].reverse().slice(0, 30)) {
    const tr = document.createElement('tr');
    const players = r.players.map((p) => `${p.name}: ${p.result}${p.timeMs != null ? ` ${(p.timeMs / 1000).toFixed(2)} s, ${p.score} points` : ''}, ${p.hits} hits`).join('; ');
    const outcome = r.outcome === 'tie' ? 'Tie' : r.winnerName ? `${r.winnerName} (${r.outcome})` : r.outcome;
    tr.append(td(r.id), td(r.mode), td(players), td(outcome));
    list.append(tr);
  }
  if (!races.length) list.append(Object.assign(document.createElement('tr'), { innerHTML: '<td colspan="4">No races yet.</td>' }));
}

loadInfo().catch((err) => { $('#saveMsg').className = 'err'; $('#saveMsg').textContent = err.message; });
loadResults();
setInterval(loadResults, 5000);
