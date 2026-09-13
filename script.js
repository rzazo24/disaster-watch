// ---- Config ----
// GDACS public API — no key, no documented rate limit. GeoJSON response.
// Docs: https://www.gdacs.org/Documents/2025/GDACS_API_quickstart_v2.pdf
// Note: the SEARCH endpoint caps out at 100 records per request (no pagination here).
const EVENT_TYPES = ['EQ', 'TC', 'FL', 'VO', 'WF', 'DR'];
const REFRESH_SECONDS = 300; // events don't change second to second — 5 min is plenty

function buildUrl(types, levels) {
  const params = new URLSearchParams({
    eventlist: types.join(';'),
    alertlevel: levels.join(';'),
  });
  return `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?${params.toString()}`;
}

const TYPE_META = {
  EQ: { label: 'Terremoto', icon: '⬤' },
  TC: { label: 'Ciclón', icon: '◉' },
  FL: { label: 'Inundación', icon: '≈' },
  VO: { label: 'Volcán', icon: '▲' },
  WF: { label: 'Incendio', icon: '✦' },
  DR: { label: 'Sequía', icon: '○' },
};

// ---- State ----
let activeTypes = new Set(EVENT_TYPES);
let activeLevels = new Set(['green', 'orange', 'red']);
const markers = new Map(); // eventid-episodeid -> { marker, event }
let allEvents = []; // last fetched, unfiltered — the source of truth for re-rendering on filter changes

// ---- Map setup ----
// zoomControl is moved to bottom-left so it doesn't sit under the fixed topbar's title.
const map = L.map('map', {
  worldCopyJump: true,
  zoomControl: false,
}).setView([20, 10], 3);
L.control.zoom({ position: 'bottomleft' }).addTo(map);

// CARTO's basemap tiles now require a (free) API key — anonymous requests come back
// watermarked "API KEY REQUIRED". Esri's dark gray canvas gives a near-identical look
// with no key and no account, keeping this project fully auth-free like its GDACS feed.
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors — Datos: Global Disaster Awareness and Coordination System, GDACS',
  maxZoom: 16,
}).addTo(map);

// ---- Helpers to defensively read GDACS properties (field casing has varied across docs/versions) ----
function pick(props, ...keys) {
  for (const k of keys) {
    if (props[k] !== undefined && props[k] !== null) return props[k];
  }
  return null;
}

function normalizeLevel(raw) {
  if (!raw) return 'green';
  const v = String(raw).toLowerCase();
  if (v.includes('red')) return 'red';
  if (v.includes('orange')) return 'orange';
  return 'green';
}

// GDACS timestamps arrive as "2026-09-13T07:30:23" (no timezone marker) but are UTC.
// Without a trailing 'Z', `new Date()` parses them as local time and skews the displayed hour.
function toIsoUtc(raw) {
  if (!raw) return null;
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw + 'Z';
}

function parseFeature(feature) {
  const p = feature.properties || {};
  const coords = feature.geometry && feature.geometry.coordinates;
  if (!coords) return null;

  const eventId = pick(p, 'eventid', 'eventId');
  const episodeId = pick(p, 'episodeid', 'episodeId') || '0';
  const countries = Array.isArray(p.affectedcountries)
    ? p.affectedcountries.map((c) => c.countryname).filter(Boolean)
    : [];

  return {
    id: eventId + '-' + episodeId,
    eventId,
    episodeId,
    type: pick(p, 'eventtype', 'eventType'),
    // `name` is the full human-readable label GDACS always fills in; `eventname` is often
    // empty and only carries a bare storm code (e.g. "NORBERT-26") for cyclones.
    name: pick(p, 'name', 'eventname', 'eventName'),
    level: normalizeLevel(pick(p, 'alertlevel', 'alertLevel')),
    score: pick(p, 'alertscore', 'alertScore'),
    country: countries.length ? countries.join(', ') : pick(p, 'country', 'iso3'),
    fromDate: toIsoUtc(pick(p, 'fromdate', 'fromDate')),
    toDate: toIsoUtc(pick(p, 'todate', 'toDate')),
    description: pick(p, 'htmldescription', 'description'),
    // `url` is an object ({ geometry, report, details }) — the report link lives at `url.report`.
    reportUrl: (p.url && p.url.report) || null,
    severity: p.severitydata && (p.severitydata.severitytext || p.severitydata.severity),
    lon: coords[0],
    lat: coords[1],
  };
}

function markerHtml(event) {
  const meta = TYPE_META[event.type] || { icon: '●' };
  return `<div class="disaster-marker level-${event.level}">${meta.icon}</div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Per-event detail cache: eventId -> population info, or null once we know it's unavailable.
const detailCache = new Map();

function buildDetailUrl(event) {
  const params = new URLSearchParams({
    eventtype: event.type,
    eventid: event.eventId,
    episodeid: event.episodeId,
  });
  return `https://www.gdacs.org/gdacsapi/api/events/getepisodedata?${params.toString()}`;
}

// GDACS only reports a population-exposure estimate for earthquakes (earthquakedetails.rapidpop
// in the per-episode detail endpoint). Cyclones, floods, volcanoes, fires and droughts don't
// expose a comparable figure in the public API, so those honestly resolve to "unavailable".
function extractPopulation(detail) {
  const eq = detail && detail.properties && detail.properties.earthquakedetails;
  if (eq && eq.rapidpop !== undefined && eq.rapidpop !== null) {
    return { value: eq.rapidpop, note: eq.rapidpopdescription || null };
  }
  return null;
}

async function fetchEventDetail(event) {
  if (detailCache.has(event.eventId)) return detailCache.get(event.eventId);
  try {
    const res = await fetch(buildDetailUrl(event));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const population = extractPopulation(data);
    detailCache.set(event.eventId, population);
    return population;
  } catch (err) {
    console.error('No se pudo obtener el detalle del evento', event.eventId, err);
    return null;
  }
}

function showPanel(event) {
  const meta = TYPE_META[event.type] || { label: event.type || 'Evento' };
  const panel = document.getElementById('panel');
  const content = document.getElementById('panel-content');

  const render = (populationText) => {
    const rows = [
      ['Tipo', meta.label],
      ['País', escapeHtml(event.country || '—')],
      ['Desde', event.fromDate ? new Date(event.fromDate).toLocaleString('es-ES') : '—'],
      ['Hasta', event.toDate ? new Date(event.toDate).toLocaleString('es-ES') : '—'],
      ['Severidad', escapeHtml(event.severity || '—')],
      ['Población en zona (est.)', populationText],
      ['Puntuación de alerta', event.score !== null && event.score !== undefined ? event.score : '—'],
    ];
    content.innerHTML = `
      <p class="panel-title">${escapeHtml(event.name || meta.label)}</p>
      <span class="panel-badge level-${event.level}">${event.level}</span>
      ${rows.map(([k, v]) => `<div class="panel-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}
      ${event.reportUrl ? `<a class="panel-link" href="${escapeHtml(event.reportUrl)}" target="_blank" rel="noopener">Ver informe oficial GDACS →</a>` : ''}
    `;
  };

  panel.dataset.eventId = event.id;
  render('Cargando…');
  panel.classList.remove('hidden');

  fetchEventDetail(event).then((population) => {
    if (panel.dataset.eventId !== event.id) return; // user already selected a different event
    render(
      population
        ? `${Number(population.value).toLocaleString('es-ES')}${population.note ? ' — ' + escapeHtml(population.note) : ''}`
        : 'No disponible para este tipo de evento'
    );
  });
}

document.getElementById('panel-close').addEventListener('click', () => {
  document.getElementById('panel').classList.add('hidden');
});

function showError(msg) {
  const banner = document.getElementById('error-banner');
  banner.innerHTML = msg;
  banner.classList.remove('hidden');
}

function hideError() {
  document.getElementById('error-banner').classList.add('hidden');
}

function setLoading(isLoading) {
  document.getElementById('loading-banner').classList.toggle('hidden', !isLoading);
}

function renderEvents(events) {
  const seen = new Set();

  events.forEach((event) => {
    if (!event.type || !activeTypes.has(event.type)) return;
    if (!activeLevels.has(event.level)) return;

    seen.add(event.id);
    const icon = L.divIcon({ className: '', html: markerHtml(event), iconSize: [22, 22], iconAnchor: [11, 11] });

    if (markers.has(event.id)) {
      markers.get(event.id).marker.setLatLng([event.lat, event.lon]);
    } else {
      const marker = L.marker([event.lat, event.lon], { icon }).addTo(map);
      marker.on('click', () => showPanel(event));
      markers.set(event.id, { marker, event });
    }
  });

  for (const [id, entry] of markers.entries()) {
    if (!seen.has(id)) {
      map.removeLayer(entry.marker);
      markers.delete(id);
    }
  }
}

async function fetchEvents() {
  setLoading(true);
  try {
    const res = await fetch(buildUrl(EVENT_TYPES, ['green', 'orange', 'red']));
    if (!res.ok) {
      showError(`Error al obtener datos de GDACS (HTTP ${res.status}).`);
      return;
    }
    const data = await res.json();
    allEvents = (data.features || []).map(parseFeature).filter(Boolean);
    renderEvents(allEvents);
    hideError();
  } catch (err) {
    // A TypeError from fetch() with no other detail is the classic CORS-block signature in browsers.
    showError(
      'No se pudo conectar con la API de GDACS. Si ves este error de forma persistente, ' +
      'es probable que el endpoint no permita peticiones directas desde el navegador (CORS) ' +
      'y haga falta un pequeño proxy.'
    );
    console.error(err);
  } finally {
    setLoading(false);
  }
}

// ---- Filter buttons ----
document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    if (type === 'all') {
      activeTypes = new Set(EVENT_TYPES);
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === 'all'));
    } else {
      document.querySelector('.filter-btn[data-type="all"]').classList.remove('active');
      btn.classList.toggle('active');
      if (btn.classList.contains('active')) activeTypes.add(type);
      else activeTypes.delete(type);
    }
    renderEvents(allEvents);
  });
});

document.querySelectorAll('.alert-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const level = btn.dataset.level;
    btn.classList.toggle('active');
    if (btn.classList.contains('active')) activeLevels.add(level);
    else activeLevels.delete(level);
    renderEvents(allEvents);
  });
});

// ---- Init ----
fetchEvents();
setInterval(fetchEvents, REFRESH_SECONDS * 1000);
