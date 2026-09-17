# Changelog

Todos los cambios relevantes de este proyecto se documentan en este fichero.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este
proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [1.1.1] - 2026-09-16

### Corregido

- El aviso de "nueva versión disponible" podía aparecer sin que hubiera ningún cambio
  real, porque la cabecera `Last-Modified` que sirve Vercel no es fiable como señal de
  cambio de contenido (confirmado en vivo: derivaba hasta casi un día en ficheros sin
  ningún despliegue real de por medio). Ahora la comparación usa primero el `ETag`
  (un hash real del contenido) y solo recurre a `Last-Modified` como respaldo cuando
  no hay `ETag` disponible en alguno de los dos lados, como ocurre en desarrollo local.

## [1.1.0] - 2026-09-15

### Añadido

- Pulso visual en los eventos de GDACS iniciados en las últimas 24 horas.
- Borde blanco ("acaba de pasar") en los terremotos locales (EMSC) ocurridos en las
  últimas 6 horas, como señal independiente del pulso por magnitud.
- Reintento automático de la primera página de GDACS antes de mostrar un error de
  conexión, para no confundir un fallo puntual con un bloqueo real.
- Aviso de "hay una nueva versión disponible" con botón para recargar, en vez de
  recargar la página en silencio cuando se instala una actualización de la PWA.
- Detección de cambios de contenido en el resto de ficheros de la app (no solo en
  `sw.js`), para que el aviso de actualización también salte en despliegues normales.
- Apartado de estado de las APIs (GDACS y EMSC) en el panel de ayuda, para comprobar
  bajo demanda si un problema de conexión viene de la API o de la propia app.
- Enlace al repositorio de GitHub en el panel de ayuda.

### Corregido

- El botón de cerrar el panel de ayuda se veía como un botón nativo sin estilo, en
  vez de encajar con el resto del diseño de la app.

### Cambiado

- Barra de scroll del panel de ayuda/detalle rediseñada para encajar con la estética
  oscura de la app.

## [1.0.0] - 2026-09-13

Primera versión: el mapa completo, instalable como PWA, con panel de ayuda,
traducción ES/EN, agrupación de marcadores, geolocalización y una capa opcional de
terremotos locales para España.

### Añadido

- Mapa mundial con marcadores de alertas de GDACS (terremotos, ciclones tropicales,
  inundaciones, erupciones volcánicas, incendios forestales y sequías), coloreados
  por nivel de alerta, con panel lateral de detalle por evento.
- Panel de ayuda in-app con la leyenda de niveles y tipos de evento.
- Traducción completa al inglés con selector ES/EN.
- Paginación del listado de eventos de GDACS, con las peticiones en paralelo, para no
  perder eventos activos que quedan fuera de los primeros 100 registros.
- Favicon y Progressive Web App instalable (manifest, iconos, service worker).
- Traducción de nombres de país al español mediante un lookup por código ISO3.
- Agencia de origen del dato (`source`) y fecha de última actualización en el panel
  de evento.
- Geometría del área afectada de cada evento y los informes de impacto Sendai,
  mostrados bajo demanda al abrir su panel.
- Botón de actualización manual (↻) para forzar un refresco de los datos.
- Respeto de las áreas seguras del dispositivo (notch, esquinas redondeadas) al
  instalar la app como PWA.
- Agrupación (clustering) de marcadores solapados con Leaflet.markercluster.
- Control "Localízame" para centrar el mapa en la ubicación del usuario.
- Metaetiquetas Open Graph y Twitter Card.
- Capa opcional de terremotos locales para España vía EMSC, con aviso visual (pulso)
  para magnitudes iguales o superiores a 3.5.
- Licencia MIT y script de Vercel Web Analytics.

### Corregido

- El control de zoom tapaba el título; se movió a la esquina inferior izquierda.
- Los filtros por tipo se re-renderizaban desde los marcadores visibles en vez de
  desde la lista completa de eventos, dejando eventos filtrados "atascados" ocultos
  al reactivarlos.
- Los botones de filtro por tipo necesitaban dos clics para surtir efecto la primera
  vez, por no arrancar con la clase `active` sincronizada con el estado real.
- La barra superior se volvía invisible y no clicable en móvil.
- La etiqueta "Datos"/"Data" de la atribución del mapa se quedaba en español al
  cambiar el idioma a inglés.
- Hueco oscuro en la parte inferior del mapa en la PWA instalada en móvil.
- Solapamiento de la atribución del mapa con el control de zoom en escritorio
  estrecho.

### Cambiado

- Barra superior compacta en móvil, dejando que el mapa ocupe el resto del espacio
  disponible.
- Control de atribución de Leaflet sustituido por un elemento propio y más compacto,
  con el texto completo (incluida la cita exacta de GDACS) movido al panel de ayuda.
