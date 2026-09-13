# Disaster Watch

Mapa en tiempo (casi) real de alertas globales de catástrofes: terremotos, ciclones
tropicales, inundaciones, erupciones volcánicas, incendios forestales y sequías.
Sin backend, sin API keys, sin build step — HTML/CSS/JS puro con [Leaflet](https://leafletjs.com/)
cargado por CDN, pensado para desplegarse como sitio estático.

Forma parte de una serie de proyectos pequeños que exploran APIs públicas gratuitas,
publicados como repos independientes a modo de portfolio.

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

- Al hacer clic en un marcador se abre un panel lateral con el detalle del evento
  (país, fechas, severidad, puntuación de alerta, enlace al informe oficial). La
  población estimada en la zona se pide aparte, bajo demanda, a un segundo endpoint
  de detalle por episodio — el endpoint de lista no incluye ese dato. GDACS solo lo
  expone de forma consistente para terremotos (`rapidpop`); para el resto de tipos
  de evento el panel indica honestamente que el dato no está disponible en vez de
  inventar un placeholder.

- El listado se refresca cada 5 minutos.

### Limitaciones conocidas

- La API de GDACS devuelve como máximo 100 eventos por petición (documentado en su
  [quickstart](https://www.gdacs.org/Documents/2025/GDACS_API_quickstart_v2.pdf)).
  En días de mucha actividad (por ejemplo, temporada de incendios) es posible que
  queden eventos fuera de ese límite — no hay paginación implementada.
- La población afectada estimada solo está disponible para terremotos.

## Fuente de datos y atribución

Los datos provienen de [GDACS](https://www.gdacs.org/) (Global Disaster Awareness
and Coordination System), un marco de cooperación entre Naciones Unidas
(OCHA y UNOSAT) y la Comisión Europea (JRC y ECHO/Protección Civil).

Según los [términos de uso de GDACS](https://www.gdacs.org/documents/2025/GDACS_Terms_of_use_Mar_25.pdf),
se solicita citar la fuente como *"Global Disaster Awareness and Coordination
System, GDACS"*. Este proyecto lo hace en el pie del mapa.

GDACS advierte además que sus alertas se generan de forma (semi)automática, pueden
contener errores, y no sustituyen a las autoridades oficiales de protección civil ni
deben usarse para tomar decisiones sin validación previa. Este proyecto es una
demo de visualización y no un sistema de alerta.

Los tiles del mapa son de [Esri](https://www.esri.com/) (`World_Dark_Gray_Base`,
gratuitos y sin API key).

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

## Licencia

Código bajo licencia MIT (ver [LICENSE](LICENSE)). Los datos de GDACS y los tiles
de Esri se rigen por sus propios términos de uso, enlazados más arriba.
