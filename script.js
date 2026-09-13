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

// ---- i18n ----
// GDACS's own fields (event name, country, severity text) are always in English regardless
// of UI language — there's no localized variant to request. Only this app's own chrome
// (buttons, panel labels, help text) is translated.
const STRINGS = {
  es: {
    title: 'DISASTER WATCH',
    pageTitle: 'Disaster Watch — Alertas globales GDACS',
    filters: { all: 'Todos', EQ: 'Terremotos', TC: 'Ciclones', FL: 'Inundaciones', VO: 'Volcanes', DR: 'Sequías', WF: 'Incendios' },
    levels: { green: 'Verde', orange: 'Naranja', red: 'Rojo' },
    typeLabels: { EQ: 'Terremoto', TC: 'Ciclón', FL: 'Inundación', VO: 'Volcán', WF: 'Incendio', DR: 'Sequía' },
    loading: 'Cargando eventos…',
    helpAria: 'Ayuda',
    closeAria: 'Cerrar',
    langAria: 'Cambiar idioma',
    help: {
      title: 'Cómo leer el mapa',
      levelsHeading: 'Niveles de alerta',
      levelDesc: {
        green: 'Impacto menor, no se espera que requiera asistencia internacional.',
        orange: 'Impacto medio, podría requerir cierta asistencia internacional.',
        red: 'Impacto alto, probablemente requiera una respuesta internacional importante.',
      },
      typesHeading: 'Tipos de evento',
      usageHeading: 'Uso',
      usage: [
        'Los botones de la barra superior filtran por tipo y por nivel — clic para activar o desactivar.',
        'Clic en un marcador abre el detalle: país, fechas, severidad, población estimada (solo disponible para terremotos) y enlace al informe oficial de GDACS.',
        'El mapa se actualiza solo cada 5 minutos.',
      ],
      dataHeading: 'Datos',
      dataText: (link) => `De ${link} (ONU + Comisión Europea). La API limita cada consulta a 100 eventos, así que en días de mucha actividad alguno puede quedar fuera.`,
    },
    panel: {
      type: 'Tipo', country: 'País', from: 'Desde', to: 'Hasta', severity: 'Severidad',
      population: 'Población en zona (est.)', score: 'Puntuación de alerta',
      link: 'Ver informe oficial GDACS →', loadingPop: 'Cargando…',
      popUnavailable: 'No disponible para este tipo de evento', dash: '—', event: 'Evento',
    },
    errors: {
      http: (status) => `Error al obtener datos de GDACS (HTTP ${status}).`,
      cors: 'No se pudo conectar con la API de GDACS. Si ves este error de forma persistente, ' +
        'es probable que el endpoint no permita peticiones directas desde el navegador (CORS) ' +
        'y haga falta un pequeño proxy.',
    },
    locale: 'es-ES',
  },
  en: {
    title: 'DISASTER WATCH',
    pageTitle: 'Disaster Watch — Global GDACS Alerts',
    filters: { all: 'All', EQ: 'Earthquakes', TC: 'Cyclones', FL: 'Floods', VO: 'Volcanoes', DR: 'Droughts', WF: 'Wildfires' },
    levels: { green: 'Green', orange: 'Orange', red: 'Red' },
    typeLabels: { EQ: 'Earthquake', TC: 'Cyclone', FL: 'Flood', VO: 'Volcano', WF: 'Wildfire', DR: 'Drought' },
    loading: 'Loading events…',
    helpAria: 'Help',
    closeAria: 'Close',
    langAria: 'Switch language',
    help: {
      title: 'How to read the map',
      levelsHeading: 'Alert levels',
      levelDesc: {
        green: 'Minor impact — international assistance is not expected to be needed.',
        orange: 'Medium impact — some international assistance could be needed.',
        red: 'High impact — likely to require a significant international response.',
      },
      typesHeading: 'Event types',
      usageHeading: 'Usage',
      usage: [
        'The buttons in the top bar filter by type and by level — click to toggle.',
        'Clicking a marker opens its detail: country, dates, severity, estimated population (only available for earthquakes), and a link to the official GDACS report.',
        'The map refreshes automatically every 5 minutes.',
      ],
      dataHeading: 'Data',
      dataText: (link) => `From ${link} (UN + European Commission). The API caps each query at 100 events, so on high-activity days some may be left out.`,
    },
    panel: {
      type: 'Type', country: 'Country', from: 'From', to: 'To', severity: 'Severity',
      population: 'Population in area (est.)', score: 'Alert score',
      link: 'View official GDACS report →', loadingPop: 'Loading…',
      popUnavailable: 'Not available for this event type', dash: '—', event: 'Event',
    },
    errors: {
      http: (status) => `Error fetching data from GDACS (HTTP ${status}).`,
      cors: "Couldn't connect to the GDACS API. If this keeps happening, the endpoint is probably " +
        'blocking direct browser requests (CORS) and this would need a small proxy.',
    },
    locale: 'en-GB',
  },
};

function detectInitialLang() {
  try {
    const saved = localStorage.getItem('dw_lang');
    if (saved === 'es' || saved === 'en') return saved;
  } catch (err) { /* localStorage unavailable (private browsing, etc.) — fall through */ }
  return navigator.language && navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

function buildTypeMeta(l) {
  const t = STRINGS[l].typeLabels;
  return {
    EQ: { label: t.EQ, icon: '⬤' },
    TC: { label: t.TC, icon: '◉' },
    FL: { label: t.FL, icon: '≈' },
    VO: { label: t.VO, icon: '▲' },
    WF: { label: t.WF, icon: '✦' },
    DR: { label: t.DR, icon: '○' },
  };
}

let lang = detectInitialLang();
let TYPE_META = buildTypeMeta(lang);

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
    console.error('Failed to fetch event detail', event.eventId, err);
    return null;
  }
}

let currentPanelEvent = null; // re-rendered in the new language on toggle, if its panel is open

function showPanel(event) {
  currentPanelEvent = event;
  const t = STRINGS[lang];
  const meta = TYPE_META[event.type] || { label: event.type || t.panel.event };
  const panel = document.getElementById('panel');
  const content = document.getElementById('panel-content');

  const render = (populationText) => {
    const rows = [
      [t.panel.type, meta.label],
      [t.panel.country, escapeHtml(event.country || t.panel.dash)],
      [t.panel.from, event.fromDate ? new Date(event.fromDate).toLocaleString(t.locale) : t.panel.dash],
      [t.panel.to, event.toDate ? new Date(event.toDate).toLocaleString(t.locale) : t.panel.dash],
      [t.panel.severity, escapeHtml(event.severity || t.panel.dash)],
      [t.panel.population, populationText],
      [t.panel.score, event.score !== null && event.score !== undefined ? event.score : t.panel.dash],
    ];
    content.innerHTML = `
      <p class="panel-title">${escapeHtml(event.name || meta.label)}</p>
      <span class="panel-badge level-${event.level}">${t.levels[event.level]}</span>
      ${rows.map(([k, v]) => `<div class="panel-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}
      ${event.reportUrl ? `<a class="panel-link" href="${escapeHtml(event.reportUrl)}" target="_blank" rel="noopener">${t.panel.link}</a>` : ''}
    `;
  };

  document.getElementById('help-panel').classList.add('hidden');
  panel.dataset.eventId = event.id;
  render(t.panel.loadingPop);
  panel.classList.remove('hidden');

  fetchEventDetail(event).then((population) => {
    if (panel.dataset.eventId !== event.id) return; // user already selected a different event
    render(
      population
        ? `${Number(population.value).toLocaleString(t.locale)}${population.note ? ' — ' + escapeHtml(population.note) : ''}`
        : t.panel.popUnavailable
    );
  });
}

document.getElementById('panel-close').addEventListener('click', () => {
  document.getElementById('panel').classList.add('hidden');
});

// ---- Help panel ----
function renderHelpPanel() {
  const t = STRINGS[lang];
  const levelRow = (level) =>
    `<p class="help-row"><span class="panel-badge level-${level}">${t.levels[level]}</span> ${t.help.levelDesc[level]}</p>`;
  const typesHtml = Object.values(TYPE_META)
    .map((meta) => `<div class="help-type-row"><span class="icon">${meta.icon}</span>${meta.label}</div>`)
    .join('');

  document.getElementById('help-body').innerHTML = `
    <p class="panel-title">${t.help.title}</p>
    <h3>${t.help.levelsHeading}</h3>
    ${levelRow('green')}${levelRow('orange')}${levelRow('red')}
    <h3>${t.help.typesHeading}</h3>
    <div id="help-types">${typesHtml}</div>
    <h3>${t.help.usageHeading}</h3>
    <ul>${t.help.usage.map((line) => `<li>${line}</li>`).join('')}</ul>
    <h3>${t.help.dataHeading}</h3>
    <p>${t.help.dataText('<a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a>')}</p>
  `;
}

document.getElementById('help-open').addEventListener('click', () => {
  document.getElementById('panel').classList.add('hidden');
  document.getElementById('help-panel').classList.remove('hidden');
});

document.getElementById('help-close').addEventListener('click', () => {
  document.getElementById('help-panel').classList.add('hidden');
});

// ---- Language toggle ----
function applyLanguage(l) {
  lang = l;
  TYPE_META = buildTypeMeta(lang);
  const t = STRINGS[lang];

  document.documentElement.lang = lang;
  document.title = t.pageTitle;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const value = el.dataset.i18n.split('.').reduce((obj, k) => obj && obj[k], t);
    if (value !== undefined) el.textContent = value;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const value = el.dataset.i18nAria.split('.').reduce((obj, k) => obj && obj[k], t);
    if (value !== undefined) el.setAttribute('aria-label', value);
  });

  const langBtn = document.getElementById('lang-toggle');
  langBtn.textContent = lang === 'es' ? 'EN' : 'ES';
  langBtn.setAttribute('aria-label', t.langAria);

  renderHelpPanel();

  // Re-render the event panel in the new language, but only if it's actually open —
  // otherwise this would pop it back open just because the language changed.
  if (currentPanelEvent && !document.getElementById('panel').classList.contains('hidden')) {
    showPanel(currentPanelEvent);
  }

  try { localStorage.setItem('dw_lang', lang); } catch (err) { /* ignore */ }
}

document.getElementById('lang-toggle').addEventListener('click', () => {
  applyLanguage(lang === 'es' ? 'en' : 'es');
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
      showError(STRINGS[lang].errors.http(res.status));
      return;
    }
    const data = await res.json();
    allEvents = (data.features || []).map(parseFeature).filter(Boolean);
    renderEvents(allEvents);
    hideError();
  } catch (err) {
    // A TypeError from fetch() with no other detail is the classic CORS-block signature in browsers.
    showError(STRINGS[lang].errors.cors);
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
applyLanguage(lang);
fetchEvents();
setInterval(fetchEvents, REFRESH_SECONDS * 1000);
