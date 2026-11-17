'use strict';

/* =========================================================================
 * Konfiguration
 * ========================================================================= */
const API_BASES = [
  'https://v6.bvg.transport.rest',
  'https://v6.vbb.transport.rest', // Fallback, gleiche Haltestellen-IDs
];
const STORAGE_KEY = 'bvg-favoriten-v1';
const DEPARTURE_COUNT = 3;          // Anzahl angezeigter Abfahrten
const REFRESH_MS = 30_000;          // Auto-Aktualisierung geöffneter Stationen
const REQUEST_TIMEOUT_MS = 12_000;

/* =========================================================================
 * API
 * ========================================================================= */
let preferredBase = 0;

async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  let lastErr;
  for (let i = 0; i < API_BASES.length; i++) {
    const idx = (preferredBase + i) % API_BASES.length;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASES[idx]}${path}${qs ? '?' + qs : ''}`, { signal: ctrl.signal });
      if (res.status === 429) throw new Error('Zu viele Anfragen – bitte kurz warten.');
      if (!res.ok) throw new Error(`API-Fehler ${res.status}`);
      const data = await res.json();
      preferredBase = idx;
      return data;
    } catch (err) {
      lastErr = err.name === 'AbortError' ? new Error('Zeitüberschreitung bei der API.') : err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('API nicht erreichbar.');
}

function searchStops(query) {
  return apiGet('/locations', {
    query, results: 8, stops: true, addresses: false, poi: false, fuzzy: true, linesOfStops: false,
  }).then(list => list.filter(l => l.type === 'stop' || l.type === 'station'));
}

async function getDepartures(stopId, { direction, duration = 60 } = {}) {
  const data = await apiGet(`/stops/${encodeURIComponent(stopId)}/departures`, {
    direction, duration, remarks: false, linesOfStops: false,
  });
  const deps = Array.isArray(data) ? data : (data.departures || []);
  return deps.sort((a, b) => depTime(a) - depTime(b));
}

/* Nächste N Abfahrten eines Favoriten (ausgefallene werden zusätzlich angezeigt) */
async function getFavDepartures(fav) {
  for (const duration of [120, 360]) {
    const all = await getDepartures(fav.stop.id, { direction: fav.dir.id, duration });
    const matching = all.filter(d => matchesLines(fav, d));
    const result = [];
    let running = 0;
    for (const d of matching) {
      result.push(d);
      if (!d.cancelled) running++;
      if (running >= DEPARTURE_COUNT) break;
    }
    if (running >= DEPARTURE_COUNT || duration === 360) return result;
  }
  return [];
}

function matchesLines(fav, dep) {
  if (!fav.lines || fav.lines.length === 0) return true;
  return fav.lines.some(l => l.name === dep.line?.name);
}

/* =========================================================================
 * Hilfsfunktionen
 * ========================================================================= */
const $ = sel => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function cleanName(name) {
  return String(name || '').replace(/\s*\(Berlin\)\s*$/i, '').trim();
}

function depTime(d) {
  return new Date(d.when || d.plannedWhen).getTime();
}

function fmtClock(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  });
}

function lineBadge(line) {
  const product = line?.product || '';
  return `<span class="line ${esc(product)}">${esc(line?.name || '?')}</span>`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* =========================================================================
 * Speicher
 * ========================================================================= */
function loadFavs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveFavs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
  } catch {
    alert('Favoriten konnten nicht gespeichert werden (Browser-Speicher nicht verfügbar).');
  }
}

let favs = loadFavs();

/* =========================================================================
 * Favoritenliste
 * ========================================================================= */
const openIds = new Set();
const depState = {};   // favId -> { loading, deps, error, updatedAt }
const refreshTimers = {};

function renderList() {
  const list = $('#favList');
  $('#emptyState').hidden = favs.length > 0;
  list.innerHTML = favs.map((f, i) => `
    <li class="fav ${openIds.has(f.id) ? 'open' : ''}" data-id="${esc(f.id)}">
      <button class="fav-head" type="button" data-action="toggle" aria-expanded="${openIds.has(f.id)}">
        <div class="fav-main">
          <div class="fav-title">${esc(f.label || cleanName(f.stop.name))}</div>
          <div class="fav-sub">
            ${f.label ? esc(cleanName(f.stop.name)) + ' · ' : ''}<span class="arrow">→</span> Richtung ${esc(cleanName(f.dir.name))}
          </div>
          ${f.lines?.length ? `<div class="fav-lines">${f.lines.map(lineBadge).join('')}</div>` : ''}
        </div>
        <span class="chev" aria-hidden="true">›</span>
      </button>
      ${openIds.has(f.id) ? `
        <div class="fav-body">
          <div class="fav-content">${renderDepartures(f.id)}</div>
          <div class="fav-tools">
            <span class="updated">${renderUpdated(f.id)}</span>
            <span class="tools">
              <button class="icon-btn" data-action="refresh" title="Aktualisieren" aria-label="Aktualisieren">↻</button>
              <button class="icon-btn" data-action="up" title="Nach oben" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button class="icon-btn" data-action="down" title="Nach unten" aria-label="Nach unten" ${i === favs.length - 1 ? 'disabled' : ''}>▼</button>
              <button class="icon-btn" data-action="edit" title="Bearbeiten" aria-label="Bearbeiten">✎</button>
              <button class="icon-btn" data-action="delete" title="Löschen" aria-label="Löschen">🗑</button>
            </span>
          </div>
        </div>` : ''}
    </li>`).join('');
}

function renderUpdated(id) {
  const s = depState[id];
  if (!s?.updatedAt) return '';
  return `Stand ${fmtClock(new Date(s.updatedAt).toISOString())}`;
}

function renderDepartures(id) {
  const s = depState[id];
  if (!s || (s.loading && !s.deps)) {
    return `<div class="status"><span class="spinner"></span>Lade Abfahrten …</div>`;
  }
  if (s.error && !s.deps) {
    return `<div class="status error">${esc(s.error)}</div>`;
  }
  if (!s.deps.length) {
    return `<div class="status">Keine Abfahrten in dieser Richtung in den nächsten 6 Stunden.</div>`;
  }
  const now = Date.now();
  return `<ul class="deps">${s.deps.map(d => renderDeparture(d, now)).join('')}</ul>` +
    (s.error ? `<div class="status error">Aktualisierung fehlgeschlagen: ${esc(s.error)}</div>` : '');
}

function renderDeparture(d, now) {
  const mins = Math.round((depTime(d) - now) / 60000);
  const inText = d.cancelled ? 'Ausfall' : (mins <= 0 ? 'jetzt' : `${mins} Min`);
  const realtime = d.delay !== null && d.delay !== undefined;
  const delayMin = realtime ? Math.round(d.delay / 60) : null;

  let delayHtml;
  if (d.cancelled) delayHtml = `<span class="delay bad">fällt aus</span>`;
  else if (!realtime) delayHtml = `<span class="delay none" title="Keine Echtzeitdaten">planmäßig</span>`;
  else if (delayMin === 0) delayHtml = `<span class="delay ok">pünktlich</span>`;
  else if (delayMin < 0) delayHtml = `<span class="delay early">${delayMin} Min</span>`;
  else delayHtml = `<span class="delay ${delayMin >= 3 ? 'bad' : 'warn'}">+${delayMin} Min</span>`;

  const planned = fmtClock(d.plannedWhen);
  const actual = fmtClock(d.when);
  const clock = (actual && actual !== planned)
    ? `<s>${planned}</s> ${actual}`
    : planned;

  const platform = d.platform || d.plannedPlatform;
  const meta = [
    platform ? (d.line?.product === 'bus' || d.line?.product === 'tram' ? platform : `Gleis ${platform}`) : '',
  ].filter(Boolean).join(' · ');

  return `
    <li class="dep ${d.cancelled ? 'cancelled' : ''}">
      ${lineBadge(d.line)}
      <div class="dep-info">
        <div class="dep-dir">${esc(cleanName(d.direction || d.destination?.name))}</div>
        <div class="dep-meta">${delayHtml}${meta ? ' · ' + esc(meta) : ''}</div>
      </div>
      <div class="dep-time">
        <div class="dep-in">${inText}</div>
        <div class="dep-clock">${clock}</div>
      </div>
    </li>`;
}

function updateCard(id) {
  const card = document.querySelector(`.fav[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const content = card.querySelector('.fav-content');
  const updated = card.querySelector('.updated');
  if (content) content.innerHTML = renderDepartures(id);
  if (updated) updated.textContent = renderUpdated(id);
}

async function loadDepartures(id) {
  const fav = favs.find(f => f.id === id);
  if (!fav) return;
  const s = depState[id] || (depState[id] = {});
  if (s.loading) return;
  s.loading = true;
  updateCard(id);
  try {
    s.deps = await getFavDepartures(fav);
    s.error = null;
    s.updatedAt = Date.now();
  } catch (err) {
    s.error = err.message || 'Unbekannter Fehler';
  } finally {
    s.loading = false;
    updateCard(id);
  }
}

function openFav(id) {
  openIds.add(id);
  renderList();
  loadDepartures(id);
  clearInterval(refreshTimers[id]);
  refreshTimers[id] = setInterval(() => {
    if (document.visibilityState === 'visible') loadDepartures(id);
  }, REFRESH_MS);
}

function closeFav(id) {
  openIds.delete(id);
  clearInterval(refreshTimers[id]);
  delete refreshTimers[id];
  renderList();
}

$('#favList').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.closest('.fav').dataset.id;
  const idx = favs.findIndex(f => f.id === id);
  switch (btn.dataset.action) {
    case 'toggle':
      openIds.has(id) ? closeFav(id) : openFav(id);
      break;
    case 'refresh':
      loadDepartures(id);
      break;
    case 'up':
    case 'down': {
      const to = btn.dataset.action === 'up' ? idx - 1 : idx + 1;
      if (to < 0 || to >= favs.length) return;
      [favs[idx], favs[to]] = [favs[to], favs[idx]];
      saveFavs();
      renderList();
      break;
    }
    case 'edit':
      openDialog(favs[idx]);
      break;
    case 'delete':
      if (confirm(`„${favs[idx].label || cleanName(favs[idx].stop.name)}“ wirklich löschen?`)) {
        closeFav(id);
        delete depState[id];
        favs.splice(idx, 1);
        saveFavs();
        renderList();
      }
      break;
  }
});

// Countdown "in X Min" jede 20 s neu berechnen, ohne neue API-Anfrage
setInterval(() => openIds.forEach(updateCard), 20_000);

// Beim Zurückkehren in den Tab sofort aktualisieren
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') openIds.forEach(loadDepartures);
});

/* =========================================================================
 * Dialog: Favorit anlegen / bearbeiten
 * ========================================================================= */
const dialog = $('#favDialog');
let draft = null;       // { id?, stop, dir, lines, label }
let availableLines = []; // Linien, die in der gewählten Richtung fahren
let dialogSeq = 0;      // verwirft veraltete Antworten

function openDialog(fav = null) {
  dialogSeq++;
  draft = fav
    ? { id: fav.id, stop: { ...fav.stop }, dir: { ...fav.dir }, lines: [...(fav.lines || [])], label: fav.label || '' }
    : { stop: null, dir: null, lines: [], label: '' };
  availableLines = [];
  $('#dialogTitle').textContent = fav ? 'Station bearbeiten' : 'Station hinzufügen';
  $('#stationInput').value = '';
  $('#directionInput').value = '';
  $('#stationResults').innerHTML = '';
  $('#directionResults').innerHTML = '';
  $('#destQuick').innerHTML = '';
  $('#labelInput').value = draft.label;
  showError('');
  renderDialog();
  if (draft.stop && !draft.dir) loadDestinations();
  if (draft.stop && draft.dir) loadLines();
  dialog.showModal();
  if (!draft.stop) $('#stationInput').focus();
}

function closeDialog() {
  dialogSeq++;
  dialog.close();
  draft = null;
}

function renderDialog() {
  const hasStop = !!draft.stop;
  const hasDir = !!draft.dir;

  $('#stationChosen').hidden = !hasStop;
  $('#stationSearchWrap').hidden = hasStop;
  if (hasStop) {
    $('#stationChosen').innerHTML =
      `<span>${esc(cleanName(draft.stop.name))}</span><button type="button" data-reset="stop">ändern</button>`;
  }

  $('#stepDirection').hidden = !hasStop;
  $('#directionChosen').hidden = !hasDir;
  $('#directionPickWrap').hidden = hasDir;
  if (hasDir) {
    $('#directionChosen').innerHTML =
      `<span>→ ${esc(cleanName(draft.dir.name))}</span><button type="button" data-reset="dir">ändern</button>`;
  }

  $('#stepLines').hidden = !hasDir;
  $('#stepLabel').hidden = !hasDir;
  $('#saveBtn').disabled = !(hasStop && hasDir);
  renderLineChips();
}

function renderLineChips() {
  const wrap = $('#lineChips');
  if (!draft?.dir) { wrap.innerHTML = ''; return; }
  if (availableLines === 'loading') {
    wrap.innerHTML = `<span class="status"><span class="spinner"></span>Lade Linien …</span>`;
    return;
  }
  // verfügbare + bereits gewählte Linien zusammenführen
  const map = new Map();
  [...availableLines, ...draft.lines].forEach(l => map.set(l.name, l));
  const lines = [...map.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'de', { numeric: true }));
  if (!lines.length) {
    wrap.innerHTML = `<span class="hint">Aktuell keine Linien in dieser Richtung gefunden – es werden alle Linien angezeigt.</span>`;
    return;
  }
  wrap.innerHTML = lines.map(l => {
    const on = draft.lines.some(x => x.name === l.name);
    return `<button type="button" class="chip" aria-pressed="${on}" data-line="${esc(l.name)}" data-product="${esc(l.product)}">${lineBadge(l)}</button>`;
  }).join('');
}

function showError(msg) {
  $('#dialogError').hidden = !msg;
  $('#dialogError').textContent = msg;
}

function renderStopResults(el, list, kind) {
  if (!list.length) {
    el.innerHTML = `<li class="status">Keine Haltestelle gefunden.</li>`;
    return;
  }
  el.innerHTML = list.map(s => `
    <li><button type="button" data-pick="${kind}" data-id="${esc(s.id)}" data-name="${esc(s.name)}">
      ${esc(cleanName(s.name))}
    </button></li>`).join('');
}

function makeStopSearch(input, resultsEl, kind) {
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    const seq = dialogSeq;
    resultsEl.innerHTML = `<li class="status"><span class="spinner"></span>Suche …</li>`;
    try {
      const list = await searchStops(q);
      if (seq !== dialogSeq || input.value.trim() !== q) return;
      renderStopResults(resultsEl, list, kind);
    } catch (err) {
      if (seq === dialogSeq) resultsEl.innerHTML = `<li class="status error">${esc(err.message)}</li>`;
    }
  }, 300);
  input.addEventListener('input', run);
}

makeStopSearch($('#stationInput'), $('#stationResults'), 'stop');
makeStopSearch($('#directionInput'), $('#directionResults'), 'dir');

/* Aktuelle Fahrtziele als Schnellauswahl für die Richtung */
async function loadDestinations() {
  const seq = ++dialogSeq;
  const el = $('#destQuick');
  el.innerHTML = `<span class="status"><span class="spinner"></span>Lade aktuelle Fahrtziele …</span>`;
  try {
    const deps = await getDepartures(draft.stop.id, { duration: 60 });
    if (seq !== dialogSeq) return;
    const byDest = new Map();
    for (const d of deps) {
      const dest = d.destination;
      if (!dest?.id || dest.id === draft.stop.id) continue;
      const entry = byDest.get(dest.id) || { id: dest.id, name: dest.name, lines: new Map() };
      if (d.line?.name) entry.lines.set(d.line.name, d.line);
      byDest.set(dest.id, entry);
    }
    const entries = [...byDest.values()].sort((a, b) => {
      const la = [...a.lines.keys()][0] || '', lb = [...b.lines.keys()][0] || '';
      return la.localeCompare(lb, 'de', { numeric: true }) || a.name.localeCompare(b.name, 'de');
    });
    el.innerHTML = entries.length
      ? entries.map(e => `
          <button type="button" data-pick="dir" data-id="${esc(e.id)}" data-name="${esc(e.name)}">
            <span class="lines">${[...e.lines.values()].map(lineBadge).join('')}</span>
            <span>→ ${esc(cleanName(e.name))}</span>
          </button>`).join('')
      : `<span class="hint">Gerade keine Abfahrten – bitte unten eine Haltestelle in Fahrtrichtung suchen.</span>`;
  } catch (err) {
    if (seq === dialogSeq) el.innerHTML = `<span class="status error">${esc(err.message)}</span>`;
  }
}

/* Linien, die in gewählter Richtung fahren */
async function loadLines() {
  const seq = ++dialogSeq;
  availableLines = 'loading';
  renderLineChips();
  try {
    const deps = await getDepartures(draft.stop.id, { direction: draft.dir.id, duration: 120 });
    if (seq !== dialogSeq) return;
    const map = new Map();
    deps.forEach(d => d.line?.name && map.set(d.line.name, { name: d.line.name, product: d.line.product }));
    availableLines = [...map.values()];
  } catch (err) {
    if (seq !== dialogSeq) return;
    availableLines = [];
    showError(`Linien konnten nicht geladen werden: ${err.message}`);
  }
  renderLineChips();
}

dialog.addEventListener('click', e => {
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    const stop = { id: pick.dataset.id, name: pick.dataset.name };
    if (pick.dataset.pick === 'stop') {
      draft.stop = stop;
      draft.dir = null;
      draft.lines = [];
      $('#stationResults').innerHTML = '';
      renderDialog();
      loadDestinations();
    } else {
      if (stop.id === draft.stop.id) { showError('Die Richtung muss eine andere Haltestelle sein.'); return; }
      showError('');
      draft.dir = stop;
      draft.lines = [];
      $('#directionResults').innerHTML = '';
      $('#directionInput').value = '';
      renderDialog();
      loadLines();
    }
    return;
  }

  const reset = e.target.closest('[data-reset]');
  if (reset) {
    showError('');
    if (reset.dataset.reset === 'stop') {
      draft.stop = null; draft.dir = null; draft.lines = [];
      renderDialog();
      $('#stationInput').value = '';
      $('#stationInput').focus();
    } else {
      draft.dir = null; draft.lines = [];
      renderDialog();
      loadDestinations();
    }
    return;
  }

  const chip = e.target.closest('.chip');
  if (chip) {
    const name = chip.dataset.line;
    const i = draft.lines.findIndex(l => l.name === name);
    if (i >= 0) draft.lines.splice(i, 1);
    else draft.lines.push({ name, product: chip.dataset.product });
    renderLineChips();
  }
});

$('#favForm').addEventListener('submit', e => {
  e.preventDefault();
  if (!draft?.stop || !draft?.dir) return;
  const fav = {
    id: draft.id || uid(),
    stop: draft.stop,
    dir: draft.dir,
    lines: draft.lines,
    label: $('#labelInput').value.trim(),
  };
  const idx = favs.findIndex(f => f.id === fav.id);
  if (idx >= 0) favs[idx] = fav; else favs.push(fav);
  saveFavs();
  delete depState[fav.id];
  closeDialog();
  openFav(fav.id);
});

$('#addBtn').addEventListener('click', () => openDialog());
$('#cancelBtn').addEventListener('click', closeDialog);
$('#dialogClose').addEventListener('click', closeDialog);
dialog.addEventListener('cancel', () => { dialogSeq++; draft = null; });

/* =========================================================================
 * Export / Import
 * ========================================================================= */
const EXPORT_APP_ID = 'meine-abfahrten';

function showToast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function favKey(f) {
  const lines = (f.lines || []).map(l => l.name).sort().join(',');
  return `${f.stop.id}|${f.dir.id}|${lines}`;
}

async function exportFavs() {
  if (!favs.length) { showToast('Keine Favoriten zum Exportieren.'); return; }
  const data = {
    app: EXPORT_APP_ID,
    version: 1,
    exportedAt: new Date().toISOString(),
    favorites: favs.map(({ id, stop, dir, lines, label }) => ({ id, stop, dir, lines, label })),
  };
  const json = JSON.stringify(data, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `abfahrten-favoriten-${date}.json`;
  const file = new File([json], fileName, { type: 'application/json' });

  // Auf dem Handy: Teilen-Menü (Dateien, Mail, Messenger, Cloud …)
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ files: [file], title: 'Meine Abfahrten – Favoriten' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // Nutzer hat abgebrochen
      // sonst: auf normalen Download ausweichen
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`${favs.length} Favorit${favs.length === 1 ? '' : 'en'} exportiert.`);
}

/* Prüft und bereinigt importierte Daten. Wirft bei ungültigem Format. */
function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Die Datei ist keine gültige JSON-Datei.'); }
  const list = Array.isArray(data) ? data : data?.favorites;
  if (!Array.isArray(list)) throw new Error('Die Datei enthält keine Favoriten.');

  const isStop = s => s && typeof s === 'object' && /^\S{1,40}$/.test(String(s.id ?? '')) && typeof s.name === 'string';
  const clean = [];
  for (const f of list) {
    if (!f || !isStop(f.stop) || !isStop(f.dir)) continue;
    clean.push({
      id: typeof f.id === 'string' && f.id ? f.id : uid(),
      stop: { id: String(f.stop.id), name: f.stop.name.slice(0, 200) },
      dir: { id: String(f.dir.id), name: f.dir.name.slice(0, 200) },
      lines: Array.isArray(f.lines)
        ? f.lines
            .filter(l => l && typeof l.name === 'string' && l.name)
            .map(l => ({ name: l.name.slice(0, 20), product: typeof l.product === 'string' ? l.product.replace(/[^a-z]/gi, '') : '' }))
        : [],
      label: typeof f.label === 'string' ? f.label.slice(0, 100) : '',
    });
  }
  if (!clean.length) throw new Error('Keine gültigen Favoriten in der Datei gefunden.');
  return clean;
}

let pendingImport = null;

function showImportDialog(list) {
  pendingImport = list;
  const existing = new Set(favs.map(favKey));
  const newCount = list.filter(f => !existing.has(favKey(f))).length;
  const dupes = list.length - newCount;

  $('#importSummary').innerHTML =
    `<strong>${list.length}</strong> Favorit${list.length === 1 ? '' : 'en'} in der Datei` +
    (favs.length ? ` – davon <strong>${newCount}</strong> neu${dupes ? `, ${dupes} bereits vorhanden` : ''}.` : '.');
  $('#importPreview').innerHTML = list.map(f => `
    <li class="${existing.has(favKey(f)) ? 'dupe' : ''}">
      <strong>${esc(f.label || cleanName(f.stop.name))}</strong>
      <span class="muted">→ ${esc(cleanName(f.dir.name))}${f.lines.length ? ' · ' + esc(f.lines.map(l => l.name).join(', ')) : ''}${existing.has(favKey(f)) ? ' · schon vorhanden' : ''}</span>
    </li>`).join('');

  // Ohne bestehende Favoriten gibt es nur eine sinnvolle Aktion
  $('#importReplace').hidden = favs.length === 0;
  $('#importMerge').textContent = favs.length ? 'Hinzufügen' : 'Importieren';
  $('#importMerge').disabled = favs.length > 0 && newCount === 0;
  $('#importDialog').showModal();
}

function applyImport(mode) {
  const list = pendingImport;
  pendingImport = null;
  if (!list || (mode !== 'merge' && mode !== 'replace')) return;

  let added;
  if (mode === 'replace') {
    [...openIds].forEach(id => closeFav(id));
    Object.keys(depState).forEach(k => delete depState[k]);
    favs = list.map(f => ({ ...f }));
    added = favs.length;
  } else {
    const existing = new Set(favs.map(favKey));
    const ids = new Set(favs.map(f => f.id));
    const toAdd = list.filter(f => !existing.has(favKey(f)));
    toAdd.forEach(f => { if (ids.has(f.id)) f.id = uid(); ids.add(f.id); });
    favs.push(...toAdd);
    added = toAdd.length;
  }
  // doppelte IDs innerhalb der Datei absichern
  const seen = new Set();
  favs.forEach(f => { if (seen.has(f.id)) f.id = uid(); seen.add(f.id); });

  saveFavs();
  renderList();
  showToast(mode === 'replace'
    ? `${added} Favorit${added === 1 ? '' : 'en'} importiert.`
    : `${added} Favorit${added === 1 ? '' : 'en'} hinzugefügt.`);
}

$('#exportBtn').addEventListener('click', exportFavs);
$('#importBtn').addEventListener('click', () => {
  $('#importFile').value = '';
  $('#importFile').click();
});
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 1_000_000) { showToast('Die Datei ist zu groß.'); return; }
  try {
    showImportDialog(parseImport(await file.text()));
  } catch (err) {
    showToast(err.message);
  }
});
$('#importDialog').addEventListener('close', () => {
  const mode = $('#importDialog').returnValue;
  $('#importDialog').returnValue = '';
  if (mode === 'replace' && favs.length &&
      !confirm('Alle bestehenden Favoriten werden durch die importierten ersetzt. Fortfahren?')) {
    pendingImport = null;
    return;
  }
  applyImport(mode);
});

/* =========================================================================
 * PWA: Offline-Cache, Installation, Online-Status
 * ========================================================================= */
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker:', err));
  });
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  $('#installBtn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });

function updateOnline() {
  $('#offlineBar').hidden = navigator.onLine;
  if (navigator.onLine) openIds.forEach(loadDepartures);
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);

/* =========================================================================
 * Start
 * ========================================================================= */
$('#offlineBar').hidden = navigator.onLine;
renderList();
