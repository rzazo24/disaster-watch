# Disaster Watch

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=flat&logo=leaflet&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat&logo=vercel&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat)

Mapa en tiempo (casi) real de alertas globales de catástrofes: terremotos, ciclones
tropicales, inundaciones, erupciones volcánicas, incendios forestales y sequías. Usa los
datos públicos de [GDACS](https://www.gdacs.org/) (Global Disaster Awareness and
Coordination System, un marco de cooperación entre Naciones Unidas y la Comisión
Europea) — sin API keys, sin backend, sin build step: HTML/CSS/JS puro con
[Leaflet](https://leafletjs.com/) cargado por CDN, pensado para desplegarse como sitio
estático.

Forma parte de una serie de proyectos pequeños que exploran APIs públicas gratuitas,
publicados como repos independientes a modo de portfolio.

**Demo en vivo:** https://disaster-watch-seven.vercel.app/

![Captura de Disaster Watch: mapa oscuro con marcadores de alertas GDACS en todo el mundo](screenshot.png)

## Cómo funciona

- El mapa (estilo oscuro, tiles de Esri `World_Dark_Gray_Base`) se centra en el mundo
  a zoom 3 y hace fetch directo, desde el navegador, al endpoint de búsqueda de eventos
  de GDACS:

  ```
  https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH
    ?eventlist=EQ;TC;FL;VO;WF;DR
    &alertlevel=green;orange;red
  ```

  GDACS responde con `Access-Control-Allow-Origin: *`, así que no hace falta ningún
  proxy o función serverless — el fetch funciona igual en local que desplegado.

- Cada evento se representa como un marcador coloreado por nivel de alerta
  (verde/naranja/rojo) con un icono según el tipo de desastre. Los botones de la
  barra superior filtran por tipo y por nivel sin recargar la página.

- Los marcadores cercanos entre sí se agrupan en un clúster numerado (vía
  [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster), coloreado
  por el nivel de alerta más grave del grupo) en vez de solaparse sin poder distinguirse
  ni hacer clic — con las ~230 alertas activas típicas, zonas con muchos eventos
  simultáneos (p. ej. sequías e inundaciones en África Central) llegaban a mostrarse como
  una mancha sólida de iconos encima unos de otros. Se separan al hacer zoom o al hacer
  clic sobre el propio clúster.

- Los eventos de GDACS iniciados en las últimas 24 horas pulsan en su propio color de
  alerta, para distinguir lo recién llegado de catástrofes que llevan tiempo activas
  (una sequía de hace meses y un terremoto de esta mañana ya no se ven exactamente igual).

- Al hacer clic en un marcador se abre un panel lateral con el detalle del evento
  (país, fechas, última actualización, fuente de monitorización —p. ej. NEIC, NOAA,
  GLOFAS—, severidad, puntuación de alerta, enlace al informe oficial). La
  población estimada en la zona se pide aparte, bajo demanda, a un segundo endpoint
  de detalle por episodio — el endpoint de lista no incluye ese dato. GDACS solo lo
  expone de forma consistente para terremotos (`rapidpop`); para el resto de tipos
  de evento el panel indica honestamente que el dato no está disponible en vez de
  inventar un placeholder.

- El mismo clic también dibuja, si existe, la huella real del evento en el mapa: el área
  de una inundación, o la trayectoria y el cono de incertidumbre de un ciclón, en vez de
  solo el punto del marcador. Se limpia al cerrar el panel o seleccionar otro evento.

- Cuando GDACS tiene partes de impacto concretos (marco Sendai) —viviendas dañadas,
  personas afectadas, rescates, etc.— el panel los lista (limitado a los primeros, con un
  "+N más" si hay muchos; se ha visto un caso real con más de 200 en una inundación de
  larga duración). No todos los eventos los tienen.

- El listado se refresca cada 5 minutos, paginando la consulta a GDACS (que limita cada
  petición a 100 eventos) hasta agotar los eventos actualmente activos — normalmente
  entre 200 y 300 en total, contando sequías y otros eventos de larga duración. Sin esto,
  eventos reales quedaban fuera solo por venir después en el orden por fecha (así se
  detectó el caso que motivó este arreglo: una inundación en España en la página 2).

- El botón ↻ junto al título fuerza una actualización inmediata. Como PWA instalada no
  tiene barra de navegador que recargar, y en iOS tampoco hay gesto fiable de
  "pull to refresh", así que es la única forma de forzarla ahí.

- Interfaz disponible en español e inglés — el botón junto al título alterna el
  idioma (persistido en `localStorage`), detectado por defecto a partir del idioma
  del navegador. Solo traduce la interfaz propia y, mediante un diccionario por
  código ISO3, el nombre del país. El resto de campos que vienen de GDACS (nombre
  del evento, severidad) siempre llegan en inglés, porque son texto libre que la
  API no ofrece traducido.

- El botón "?" junto al título abre un panel de ayuda con el significado de cada
  nivel de alerta y tipo de evento. Incluye un apartado de "Estado de las APIs" con
  un botón para comprobar en directo si GDACS y EMSC responden — útil para saber si un
  fallo de carga es cosa de estas APIs externas o de la propia app.

- El botón "Sismos locales" (desactivado por defecto) añade terremotos menores en España
  —magnitud hasta 4,5, que GDACS no recoge por ser un servicio centrado en catástrofes con
  posible impacto internacional— usando la API pública de
  [EMSC](https://www.seismicportal.eu/) (Euro-Mediterranean Seismological Centre), que
  agrega redes sismológicas nacionales incluida la del IGN español. Se muestran en su
  propio color morado, con panel propio (ubicación, fecha, magnitud, profundidad, fuente
  y enlace a la ficha de EMSC) ya que no tienen nivel de alerta GDACS ni el resto de campos
  de un evento GDACS. Se cubren la península, Baleares y Canarias, con datos de los
  últimos 7 días. Los de magnitud 3,5 o superior —el umbral aproximado a partir del cual
  un terremoto suele notarse— pulsan en el mapa para distinguirlos del resto, sin cambiar
  de color (esa distinción es solo de magnitud, no la evaluación de impacto de GDACS). Los
  ocurridos en las últimas 6 horas tienen además un borde blanco —una ventana más corta que
  las 24h de los eventos GDACS "recientes", porque esta capa ya es de por sí una ventana de
  7 días, así que casi todo en ella es ya reciente en sentido amplio.

- El botón ⌖, junto al control de zoom, centra el mapa en la ubicación actual del
  navegador (vía la Geolocation API) y marca el punto con un círculo azul y su radio
  de precisión. Requiere permiso de localización del navegador; si se deniega o no
  está disponible, se muestra un aviso en vez de fallar en silencio.

- Incluye metadatos Open Graph y Twitter Card (título, descripción y la captura de
  pantalla como imagen) para que el enlace se vea bien al compartirlo en redes o chats.

- Es una PWA instalable, con iconos propios para escritorio (192/512px) y móvil
  (icono maskable para Android, `apple-touch-icon` para iOS). Un service worker
  (`sw.js`) cachea solo el shell estático de la app (HTML/CSS/JS/iconos) para que
  cargue al instante y funcione sin conexión — nunca cachea el feed de GDACS ni los
  tiles del mapa, que siempre se piden en directo. El shell se refresca en segundo
  plano en cada visita, y si detecta una versión nueva mientras la app está abierta,
  muestra un aviso con un botón para recargar cuando el usuario quiera, en vez de
  recargar la página sola de golpe.

### Limitaciones conocidas

- La app pagina hasta un máximo de 5 páginas (500 eventos) por refresco; en el caso
  extremo de que hubiera más de 500 eventos activos simultáneos a la vez, los eventos
  más antiguos (dentro de los activos) quedarían fuera.
- La población afectada estimada solo está disponible para terremotos.
- GDACS no es un listado exhaustivo de todos los desastres del mundo: su alcance son
  eventos que podrían requerir asistencia internacional. Por eso, por ejemplo, no todos
  los incendios forestales conocidos aparecen — GDACS no rastrea todos los incendios,
  solo los que entran en ese criterio.
- Los rótulos del propio mapa (nombres de países y ciudades sobre los tiles de Esri) se
  quedan siempre en inglés, aunque la interfaz esté en español. A diferencia del país
  que se muestra en el panel de detalle (texto que genera esta app y por tanto puede
  traducir), esos rótulos vienen ya dibujados dentro de las imágenes de los tiles — no
  son texto que se pueda traducir con CSS o JS. Ningún proveedor de tiles raster
  gratuito y sin API key ofrece una variante en español; conseguirlo de verdad exigiría
  pasar a tiles vectoriales (p. ej. MapLibre GL en vez de Leaflet), un cambio de motor de
  mapa completo, no una traducción puntual, así que se deja fuera de alcance.

## Fuente de datos y atribución

Los datos provienen de [GDACS](https://www.gdacs.org/) (Global Disaster Awareness
and Coordination System), un marco de cooperación entre Naciones Unidas
(OCHA y UNOSAT) y la Comisión Europea (JRC y ECHO/Protección Civil).

Según los [términos de uso de GDACS](https://www.gdacs.org/documents/2025/GDACS_Terms_of_use_Mar_25.pdf),
se solicita citar la fuente como *"Global Disaster Awareness and Coordination
System, GDACS"*. El pie del mapa muestra un crédito abreviado; la cita completa,
tal cual la exige GDACS, está en el panel de ayuda ("?" junto al título).

GDACS advierte además que sus alertas se generan de forma (semi)automática, pueden
contener errores, y no sustituyen a las autoridades oficiales de protección civil ni
deben usarse para tomar decisiones sin validación previa. Este proyecto es una
demo de visualización y no un sistema de alerta.

Los tiles del mapa son de [Esri](https://www.esri.com/) (`World_Dark_Gray_Base`,
gratuitos y sin API key).

Los sismos locales (botón "Sismos locales", desactivados por defecto) provienen de
[EMSC](https://www.seismicportal.eu/) (Euro-Mediterranean Seismological Centre), que
agrega datos de redes sismológicas nacionales —incluida la del IGN español— y expone una
API pública sin necesidad de clave.

## Cómo correrlo en local

No requiere instalación de dependencias ni build step. Basta con servir los
archivos estáticos, por ejemplo:

```bash
python3 -m http.server 8000
# o: npx serve .
```

Y abrir `http://localhost:8000` en el navegador.

## Despliegue

Pensado para Vercel (o cualquier hosting estático): no hay configuración de build,
solo servir `index.html`, `style.css` y `script.js` tal cual.

Incluye el script de [Vercel Web Analytics](https://vercel.com/docs/analytics)
(`/_vercel/insights/script.js`). Solo envía datos una vez activado *Analytics*
para el proyecto en el dashboard de Vercel; en cualquier otro sitio (incluido
local) es una petición que falla en silencio, sin romper nada.

## Licencia

Código bajo licencia MIT (ver [LICENSE](LICENSE)). Los datos de GDACS y los tiles
de Esri se rigen por sus propios términos de uso, enlazados más arriba.
