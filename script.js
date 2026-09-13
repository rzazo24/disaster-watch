// ---- Config ----
// GDACS public API — no key, no documented rate limit. GeoJSON response.
// Docs: https://www.gdacs.org/Documents/2025/GDACS_API_quickstart_v2.pdf
// The SEARCH endpoint caps out at 100 records per request, ordered by date (most recent
// first) — `pagenumber` gets the rest. Confirmed live that page 1 alone was hiding a real,
// currently-open event once there were more than 100 concurrently-active disasters across
// all types/levels combined (long-running droughts alone keep dozens "current" for months).
// `iscurrent` on each feature isn't a filterable query param (passing it is silently
// ignored), so pagination has to keep going until a page's current-event share hits zero —
// past that point in the date order, GDACS is only returning already-closed disasters, and
// including those would show resolved events as if they were still ongoing.
const EVENT_TYPES = ['EQ', 'TC', 'FL', 'VO', 'WF', 'DR'];
const REFRESH_SECONDS = 300; // events don't change second to second — 5 min is plenty
const MAX_PAGES = 5; // hard safety cap (500 events) in case that boundary is ever never reached

function buildUrl(types, levels, pageNumber) {
  const params = new URLSearchParams({
    eventlist: types.join(';'),
    alertlevel: levels.join(';'),
  });
  if (pageNumber > 1) params.set('pagenumber', pageNumber);
  return `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?${params.toString()}`;
}

async function fetchAllFeatures() {
  // All MAX_PAGES requests fire at once rather than awaiting each in turn — sequential
  // pagination made total load time MAX_PAGES times a single request's latency. Firing
  // them in parallel costs a little unused bandwidth on the pages that turn out to be
  // past the current-event boundary, but wall-clock time drops to roughly one round trip.
  const results = await Promise.allSettled(
    Array.from({ length: MAX_PAGES }, (_, i) => i + 1).map((page) =>
      fetch(buildUrl(EVENT_TYPES, ['green', 'orange', 'red'], page)).then((res) => {
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
        return res.json();
      })
    )
  );

  let all = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      if (i === 0) throw result.reason; // page 1 failing is the only fatal case
      console.error(`GDACS page ${i + 1} failed — using what was already fetched.`, result.reason);
      break;
    }
    const features = result.value.features || [];
    const current = features.filter((f) => String(f.properties && f.properties.iscurrent) === 'true');
    all = all.concat(current);
    if (features.length < 100 || current.length === 0) break;
  }
  return all;
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
    refreshAria: 'Actualizar ahora',
    helpAria: 'Ayuda',
    closeAria: 'Cerrar',
    langAria: 'Cambiar idioma',
    attributionData: 'Datos',
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
        'Clic en un marcador abre el detalle: país, fechas, última actualización, fuente de monitorización, severidad, población estimada (solo terremotos), puntuación de alerta e impacto reportado cuando GDACS lo tiene, además del enlace al informe oficial.',
        'El mismo clic dibuja, si existe, la forma real del evento en el mapa — área de una inundación, trayectoria y cono de un ciclón — en vez de solo el punto del marcador.',
        'El mapa se actualiza solo cada 5 minutos — el botón ↻ junto al título fuerza una actualización inmediata.',
      ],
      dataHeading: 'Datos',
      dataText: (link) => `De ${link} (ONU + Comisión Europea), citado tal y como exigen sus términos de uso: "Global Disaster Awareness and Coordination System, GDACS". La API limita cada consulta a 100 eventos, así que en días de mucha actividad alguno puede quedar fuera. Tiles del mapa de Esri, HERE, Garmin y colaboradores de OpenStreetMap.`,
    },
    panel: {
      type: 'Tipo', country: 'País', from: 'Desde', to: 'Hasta', severity: 'Severidad',
      population: 'Población en zona (est.)', score: 'Puntuación de alerta',
      link: 'Ver informe oficial GDACS →', loadingPop: 'Cargando…',
      popUnavailable: 'No disponible para este tipo de evento', dash: '—', event: 'Evento',
      source: 'Fuente', updated: 'Actualizado', impact: 'Impacto reportado',
      moreImpact: (n) => `+ ${n} más`,
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
    refreshAria: 'Refresh now',
    helpAria: 'Help',
    closeAria: 'Close',
    langAria: 'Switch language',
    attributionData: 'Data',
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
        'Clicking a marker opens its detail: country, dates, last update, monitoring source, severity, estimated population (earthquakes only), alert score, and reported impact when GDACS has any, plus a link to the official report.',
        "That same click also draws the event's real footprint on the map when available — a flood's extent, a cyclone's track and cone — instead of just the marker's point.",
        'The map refreshes automatically every 5 minutes — the ↻ button next to the title forces an immediate one.',
      ],
      dataHeading: 'Data',
      dataText: (link) => `From ${link} (UN + European Commission), cited as its terms of use require: "Global Disaster Awareness and Coordination System, GDACS". The API caps each query at 100 events, so on high-activity days some may be left out. Map tiles by Esri, HERE, Garmin and OpenStreetMap contributors.`,
    },
    panel: {
      type: 'Type', country: 'Country', from: 'From', to: 'To', severity: 'Severity',
      population: 'Population in area (est.)', score: 'Alert score',
      link: 'View official GDACS report →', loadingPop: 'Loading…',
      popUnavailable: 'Not available for this event type', dash: '—', event: 'Event',
      source: 'Source', updated: 'Updated', impact: 'Reported impact',
      moreImpact: (n) => `+ ${n} more`,
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
// attributionControl is off — see the plain #map-attribution element below instead of
// Leaflet's own corner control.
const map = L.map('map', {
  worldCopyJump: true,
  zoomControl: false,
  attributionControl: false,
}).setView([20, 10], 3);
L.control.zoom({ position: 'bottomleft' }).addTo(map);

// Leaflet measures #map's pixel size once at construction and only re-measures on an
// explicit invalidateSize() call — it doesn't notice later size changes on its own. With
// viewport-fit=cover (added for the safe-area fix), the viewport's own reported height
// can grow slightly after that initial measurement as the browser finishes accounting for
// the safe area, leaving Leaflet's tile layer sized to the older, shorter measurement — a
// plain dark gap (the container's own background, no tiles) at the bottom, distinct from
// and larger than the safe-area padding itself. Re-measuring after load and on resize
// keeps the map's actual rendered size in sync with its container's real size.
window.addEventListener('load', () => {
  map.invalidateSize();
  // iOS can finish applying the safe-area-aware viewport size slightly after 'load' fires —
  // a second, delayed measurement catches that without needing to guess exactly when.
  setTimeout(() => map.invalidateSize(), 300);
});
window.addEventListener('resize', () => map.invalidateSize());

// CARTO's basemap tiles now require a (free) API key — anonymous requests come back
// watermarked "API KEY REQUIRED". Esri's dark gray canvas gives a near-identical look
// with no key and no account, keeping this project fully auth-free like its GDACS feed.
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 16,
}).addTo(map);

// Attribution is a plain element (#map-attribution, styled in style.css) instead of
// Leaflet's own corner control — Leaflet's own positioning kept producing safe-area
// issues on an installed PWA that this element, sharing the error/loading banners'
// fixed-position + max(px, env(safe-area-inset-*)) pattern, doesn't have.
//
// Kept to a single short line on purpose, not the full "Tiles © Esri, HERE, Garmin, ©
// OpenStreetMap contributors" + GDACS citation: that full text reliably needing 3-5
// wrapped lines at any width narrow enough to matter was *why* it kept colliding with
// the loading/error banners above it no matter how much clearance those got tuned to —
// a taller box just needs more clearance, which needs a narrower box to leave room for,
// which wraps into more lines, taller again. Short-and-single-line sidesteps that
// entirely instead of continuing to chase it with pixel math. The full required GDACS
// citation and tile credits still appear verbatim in the help panel's "Data" section
// (`renderHelpPanel()` below), so the exact citation text is present in the app either
// way — just not crammed into this small always-visible corner badge.
const GDACS_ATTRIBUTION = 'Global Disaster Awareness and Coordination System, GDACS';
function updateDataAttribution(l) {
  document.getElementById('map-attribution').innerHTML =
    `Tiles &copy; Esri — ${STRINGS[l].attributionData}: <a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a>`;
}
updateDataAttribution(lang);

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

// Country names are the one GDACS field worth translating: unlike event names or severity
// text (free-form strings GDACS generates itself, no reasonable way to translate those),
// countries are a bounded, well-known set — keyed by ISO3, which GDACS provides on every
// event. Anything not in here just falls back to GDACS's own (English) name, see
// formatCountry() below.
const COUNTRY_NAMES_ES = {
  AFG: 'Afganistán', ALB: 'Albania', DZA: 'Argelia', ASM: 'Samoa Americana', AND: 'Andorra',
  AGO: 'Angola', AIA: 'Anguila', ATG: 'Antigua y Barbuda', ARG: 'Argentina', ARM: 'Armenia',
  ABW: 'Aruba', AUS: 'Australia', AUT: 'Austria', AZE: 'Azerbaiyán', BHS: 'Bahamas',
  BHR: 'Baréin', BGD: 'Bangladés', BRB: 'Barbados', BLR: 'Bielorrusia', BEL: 'Bélgica',
  BLZ: 'Belice', BEN: 'Benín', BMU: 'Bermudas', BTN: 'Bután', BOL: 'Bolivia',
  BIH: 'Bosnia y Herzegovina', BWA: 'Botsuana', BRA: 'Brasil', VGB: 'Islas Vírgenes Británicas',
  BRN: 'Brunéi', BGR: 'Bulgaria', BFA: 'Burkina Faso', BDI: 'Burundi', KHM: 'Camboya',
  CMR: 'Camerún', CAN: 'Canadá', CPV: 'Cabo Verde', CYM: 'Islas Caimán',
  CAF: 'República Centroafricana', TCD: 'Chad', CHL: 'Chile', CHN: 'China', COL: 'Colombia',
  COM: 'Comoras', COG: 'República del Congo', COD: 'República Democrática del Congo',
  COK: 'Islas Cook', CRI: 'Costa Rica', CIV: 'Costa de Marfil', HRV: 'Croacia', CUB: 'Cuba',
  CUW: 'Curazao', CYP: 'Chipre', CZE: 'República Checa', DNK: 'Dinamarca', DJI: 'Yibuti',
  DMA: 'Dominica', DOM: 'República Dominicana', ECU: 'Ecuador', EGY: 'Egipto',
  SLV: 'El Salvador', GNQ: 'Guinea Ecuatorial', ERI: 'Eritrea', EST: 'Estonia',
  SWZ: 'Esuatini', ETH: 'Etiopía', FLK: 'Islas Malvinas', FRO: 'Islas Feroe', FJI: 'Fiyi',
  FIN: 'Finlandia', FRA: 'Francia', PYF: 'Polinesia Francesa', GAB: 'Gabón', GMB: 'Gambia',
  GEO: 'Georgia', DEU: 'Alemania', GHA: 'Ghana', GIB: 'Gibraltar', GRC: 'Grecia',
  GRL: 'Groenlandia', GRD: 'Granada', GLP: 'Guadalupe', GUM: 'Guam', GTM: 'Guatemala',
  GGY: 'Guernsey', GIN: 'Guinea', GNB: 'Guinea-Bisáu', GUY: 'Guyana', HTI: 'Haití',
  HND: 'Honduras', HKG: 'Hong Kong', HUN: 'Hungría', ISL: 'Islandia', IND: 'India',
  IDN: 'Indonesia', IRN: 'Irán', IRQ: 'Irak', IRL: 'Irlanda', IMN: 'Isla de Man',
  ISR: 'Israel', ITA: 'Italia', JAM: 'Jamaica', JPN: 'Japón', JEY: 'Jersey', JOR: 'Jordania',
  KAZ: 'Kazajistán', KEN: 'Kenia', KIR: 'Kiribati', PRK: 'Corea del Norte', KOR: 'Corea del Sur',
  KWT: 'Kuwait', KGZ: 'Kirguistán', LAO: 'Laos', LVA: 'Letonia', LBN: 'Líbano', LSO: 'Lesoto',
  LBR: 'Liberia', LBY: 'Libia', LIE: 'Liechtenstein', LTU: 'Lituania', LUX: 'Luxemburgo',
  MAC: 'Macao', MDG: 'Madagascar', MWI: 'Malaui', MYS: 'Malasia', MDV: 'Maldivas',
  MLI: 'Malí', MLT: 'Malta', MHL: 'Islas Marshall', MTQ: 'Martinica', MRT: 'Mauritania',
  MUS: 'Mauricio', MYT: 'Mayotte', MEX: 'México', FSM: 'Micronesia', MDA: 'Moldavia',
  MCO: 'Mónaco', MNG: 'Mongolia', MNE: 'Montenegro', MSR: 'Montserrat', MAR: 'Marruecos',
  MOZ: 'Mozambique', MMR: 'Myanmar', NAM: 'Namibia', NRU: 'Nauru', NPL: 'Nepal',
  NLD: 'Países Bajos', NCL: 'Nueva Caledonia', NZL: 'Nueva Zelanda', NIC: 'Nicaragua',
  NER: 'Níger', NGA: 'Nigeria', NIU: 'Niue', MKD: 'Macedonia del Norte',
  MNP: 'Islas Marianas del Norte', NOR: 'Noruega', OMN: 'Omán', PAK: 'Pakistán',
  PLW: 'Palaos', PSE: 'Palestina', PAN: 'Panamá', PNG: 'Papúa Nueva Guinea', PRY: 'Paraguay',
  PER: 'Perú', PHL: 'Filipinas', PCN: 'Islas Pitcairn', POL: 'Polonia', PRT: 'Portugal',
  PRI: 'Puerto Rico', QAT: 'Catar', REU: 'Reunión', ROU: 'Rumanía', RUS: 'Rusia',
  RWA: 'Ruanda', BLM: 'San Bartolomé', SHN: 'Santa Elena', KNA: 'San Cristóbal y Nieves',
  LCA: 'Santa Lucía', MAF: 'San Martín', SPM: 'San Pedro y Miquelón',
  VCT: 'San Vicente y las Granadinas', WSM: 'Samoa', SMR: 'San Marino',
  STP: 'Santo Tomé y Príncipe', SAU: 'Arabia Saudita', SEN: 'Senegal', SRB: 'Serbia',
  SYC: 'Seychelles', SLE: 'Sierra Leona', SGP: 'Singapur', SXM: 'Sint Maarten',
  SVK: 'Eslovaquia', SVN: 'Eslovenia', SLB: 'Islas Salomón', SOM: 'Somalia',
  ZAF: 'Sudáfrica', SSD: 'Sudán del Sur', ESP: 'España', LKA: 'Sri Lanka', SDN: 'Sudán',
  SUR: 'Surinam', SWE: 'Suecia', CHE: 'Suiza', SYR: 'Siria', TWN: 'Taiwán',
  TJK: 'Tayikistán', TZA: 'Tanzania', THA: 'Tailandia', TLS: 'Timor Oriental', TGO: 'Togo',
  TKL: 'Tokelau', TON: 'Tonga', TTO: 'Trinidad y Tobago', TUN: 'Túnez', TUR: 'Turquía',
  TKM: 'Turkmenistán', TCA: 'Islas Turcas y Caicos', TUV: 'Tuvalu', UGA: 'Uganda',
  UKR: 'Ucrania', ARE: 'Emiratos Árabes Unidos', GBR: 'Reino Unido', USA: 'Estados Unidos',
  URY: 'Uruguay', UZB: 'Uzbekistán', VUT: 'Vanuatu', VAT: 'Ciudad del Vaticano',
  VEN: 'Venezuela', VNM: 'Vietnam', VIR: 'Islas Vírgenes de EE. UU.', WLF: 'Wallis y Futuna',
  ESH: 'Sáhara Occidental', YEM: 'Yemen', ZMB: 'Zambia', ZWE: 'Zimbabue',
};

function parseFeature(feature) {
  const p = feature.properties || {};
  const coords = feature.geometry && feature.geometry.coordinates;
  if (!coords) return null;

  const eventId = pick(p, 'eventid', 'eventId');
  const episodeId = pick(p, 'episodeid', 'episodeId') || '0';
  // Kept as {iso3, name} pairs rather than a single joined string, since which name to
  // display (GDACS's English one, or COUNTRY_NAMES_ES's translation) depends on the UI
  // language — resolved at render time by formatCountry(), not baked in here.
  const countryEntries = Array.isArray(p.affectedcountries) && p.affectedcountries.length
    ? p.affectedcountries.map((c) => ({ iso3: c.iso3, name: c.countryname })).filter((c) => c.name)
    : (pick(p, 'country') ? [{ iso3: p.iso3, name: pick(p, 'country') }] : []);

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
    countryEntries,
    fromDate: toIsoUtc(pick(p, 'fromdate', 'fromDate')),
    toDate: toIsoUtc(pick(p, 'todate', 'toDate')),
    dateModified: toIsoUtc(pick(p, 'datemodified', 'dateModified')),
    // The monitoring agency behind the data (e.g. "NEIC", "NOAA", "GLOFAS") — not GDACS
    // itself, which aggregates from these sources rather than measuring events directly.
    source: pick(p, 'source'),
    description: pick(p, 'htmldescription', 'description'),
    // `url` is an object ({ geometry, report, details }) — the report link lives at `url.report`.
    reportUrl: (p.url && p.url.report) || null,
    // Per-event footprint (track lines, uncertainty cones, flood extent polygons) — see
    // fetchEventGeometry()/showEventGeometry(). Most event types only have a centroid
    // point here, in which case nothing extra ends up rendered.
    geometryUrl: (p.url && p.url.geometry) || null,
    severity: p.severitydata && (p.severitydata.severitytext || p.severitydata.severity),
    lon: coords[0],
    lat: coords[1],
  };
}

// English name (as GDACS provides it) unless we're in Spanish mode and have a translation
// for that country's ISO3 code — falls back to the original name for anything not in
// COUNTRY_NAMES_ES, so an unmapped/unknown code never renders as blank or "undefined".
function formatCountry(event, l) {
  if (!event.countryEntries.length) return null;
  return event.countryEntries
    .map((c) => (l === 'es' && COUNTRY_NAMES_ES[c.iso3]) || c.name)
    .join(', ');
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

// Per-event detail cache: eventId -> { population, sendai }, fetched once from the same
// per-episode endpoint (no reason to hit it twice for two different fields).
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

// Sendai Framework impact reports — concrete, human-reported figures ("50 houses damaged
// in Split, Croatia") filed by partners for some events. Free text from GDACS, like
// severity, so it's never translated; unlike population, it's fine for this to just be
// absent (most events don't have any) rather than showing an explicit "unavailable".
// A long-running event can carry hundreds of these (seen live: 227 for one US flood) —
// shown capped, see SENDAI_DISPLAY_LIMIT in showPanel()'s render().
const SENDAI_DISPLAY_LIMIT = 6;

function extractSendai(detail) {
  const sendai = detail && detail.properties && detail.properties.sendai;
  if (!Array.isArray(sendai) || !sendai.length) return null;
  return sendai.map((s) => s.description).filter(Boolean);
}

async function fetchEventDetail(event) {
  if (detailCache.has(event.eventId)) return detailCache.get(event.eventId);
  try {
    const res = await fetch(buildDetailUrl(event));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = { population: extractPopulation(data), sendai: extractSendai(data) };
    detailCache.set(event.eventId, result);
    return result;
  } catch (err) {
    console.error('Failed to fetch event detail', event.eventId, err);
    return { population: null, sendai: null };
  }
}

// ---- Event footprint (track lines, uncertainty cones, flood/shake extent polygons) ----
const LEVEL_COLORS = { green: '#3ef27a', orange: '#ffb347', red: '#ff5d5d' };
const geometryCache = new Map(); // eventId -> filtered GeoJSON FeatureCollection, or null

function styleGeometryFeature(feature, event) {
  const cls = (feature.properties && feature.properties.Class) || '';
  if (cls.startsWith('Line_')) return { color: LEVEL_COLORS[event.level], weight: 2, fillOpacity: 0 };
  if (cls.includes('Cones')) {
    return { color: LEVEL_COLORS[event.level], weight: 1, fillOpacity: 0.05, dashArray: '4,4' };
  }
  if (cls.includes('Green')) return { color: LEVEL_COLORS.green, weight: 1, fillOpacity: 0.15 };
  if (cls.includes('Orange')) return { color: LEVEL_COLORS.orange, weight: 1, fillOpacity: 0.15 };
  if (cls.includes('Red')) return { color: LEVEL_COLORS.red, weight: 1, fillOpacity: 0.15 };
  return { color: LEVEL_COLORS[event.level], weight: 1, fillOpacity: 0.15 }; // Affected/Circle/etc.
}

async function fetchEventGeometry(event) {
  if (!event.geometryUrl) return null;
  if (geometryCache.has(event.eventId)) return geometryCache.get(event.eventId);
  try {
    const res = await fetch(event.geometryUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Points duplicate the marker that's already on the map; "Global" layers (seen on
    // floods) are a coarse model-domain reference box, not the actual impact area.
    const features = (data.features || []).filter((f) => {
      const cls = (f.properties && f.properties.Class) || '';
      return f.geometry && f.geometry.type !== 'Point' && !cls.includes('Global');
    });
    const result = features.length ? { type: 'FeatureCollection', features } : null;
    geometryCache.set(event.eventId, result);
    return result;
  } catch (err) {
    console.error('Failed to fetch event geometry', event.eventId, err);
    return null;
  }
}

let geometryLayer = null;
function clearGeometryLayer() {
  if (geometryLayer) {
    map.removeLayer(geometryLayer);
    geometryLayer = null;
  }
}

function showEventGeometry(event) {
  fetchEventGeometry(event).then((geojson) => {
    if (!geojson || document.getElementById('panel').dataset.eventId !== event.id) return;
    clearGeometryLayer();
    geometryLayer = L.geoJSON(geojson, { style: (f) => styleGeometryFeature(f, event) }).addTo(map);
  });
}

let currentPanelEvent = null; // re-rendered in the new language on toggle, if its panel is open

function showPanel(event) {
  currentPanelEvent = event;
  const t = STRINGS[lang];
  const meta = TYPE_META[event.type] || { label: event.type || t.panel.event };
  const panel = document.getElementById('panel');
  const content = document.getElementById('panel-content');

  const render = (populationText, sendai) => {
    const rows = [
      [t.panel.type, meta.label],
      [t.panel.country, escapeHtml(formatCountry(event, lang) || t.panel.dash)],
      [t.panel.from, event.fromDate ? new Date(event.fromDate).toLocaleString(t.locale) : t.panel.dash],
      [t.panel.to, event.toDate ? new Date(event.toDate).toLocaleString(t.locale) : t.panel.dash],
      [t.panel.updated, event.dateModified ? new Date(event.dateModified).toLocaleString(t.locale) : t.panel.dash],
      [t.panel.source, escapeHtml(event.source || t.panel.dash)],
      [t.panel.severity, escapeHtml(event.severity || t.panel.dash)],
      [t.panel.population, populationText],
      [t.panel.score, event.score !== null && event.score !== undefined ? event.score : t.panel.dash],
    ];
    content.innerHTML = `
      <p class="panel-title">${escapeHtml(event.name || meta.label)}</p>
      <span class="panel-badge level-${event.level}">${t.levels[event.level]}</span>
      ${rows.map(([k, v]) => `<div class="panel-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}
      ${sendai && sendai.length ? `
        <p class="panel-subheading">${t.panel.impact}</p>
        <ul class="panel-impact">
          ${sendai.slice(0, SENDAI_DISPLAY_LIMIT).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
          ${sendai.length > SENDAI_DISPLAY_LIMIT ? `<li class="panel-impact-more">${t.panel.moreImpact(sendai.length - SENDAI_DISPLAY_LIMIT)}</li>` : ''}
        </ul>
      ` : ''}
      ${event.reportUrl ? `<a class="panel-link" href="${escapeHtml(event.reportUrl)}" target="_blank" rel="noopener">${t.panel.link}</a>` : ''}
    `;
  };

  clearGeometryLayer();
  document.getElementById('help-panel').classList.add('hidden');
  panel.dataset.eventId = event.id;
  render(t.panel.loadingPop, null);
  panel.classList.remove('hidden');

  fetchEventDetail(event).then(({ population, sendai }) => {
    if (panel.dataset.eventId !== event.id) return; // user already selected a different event
    render(
      population
        ? `${Number(population.value).toLocaleString(t.locale)}${population.note ? ' — ' + escapeHtml(population.note) : ''}`
        : t.panel.popUnavailable,
      sendai
    );
  });

  showEventGeometry(event);
}

function hideEventPanel() {
  document.getElementById('panel').classList.add('hidden');
  clearGeometryLayer();
}

document.getElementById('panel-close').addEventListener('click', hideEventPanel);

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
  hideEventPanel();
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

  updateDataAttribution(lang);
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
    const features = await fetchAllFeatures();
    allEvents = features.map(parseFeature).filter(Boolean);
    renderEvents(allEvents);
    hideError();
  } catch (err) {
    // A TypeError from fetch() with no other detail is the classic CORS-block signature in browsers;
    // an HTTP error on page 1 (the only one that aborts the whole fetch) carries `httpStatus`.
    showError(err.httpStatus ? STRINGS[lang].errors.http(err.httpStatus) : STRINGS[lang].errors.cors);
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

// ---- Manual refresh ----
// A normal browser tab can always be reloaded (or pull-to-refreshed) to force an update;
// an installed PWA has no browser chrome and, especially on iOS, no reliable
// pull-to-refresh gesture either — so this button is the only way to force one there.
let refreshTimer = null;
function scheduleAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(fetchEvents, REFRESH_SECONDS * 1000);
}

document.getElementById('refresh-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return; // ignore rapid re-clicks while one is already in flight
  btn.disabled = true;
  btn.classList.add('spinning');
  try {
    await fetchEvents();
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinning');
  }
  scheduleAutoRefresh(); // push the next automatic refresh back out from this manual one
});

// ---- Init ----
applyLanguage(lang);
fetchEvents();
scheduleAutoRefresh();

// PWA shell caching — see sw.js for what it does and, just as importantly, doesn't cache
// (never the GDACS feed itself). Registration failing (e.g. served over plain HTTP in some
// local setups) is non-fatal, so it's only logged, not surfaced to the user.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW registration failed', err));
  });

  // sw.js calls skipWaiting()/clients.claim(), so a newly-deployed version activates and
  // takes control of an already-open tab right away — but that tab is still running the
  // OLD html/css/js already loaded into memory until it reloads. "controllerchange" fires
  // exactly when that takeover happens, so reload once to actually pick up the new shell;
  // otherwise a PWA left open for a while would silently keep running stale code
  // indefinitely; guarded against firing twice since the event can in principle repeat.
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });

  // The browser only checks sw.js for changes on its own schedule (roughly every 24h, or
  // on navigation) — for a PWA that gets reopened from the background rather than
  // re-navigated to, that can leave it stale far longer than intended. Re-checking
  // whenever the tab becomes visible again catches updates much sooner.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update());
    }
  });
}
