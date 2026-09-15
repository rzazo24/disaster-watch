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
// GDACS events range from brand-new to months-old (a drought stays "current" for as long
// as it's ongoing) with no visual difference between the two today. Flagging ones whose
// `fromDate` falls in this window — via the same pulse-glow language already used for
// EMSC's own "notable" quakes, just applied to GDACS's own colored markers instead of
// local-quake's violet, so the two never collide — surfaces what's actually new. GDACS
// events only for now; EMSC's local quakes already use this pulse for magnitude, and
// reusing it for a second, different meaning there would be ambiguous.
const RECENT_HOURS = 24;
// `hours` defaults to RECENT_HOURS (GDACS's own window) but takes an explicit override for
// EMSC's local quakes below — that layer only ever covers a 7-day rolling window to begin
// with (EMSC_DAYS), so "recent" at 24h would already cover a large, unremarkable chunk of
// it; a shorter, separate window is what actually singles anything out there.
function isRecent(dateStr, hours = RECENT_HOURS) {
  return !!dateStr && (Date.now() - new Date(dateStr).getTime()) < hours * 3600 * 1000;
}

// ---- Supplementary Spain earthquake layer (EMSC) ----
// GDACS is deliberately global and only reports earthquakes with real potential
// international-assistance impact — in practice almost always M5+. Spain has frequent
// smaller seismicity GDACS never surfaces at all. EMSC's FDSN event API
// (seismicportal.eu) is CORS-open, needs no key, and aggregates national networks
// including Spain's own IGN — confirmed live (its `auth` field reads "IGN" for Spanish
// events). Two alternatives were investigated and rejected: IGN's own service is
// WMS-only (raster map images, no vector/JSON feed to parse into markers); AEMET's
// OpenData API needs a registered API key and returns tar.gz-compressed CAP XML rather
// than JSON. Neither fits this app's no-backend, no-build-step model as cleanly as
// EMSC already does.
const EMSC_BASE = 'https://www.seismicportal.eu/fdsnws/event/1/query';
// Two disjoint boxes rather than one: the Canary Islands sit ~2000km from the peninsula,
// so a single box spanning both would also sweep in most of the North Atlantic.
const EMSC_REGIONS = [
  { minlat: 35.8, maxlat: 43.9, minlon: -9.5, maxlon: 4.4 },    // Peninsula + Baleares
  { minlat: 27.0, maxlat: 29.5, minlon: -18.5, maxlon: -13.0 }, // Canarias
];
const EMSC_DAYS = 7; // a rolling window, not "current" in GDACS's sense — a quake is a point in time, not an ongoing state
// GDACS's own earthquake alerts never fire below roughly M5 in practice. Capping this
// layer well under that leaves a safety margin so the same physical earthquake can't
// end up rendered twice, once from each source — not a perfect cross-match, but a
// simple heuristic that's right in every case actually observed.
const EMSC_MAX_MAG = 4.5;
// A rough seismology rule of thumb for "likely felt, not just instrument-recorded" — GDACS
// has no equivalent concept for this supplementary layer, so this is a separate, explicitly
// approximate threshold (not an official scale) used only to visually flag which local
// quakes are more likely to matter to someone, via a pulse rather than a color change —
// red/orange/green stays reserved for GDACS's own assessed events.
const EMSC_NOTABLE_MAG = 3.5;
// A second, independent axis from EMSC_NOTABLE_MAG — how big vs. how new. Can't reuse
// pulse-glow (already local-quake's "notable" indicator) for this without making one
// animation mean two different things on the same violet marker, so "just happened" gets
// its own signal: a bright white border instead of the box-shadow pulse. A short 6h window,
// not RECENT_HOURS's 24h — this layer is already a 7-day rolling window (EMSC_DAYS), so 24h
// would flag a large, unremarkable fraction of it; 6h is what actually stands out here.
const EMSC_JUST_HAPPENED_HOURS = 6;

function buildUrl(types, levels, pageNumber) {
  const params = new URLSearchParams({
    eventlist: types.join(';'),
    alertlevel: levels.join(';'),
  });
  if (pageNumber > 1) params.set('pagenumber', pageNumber);
  return `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?${params.toString()}`;
}

function fetchPage(page) {
  return fetch(buildUrl(EVENT_TYPES, ['green', 'orange', 'red'], page)).then((res) => {
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
    return res.json();
  });
}

const PAGE1_RETRY_DELAY_MS = 1500;

async function fetchAllFeatures() {
  // All MAX_PAGES requests fire at once rather than awaiting each in turn — sequential
  // pagination made total load time MAX_PAGES times a single request's latency. Firing
  // them in parallel costs a little unused bandwidth on the pages that turn out to be
  // past the current-event boundary, but wall-clock time drops to roughly one round trip.
  const results = await Promise.allSettled(
    Array.from({ length: MAX_PAGES }, (_, i) => i + 1).map((page) => fetchPage(page))
  );

  // Page 1 failing is the only fatal case below — but a `fetch()` rejection with no
  // httpStatus (a plain network-level failure) looks identical whether it's a genuine CORS
  // block or just a transient blip (a dropped connection, a momentarily slow/erroring
  // GDACS response — already documented as something that happens to this exact endpoint).
  // A real CORS policy block would fail every single request, not intermittently, so one
  // quick retry here filters out the far more common transient case before ever surfacing
  // an error to the user.
  if (results[0].status === 'rejected') {
    await new Promise((resolve) => setTimeout(resolve, PAGE1_RETRY_DELAY_MS));
    results[0] = await fetchPage(1).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    );
  }

  let all = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      if (i === 0) throw result.reason; // still failing after the retry above is the only fatal case
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

function buildEmscUrl(region, startIso) {
  const params = new URLSearchParams({
    format: 'json',
    start: startIso,
    maxmag: EMSC_MAX_MAG,
    orderby: 'time',
    minlat: region.minlat, maxlat: region.maxlat,
    minlon: region.minlon, maxlon: region.maxlon,
  });
  return `${EMSC_BASE}?${params.toString()}`;
}

async function fetchLocalQuakeFeatures() {
  const startIso = new Date(Date.now() - EMSC_DAYS * 86400000).toISOString().slice(0, 19);
  const results = await Promise.allSettled(
    EMSC_REGIONS.map((region) =>
      fetch(buildEmscUrl(region, startIso)).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
    )
  );
  let all = [];
  for (const result of results) {
    if (result.status === 'fulfilled') all = all.concat(result.value.features || []);
    else console.error('EMSC region fetch failed — showing what the other region returned.', result.reason);
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
    filters: { all: 'Todos', EQ: 'Terremotos', TC: 'Ciclones', FL: 'Inundaciones', VO: 'Volcanes', DR: 'Sequías', WF: 'Incendios', localQuakes: 'Sismos locales' },
    levels: { green: 'Verde', orange: 'Naranja', red: 'Rojo' },
    typeLabels: { EQ: 'Terremoto', TC: 'Ciclón', FL: 'Inundación', VO: 'Volcán', WF: 'Incendio', DR: 'Sequía' },
    loading: 'Cargando eventos…',
    refreshAria: 'Actualizar ahora',
    helpAria: 'Ayuda',
    closeAria: 'Cerrar',
    langAria: 'Cambiar idioma',
    locateAria: 'Centrar en mi ubicación',
    attributionData: 'Datos',
    update: { available: 'Hay una nueva versión disponible.', reload: 'Recargar' },
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
        'El botón ES/EN junto al título cambia el idioma de toda la interfaz.',
        'El botón ⌖ junto al zoom centra el mapa en tu ubicación actual (requiere permiso de localización del navegador).',
        'Los marcadores cercanos entre sí se agrupan en un círculo numerado, coloreado por el nivel de alerta más grave del grupo — haz clic o zoom para separarlos.',
        'Los eventos de GDACS iniciados en las últimas 24 horas pulsan en el mapa para destacar lo más nuevo frente a catástrofes que llevan tiempo activas.',
        'El botón "Sismos locales" añade terremotos menores en España (magnitud hasta 4,5) que GDACS no recoge — desactivado por defecto, en su propio color morado, y no se ven afectados por los filtros Verde/Naranja/Rojo al no tener nivel de alerta de GDACS. Los de magnitud 3,5 o superior pulsan para destacar los que probablemente se hayan sentido, y los ocurridos hace menos de 6 horas tienen borde blanco.',
        'Si se publica una versión nueva de la app mientras la tienes abierta, aparece un aviso junto al título con un botón para recargar cuando quieras — nunca se recarga sola.',
      ],
      dataHeading: 'Datos',
      dataText: (link) => `De ${link} (ONU + Comisión Europea), citado tal y como exigen sus términos de uso: "Global Disaster Awareness and Coordination System, GDACS". La API limita cada consulta a 100 eventos, así que en días de mucha actividad alguno puede quedar fuera. Tiles del mapa de Esri, HERE, Garmin y colaboradores de OpenStreetMap. Los sismos locales (botón "Sismos locales") vienen de EMSC (Euro-Mediterranean Seismological Centre), que agrega datos de redes nacionales como el IGN.`,
      apiStatusHeading: 'Estado de las APIs',
      apiStatusIntro: 'Comprueba en directo si un fallo de carga es de las APIs externas (GDACS, EMSC) y no de esta app.',
      apiStatusCheckBtn: 'Comprobar ahora',
      apiStatusChecking: 'Comprobando…',
      apiStatusOk: 'OK',
      apiStatusFail: 'Error',
      apiStatusTimeout: 'Tiempo de espera agotado',
      apiStatusLabels: {
        gdacsPage1: 'GDACS (página 1)',
        gdacsPage2: 'GDACS (página 2)',
        emsc: 'EMSC (sismos locales)',
      },
      codeHeading: 'Código',
      codeText: (link) => `Esta app es de código abierto: ${link}.`,
    },
    panel: {
      type: 'Tipo', country: 'País', from: 'Desde', to: 'Hasta', severity: 'Severidad',
      population: 'Población en zona (est.)', score: 'Puntuación de alerta',
      link: 'Ver informe oficial GDACS →', loadingPop: 'Cargando…',
      popUnavailable: 'No disponible para este tipo de evento', dash: '—', event: 'Evento',
      source: 'Fuente', updated: 'Actualizado', impact: 'Impacto reportado',
      moreImpact: (n) => `+ ${n} más`,
      location: 'Ubicación', date: 'Fecha', magnitude: 'Magnitud', depth: 'Profundidad',
      localQuakeTitle: 'Sismo local', localQuakeLink: 'Ver ficha en EMSC →',
      localQuakeNote: (notable, justHappened) => 'Dato de EMSC, no de GDACS — sin nivel de alerta internacional asociado.' +
        (notable ? ' Magnitud igual o superior a 3,5: es probable que se haya sentido — por eso pulsa en el mapa.' : '') +
        (justHappened ? ' Ocurrió hace menos de 6 horas — por eso tiene el borde blanco.' : ''),
    },
    errors: {
      http: (status) => `Error al obtener datos de GDACS (HTTP ${status}).`,
      // GDACS is confirmed CORS-open (Access-Control-Allow-Origin: *) — a real policy block
      // would fail every single request, not intermittently, so a rejection reaching here
      // (after fetchAllFeatures() already retried page 1 once) is almost always a
      // transient network/server blip, not an actual CORS problem needing a proxy.
      network: 'No se pudo conectar con la API de GDACS. Probablemente sea un problema temporal ' +
        'de red o del servidor — se reintentará automáticamente en el próximo refresco.',
      geoUnsupported: 'Tu navegador no admite geolocalización.',
      geoDenied: 'No se pudo obtener tu ubicación. Revisa los permisos de localización del navegador.',
    },
    locale: 'es-ES',
  },
  en: {
    title: 'DISASTER WATCH',
    pageTitle: 'Disaster Watch — Global GDACS Alerts',
    filters: { all: 'All', EQ: 'Earthquakes', TC: 'Cyclones', FL: 'Floods', VO: 'Volcanoes', DR: 'Droughts', WF: 'Wildfires', localQuakes: 'Local quakes' },
    levels: { green: 'Green', orange: 'Orange', red: 'Red' },
    typeLabels: { EQ: 'Earthquake', TC: 'Cyclone', FL: 'Flood', VO: 'Volcano', WF: 'Wildfire', DR: 'Drought' },
    loading: 'Loading events…',
    refreshAria: 'Refresh now',
    helpAria: 'Help',
    closeAria: 'Close',
    langAria: 'Switch language',
    locateAria: 'Center on my location',
    attributionData: 'Data',
    update: { available: 'A new version is available.', reload: 'Reload' },
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
        'The ES/EN button next to the title switches the whole interface\'s language.',
        'The ⌖ button next to zoom centers the map on your current location (needs the browser\'s location permission).',
        'Markers close to each other group into a numbered circle, colored by the worst alert level in the group — click it or zoom in to split them apart.',
        'GDACS events that started within the last 24 hours pulse on the map, to make what\'s brand new stand out from disasters that have been ongoing for a while.',
        'The "Local quakes" button adds minor earthquakes in Spain (up to magnitude 4.5) that GDACS never tracks — off by default, shown in their own purple color, and unaffected by the Green/Orange/Red filters since they have no GDACS alert level. Ones at magnitude 3.5 or higher pulse to flag the ones more likely to have been felt, and ones from the last 6 hours get a white border.',
        "If a new version of the app is published while you have it open, a notice appears next to the title with a button to reload whenever you're ready — it never reloads on its own.",
      ],
      dataHeading: 'Data',
      dataText: (link) => `From ${link} (UN + European Commission), cited as its terms of use require: "Global Disaster Awareness and Coordination System, GDACS". The API caps each query at 100 events, so on high-activity days some may be left out. Map tiles by Esri, HERE, Garmin and OpenStreetMap contributors. Local quakes ("Local quakes" button) come from EMSC (Euro-Mediterranean Seismological Centre), which aggregates national networks such as Spain's IGN.`,
      apiStatusHeading: 'API status',
      apiStatusIntro: "Check live whether a loading failure is on the external APIs' side (GDACS, EMSC) rather than this app's.",
      apiStatusCheckBtn: 'Check now',
      apiStatusChecking: 'Checking…',
      apiStatusOk: 'OK',
      apiStatusFail: 'Error',
      apiStatusTimeout: 'Timed out',
      apiStatusLabels: {
        gdacsPage1: 'GDACS (page 1)',
        gdacsPage2: 'GDACS (page 2)',
        emsc: 'EMSC (local quakes)',
      },
      codeHeading: 'Code',
      codeText: (link) => `This app is open source: ${link}.`,
    },
    panel: {
      type: 'Type', country: 'Country', from: 'From', to: 'To', severity: 'Severity',
      population: 'Population in area (est.)', score: 'Alert score',
      link: 'View official GDACS report →', loadingPop: 'Loading…',
      popUnavailable: 'Not available for this event type', dash: '—', event: 'Event',
      source: 'Source', updated: 'Updated', impact: 'Reported impact',
      moreImpact: (n) => `+ ${n} more`,
      location: 'Location', date: 'Date', magnitude: 'Magnitude', depth: 'Depth',
      localQuakeTitle: 'Local earthquake', localQuakeLink: 'View EMSC record →',
      localQuakeNote: (notable, justHappened) => 'EMSC data, not GDACS — no international alert level applies.' +
        (notable ? ' Magnitude 3.5 or higher: likely to have been felt — that\'s why it pulses on the map.' : '') +
        (justHappened ? ' It happened less than 6 hours ago — that\'s why it has a white border.' : ''),
    },
    errors: {
      http: (status) => `Error fetching data from GDACS (HTTP ${status}).`,
      network: "Couldn't connect to the GDACS API. This is likely a temporary network or " +
        "server issue — it'll retry automatically on the next refresh.",
      geoUnsupported: "Your browser doesn't support geolocation.",
      geoDenied: "Couldn't get your location. Check the browser's location permission.",
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
let localQuakes = []; // EMSC supplementary layer — separate from allEvents, merged in only when shown
let showLocalQuakes = false; // opt-in and off by default: supplementary data, not part of GDACS's own feed

// What renderEvents() should actually draw — folds in the EMSC layer only when the
// viewer has switched it on, so every render call site doesn't need to know about it.
function currentEventSet() {
  return showLocalQuakes ? allEvents.concat(localQuakes) : allEvents;
}

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

// "Locate me" as a Leaflet corner control (stacks below zoom, same leaflet-bar family) rather
// than a topbar button — it's a map action like zoom, not an app-level one like refresh/help/
// lang. Geolocation itself needs no state beyond the one marker/circle pair below, so a plain
// L.Control.extend() is simpler here than pulling in a plugin (e.g. L.Control.Locate) for what's
// ultimately a single getCurrentPosition() call.
let userLocationMarker = null;
let userAccuracyCircle = null;

function locateUser() {
  if (!navigator.geolocation) {
    showError(STRINGS[lang].errors.geoUnsupported);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      hideError();
      if (userLocationMarker) map.removeLayer(userLocationMarker);
      if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);
      // Not added to markerCluster: this is the viewer's own position, not a GDACS event —
      // clustering it in with disaster markers would misrepresent it as one.
      userAccuracyCircle = L.circle([latitude, longitude], {
        radius: accuracy, color: '#4aa8ff', weight: 1, fillColor: '#4aa8ff', fillOpacity: 0.1,
      }).addTo(map);
      userLocationMarker = L.circleMarker([latitude, longitude], {
        radius: 7, color: '#0a0f0a', weight: 2, fillColor: '#4aa8ff', fillOpacity: 1,
      }).addTo(map);
      map.flyTo([latitude, longitude], Math.max(map.getZoom(), 8));
    },
    () => showError(STRINGS[lang].errors.geoDenied),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
  );
}

const LocateControl = L.Control.extend({
  options: { position: 'bottomleft' },
  onAdd: function () {
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control locate-control');
    const link = L.DomUtil.create('a', '', container);
    link.href = '#';
    link.innerHTML = '⌖';
    link.setAttribute('role', 'button');
    link.setAttribute('aria-label', STRINGS[lang].locateAria);
    this._link = link;
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(link, 'click', L.DomEvent.stop);
    L.DomEvent.on(link, 'click', locateUser);
    return container;
  },
});
const locateControl = new LocateControl().addTo(map);

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

// Markers cluster instead of rendering individually: at the default world view, confirmed
// live that ~80% of the ~230 currently-open events sit close enough together (Central
// Africa's drought/flood events especially — a solid unclickable wall of overlapping icons)
// that individual markers are unreadable and un-clickable until zoomed in a lot. Clusters
// still spiderfy at max zoom for the rare case of near-identical coordinates that even
// zooming in doesn't separate. showCoverageOnHover is off to match the app's minimal style
// (no extra polygon flashing on every hover).
const markerCluster = L.markerClusterGroup({
  showCoverageOnHover: false,
  iconCreateFunction: clusterIcon,
}).addTo(map);

// A cluster's badge is colored by the worst alert level among its children (red beats
// orange beats green) so a cluster hiding even one red event still reads as urgent,
// consistent with how individual markers already work. It also pulses if any child
// started within RECENT_HOURS — same "worst/most-notable child wins" reasoning applied
// to a second, independent axis (recency, not severity).
function clusterIcon(cluster) {
  const children = cluster.getAllChildMarkers();
  let level = 'green';
  let recent = false;
  for (const m of children) {
    if (m.eventLevel === 'red') level = 'red';
    else if (m.eventLevel === 'orange' && level !== 'red') level = 'orange';
    if (isRecent(m.eventFromDate)) recent = true;
  }
  return L.divIcon({
    className: '',
    html: `<div class="disaster-cluster level-${level}${recent ? ' recent' : ''}">${cluster.getChildCount()}</div>`,
    iconSize: [32, 32],
  });
}

// Local (EMSC) quakes get their own cluster group, kept separate from markerCluster: mixing
// them in would let a cluster's badge color imply GDACS's own red/orange/green severity
// scale for events that never went through that assessment at all.
const localQuakeCluster = L.markerClusterGroup({
  showCoverageOnHover: false,
  // A cluster hiding even one magnitude-3.5+ or just-happened quake still shows it — same
  // "worst/most-notable child wins" reasoning as clusterIcon() above, on two independent
  // axes (magnitude and recency) instead of GDACS's single severity level.
  iconCreateFunction: (cluster) => {
    const children = cluster.getAllChildMarkers();
    const notable = children.some((m) => m.eventMag >= EMSC_NOTABLE_MAG);
    const justHappened = children.some((m) => isRecent(m.eventTime, EMSC_JUST_HAPPENED_HOURS));
    return L.divIcon({
      className: '',
      html: `<div class="disaster-cluster local-quake${notable ? ' notable' : ''}${justHappened ? ' just-happened' : ''}">${cluster.getChildCount()}</div>`,
      iconSize: [32, 32],
    });
  },
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
  // Local (EMSC) quakes get a fixed "local-quake" class instead of a level-derived one —
  // event.level is null for them, since GDACS's red/orange/green scale doesn't apply.
  const colorClass = event.isLocalQuake ? 'local-quake' : `level-${event.level}`;
  // "notable" pulses the marker instead of recoloring it — a magnitude threshold isn't
  // GDACS's own assessed severity, so it stays a variation on local-quake's violet rather
  // than borrowing red/orange/green.
  const notableClass = event.isLocalQuake && event.mag >= EMSC_NOTABLE_MAG ? ' notable' : '';
  // "recent" is the GDACS-only counterpart: local quakes already use this same pulse for
  // magnitude, so recency is deliberately not layered onto them too (see RECENT_HOURS).
  const recentClass = !event.isLocalQuake && isRecent(event.fromDate) ? ' recent' : '';
  // Local quakes get their own, separate "just happened" signal (a border, not the pulse
  // notable already owns) since a single event can be both big and brand new at once.
  const justHappenedClass = event.isLocalQuake && isRecent(event.time, EMSC_JUST_HAPPENED_HOURS) ? ' just-happened' : '';
  return `<div class="disaster-marker ${colorClass}${notableClass}${recentClass}${justHappenedClass}">${meta.icon}</div>`;
}

// EMSC's flynn_region arrives all-caps ("SPAIN", "STRAIT OF GIBRALTAR") — a light
// title-case pass for readability, not a translation (same free-text-stays-as-is
// reasoning as event names/severity elsewhere in this app).
function titleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// EMSC (Euro-Mediterranean Seismological Centre) aggregates near-real-time earthquake
// data from national networks — its `auth` field names which one picked up a given
// event (e.g. "IGN" for many Spanish quakes), surfaced here in the same `source` slot
// GDACS's own events use for their monitoring agency (NEIC, NOAA, GLOFAS, ...).
function parseLocalQuakeFeature(feature) {
  const p = feature.properties || {};
  const coords = feature.geometry && feature.geometry.coordinates;
  if (!coords || p.mag == null) return null;
  return {
    id: 'emsc-' + (p.unid || feature.id),
    type: 'EQ',
    isLocalQuake: true,
    level: null, // no GDACS alert scale applies to this source
    region: p.flynn_region ? titleCase(p.flynn_region) : null,
    time: p.time,
    mag: p.mag,
    magType: p.magtype,
    depth: p.depth,
    source: p.auth,
    reportUrl: p.source_id ? `https://www.emsc-csem.org/Earthquake/earthquake.php?id=${p.source_id}` : null,
    lon: coords[0],
    lat: coords[1],
  };
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

// Local (EMSC) quakes have a much smaller, different field set than a GDACS event (a
// single instant instead of an episode with from/to dates, magnitude instead of a
// severity/score/population trio, no Sendai impact reports, no footprint geometry to
// fetch) — rendered as its own simple panel rather than forcing them through
// showPanel()'s GDACS-shaped render() closure with most rows blank.
function showLocalQuakePanel(event) {
  currentPanelEvent = event;
  const t = STRINGS[lang];
  const panel = document.getElementById('panel');
  const content = document.getElementById('panel-content');
  const notable = event.mag != null && event.mag >= EMSC_NOTABLE_MAG;
  const justHappened = isRecent(event.time, EMSC_JUST_HAPPENED_HOURS);
  const rows = [
    [t.panel.type, TYPE_META.EQ.label],
    [t.panel.location, escapeHtml(event.region || t.panel.dash)],
    [t.panel.date, event.time ? new Date(event.time).toLocaleString(t.locale) : t.panel.dash],
    [t.panel.magnitude, event.mag != null ? `${event.mag.toFixed(1)} ${(event.magType || '').toUpperCase()}`.trim() : t.panel.dash],
    [t.panel.depth, event.depth != null ? `${event.depth} km` : t.panel.dash],
    [t.panel.source, escapeHtml(event.source || 'EMSC')],
  ];
  clearGeometryLayer();
  document.getElementById('help-panel').classList.add('hidden');
  panel.dataset.eventId = event.id;
  content.innerHTML = `
    <p class="panel-title">${t.panel.localQuakeTitle}</p>
    <span class="panel-badge local-quake">${t.filters.localQuakes}</span>
    ${rows.map(([k, v]) => `<div class="panel-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}
    <p class="panel-note">${t.panel.localQuakeNote(notable, justHappened)}</p>
    ${event.reportUrl ? `<a class="panel-link" href="${escapeHtml(event.reportUrl)}" target="_blank" rel="noopener">${t.panel.localQuakeLink}</a>` : ''}
  `;
  panel.classList.remove('hidden');
}

function showPanel(event) {
  if (event.isLocalQuake) { showLocalQuakePanel(event); return; }

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

// A direct way to answer "is it the API or the app" (came up live: a viewer saw the
// connection error, and there was no way to tell from inside the app itself whether GDACS
// was actually down or something here was broken). Checks the *exact* URLs fetchEvents()/
// fetchLocalQuakes() themselves build (buildUrl()/buildEmscUrl() reused, not simplified
// stand-ins), so a green result here is a real guarantee the app's own next fetch would
// succeed too — not just a ping against some unrelated health-check endpoint. On demand
// only, via a button — this is a diagnostic aid for an occasional problem, not something
// worth firing automatically every time the help panel opens.
const API_STATUS_TIMEOUT_MS = 15000;

function timedFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_STATUS_TIMEOUT_MS);
  const start = performance.now();
  return fetch(url, { signal: controller.signal, cache: 'no-store' })
    .then((res) => {
      clearTimeout(timer);
      return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - start) };
    })
    .catch((err) => {
      clearTimeout(timer);
      return { ok: false, status: null, ms: Math.round(performance.now() - start), timedOut: err.name === 'AbortError' };
    });
}

// Page 1 and page 2 are checked separately, not just page 1 alone — GDACS's own
// un-paginated page-1 endpoint is documented to sometimes be far slower than its paginated
// siblings, so seeing "page 1 slow/failing, page 2 fine" versus "both down" actually
// distinguishes that known page-1-specific flakiness from a real full outage.
function apiStatusEndpoints() {
  const startIso = new Date(Date.now() - EMSC_DAYS * 86400000).toISOString().slice(0, 19);
  return [
    { key: 'gdacsPage1', url: buildUrl(EVENT_TYPES, ['green', 'orange', 'red'], 1) },
    { key: 'gdacsPage2', url: buildUrl(EVENT_TYPES, ['green', 'orange', 'red'], 2) },
    { key: 'emsc', url: buildEmscUrl(EMSC_REGIONS[0], startIso) },
  ];
}

async function runApiStatusCheck() {
  const t = STRINGS[lang];
  const btn = document.getElementById('api-status-check-btn');
  const container = document.getElementById('api-status-results');
  const endpoints = apiStatusEndpoints();

  btn.disabled = true;
  container.innerHTML = endpoints.map((e) => `
    <div class="panel-row">
      <span class="k">${t.help.apiStatusLabels[e.key]}</span>
      <span class="v" data-key="${e.key}">${t.help.apiStatusChecking}</span>
    </div>
  `).join('');

  const results = await Promise.all(endpoints.map((e) => timedFetch(e.url)));

  endpoints.forEach((e, i) => {
    const r = results[i];
    const el = container.querySelector(`[data-key="${e.key}"]`);
    el.textContent = r.ok
      ? `${t.help.apiStatusOk} · HTTP ${r.status} · ${r.ms} ms`
      : r.timedOut
        ? t.help.apiStatusTimeout
        : `${t.help.apiStatusFail}${r.status ? ` · HTTP ${r.status}` : ''} · ${r.ms} ms`;
    el.classList.add(r.ok ? 'api-status-ok' : 'api-status-fail');
  });

  btn.disabled = false;
}

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
    <h3>${t.help.apiStatusHeading}</h3>
    <p>${t.help.apiStatusIntro}</p>
    <button id="api-status-check-btn" class="help-check-btn">${t.help.apiStatusCheckBtn}</button>
    <div id="api-status-results"></div>
    <h3>${t.help.codeHeading}</h3>
    <p>${t.help.codeText('<a href="https://github.com/rzazo24/disaster-watch" target="_blank" rel="noopener">GitHub</a>')}</p>
  `;
  // help-body's innerHTML (including this button) is rebuilt from scratch every time this
  // function runs — including on a plain language toggle while help is already open — so
  // the click handler has to be re-attached here each time rather than once at load, or a
  // re-render would silently leave the new button dead.
  document.getElementById('api-status-check-btn').addEventListener('click', runApiStatusCheck);
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

  // Not markup-driven like the data-i18n-aria elements above — this control's <a> is built by
  // Leaflet at construction time, so its aria-label is kept in sync here instead.
  if (locateControl._link) locateControl._link.setAttribute('aria-label', t.locateAria);

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
    // The level filter only means something for GDACS's own red/orange/green scale — local
    // (EMSC) quakes carry level: null and bypass it entirely, gated only by the EQ type
    // filter and the separate "Sismos locales" toggle (which controls whether they're in
    // `events` at all — see currentEventSet()).
    if (event.level && !activeLevels.has(event.level)) return;

    seen.add(event.id);
    const icon = L.divIcon({ className: '', html: markerHtml(event), iconSize: [22, 22], iconAnchor: [11, 11] });
    const cluster = event.isLocalQuake ? localQuakeCluster : markerCluster;

    if (markers.has(event.id)) {
      markers.get(event.id).marker.setLatLng([event.lat, event.lon]);
    } else {
      const marker = L.marker([event.lat, event.lon], { icon });
      marker.eventLevel = event.level; // read by clusterIcon() to color the cluster badge
      marker.eventMag = event.mag; // read by the local-quake cluster icon to flag a notable child
      marker.eventFromDate = event.fromDate; // read by clusterIcon() to flag a recent child
      marker.eventTime = event.time; // read by the local-quake cluster icon to flag a just-happened child
      marker.on('click', () => showPanel(event));
      cluster.addLayer(marker);
      markers.set(event.id, { marker, event });
    }
  });

  for (const [id, entry] of markers.entries()) {
    if (!seen.has(id)) {
      (entry.event.isLocalQuake ? localQuakeCluster : markerCluster).removeLayer(entry.marker);
      markers.delete(id);
    }
  }
}

async function fetchEvents() {
  setLoading(true);
  try {
    const features = await fetchAllFeatures();
    allEvents = features.map(parseFeature).filter(Boolean);
    renderEvents(currentEventSet());
    hideError();
  } catch (err) {
    // A bare TypeError from fetch() (no httpStatus) reaching here already survived
    // fetchAllFeatures()'s own one-retry — see errors.network's comment for why that's
    // treated as a transient network/server issue rather than an actual CORS block.
    // An HTTP error on page 1 (the only one that aborts the whole fetch) carries `httpStatus`.
    showError(err.httpStatus ? STRINGS[lang].errors.http(err.httpStatus) : STRINGS[lang].errors.network);
    console.error(err);
  } finally {
    setLoading(false);
  }
}

// This is a supplementary, opt-in layer on top of GDACS's own feed — a failure here
// shouldn't surface an error banner or block anything GDACS-related, just log and leave
// whatever was already shown (possibly nothing, if this is the very first fetch).
async function fetchLocalQuakes() {
  if (!showLocalQuakes) return; // nobody's viewing it — don't spend the round trip
  try {
    const features = await fetchLocalQuakeFeatures();
    localQuakes = features.map(parseLocalQuakeFeature).filter(Boolean);
  } catch (err) {
    console.error('EMSC fetch failed', err);
  }
  renderEvents(currentEventSet());
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
    renderEvents(currentEventSet());
  });
});

document.querySelectorAll('.alert-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const level = btn.dataset.level;
    btn.classList.toggle('active');
    if (btn.classList.contains('active')) activeLevels.add(level);
    else activeLevels.delete(level);
    renderEvents(currentEventSet());
  });
});

// Off by default: supplementary, lower-severity data that would otherwise recreate the
// exact clutter clustering was added to fix. Fetched lazily on first enable rather than
// alongside every GDACS refresh, so nobody pays for a round trip they never asked to see.
document.getElementById('local-quake-toggle').addEventListener('click', (e) => {
  showLocalQuakes = !showLocalQuakes;
  e.currentTarget.classList.toggle('active', showLocalQuakes);
  if (showLocalQuakes) fetchLocalQuakes();
  else renderEvents(currentEventSet()); // no fetch needed to hide — just re-render without them
});

// ---- Manual refresh ----
// A normal browser tab can always be reloaded (or pull-to-refreshed) to force an update;
// an installed PWA has no browser chrome and, especially on iOS, no reliable
// pull-to-refresh gesture either — so this button is the only way to force one there.
let refreshTimer = null;
function scheduleAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  // fetchLocalQuakes() no-ops on its own when the layer is off, so this doesn't need its
  // own on/off branching here.
  refreshTimer = setInterval(() => { fetchEvents(); fetchLocalQuakes(); }, REFRESH_SECONDS * 1000);
}

document.getElementById('refresh-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return; // ignore rapid re-clicks while one is already in flight
  btn.disabled = true;
  btn.classList.add('spinning');
  try {
    await Promise.all([fetchEvents(), fetchLocalQuakes()]);
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
  // Read before register() ever runs: true for a returning visit already controlled by a
  // previously-installed worker, false for a first-ever visit with no controller yet.
  // "controllerchange" fires in *both* cases — a first visit's initial clients.claim() also
  // counts as "acquired a new active worker" even though there was no earlier version to
  // update from — so this is what tells a genuine version swap apart from that one-time
  // activation. Confirmed live (Playwright, a fresh browser context with no prior SW
  // state): controllerchange fires once immediately on a plain first load, which would
  // otherwise have shown "new version available" to every first-time visitor.
  let hadControllerAtLoad = !!navigator.serviceWorker.controller;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW registration failed', err));
  });

  // sw.js calls skipWaiting()/clients.claim(), so a newly-deployed version activates and
  // takes control of an already-open tab right away — but that tab is still running the
  // OLD html/css/js already loaded into memory until it reloads. This used to reload
  // immediately and silently on every controllerchange — changed after a report that
  // yanking the page out from under whoever's reading it (mid-panel, mid-scroll) was
  // jarring; a banner + manual button lets them pick the moment instead. Nothing about the
  // SW/cache mechanism needed to change for this — the new SW is already active and will
  // serve the next real reload regardless of when the user clicks, so there's no
  // correctness reason to force it immediately.
  const showUpdateBanner = () => document.getElementById('update-banner').classList.remove('hidden');

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtLoad) {
      // The page's first-ever controller, not a swap from one version to another — nothing
      // to notify about. Any later controllerchange this session is a real update, though.
      hadControllerAtLoad = true;
      return;
    }
    showUpdateBanner();
  });

  // controllerchange alone covers only a change to sw.js's own bytes (a new worker
  // installing) — it does NOT fire for an ordinary script.js/style.css/index.html edit,
  // which is the far more common deploy and is otherwise invisible to an already-open tab:
  // sw.js's own stale-while-revalidate logic already fetches and caches the new shell in
  // the background, but nothing told the page a fresher copy now exists. sw.js's fetch
  // handler now posts { type: 'shell-updated' } when its background revalidation fetch
  // finds a shell file's Last-Modified differs from what was cached — this is what
  // actually catches that far more common case.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'shell-updated') showUpdateBanner();
  });

  document.getElementById('update-reload-btn').addEventListener('click', () => {
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
