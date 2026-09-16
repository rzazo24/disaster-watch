// Minimal service worker: caches only this app's own static shell so it loads instantly
// (and works offline) on repeat visits. GDACS data, map tiles, fonts and every other
// third-party request are left untouched — a disaster map serving stale cached alerts
// would defeat the whole point, so only same-origin shell files are ever intercepted.
const CACHE_NAME = 'disaster-watch-v2';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!SHELL_FILES.includes(url.pathname)) return;

  // Stale-while-revalidate: serve the cached shell immediately (fast, works offline), but
  // always also fetch a fresh copy in the background and update the cache for next time.
  // Plain cache-first would only ever pick up edits to index.html/style.css/script.js
  // when sw.js's own bytes also change (that's the only thing that makes the browser
  // notice a new service worker at all) — this way editing just the shell's content is
  // enough; no need to remember bumping CACHE_NAME unless SHELL_FILES itself changes.
  //
  // The background refresh is wrapped in event.waitUntil(): respondWith()'s returned
  // value settling (the cached response, immediately) does not by itself keep the worker
  // alive — without waitUntil() the browser can suspend it right after responding, killing
  // the in-flight fetch/cache.put() before it ever completes and silently undoing the
  // whole point of this strategy (confirmed live: without it, the cache never advanced
  // past the first version cached, no matter how many times the page reloaded).
  // { cache: 'reload' } on the revalidation fetch bypasses the browser's own HTTP cache for
  // making the request (still allowed to update it with the response) — not just this
  // service worker's own Cache Storage. Without it, a plain fetch(event.request) can be
  // silently satisfied from the browser's heuristic freshness cache (these files are served
  // with only a Last-Modified header, no Cache-Control, on Vercel too) instead of ever
  // reaching the network.
  // cache.put()'s own promise must be awaited too, not just fired — returning `response`
  // without it lets `network` resolve (and waitUntil() release the worker) before the
  // write actually lands, which loses the update just as silently as either bug above.
  // All three were confirmed live via direct Cache Storage inspection and the actual
  // network response Chromium received (fromServiceWorker: true, fresh body) — each one
  // masking the next: without waitUntil() the fetch never finished; with it but the cache
  // mode left default, the "fresh" fetch kept resolving to stale bytes; with both but no
  // await here, cache.put() ran but the next request still read the old entry back.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const network = fetch(event.request.url, { cache: 'reload' })
          .then(async (response) => {
            // Comparing against the *previously cached* copy (not anything from this
            // response alone) is what actually detects "the shell changed" — which is the
            // common case (any script.js/style.css/index.html edit) and is otherwise
            // invisible to the page: it's served fine on the *next* visit via this same
            // cache, but nothing tells the *current* tab a fresher copy now exists.
            //
            // ETag first, Last-Modified only as a fallback — NOT the other way around.
            // First built with Last-Modified alone, which caused a false-positive report
            // ("the reload banner shows up when there's no new version"): confirmed live
            // against the deployed Vercel site that its Last-Modified drifts by up to a
            // full day on files nobody redeployed — e.g. style.css/index.html/sw.js all
            // showed a "modified" timestamp from that same morning despite the last real
            // commit touching any of them being the day before, while ETag (a genuine
            // content hash) stayed identical across repeated requests the whole time. So
            // Last-Modified reflects something like "when this edge node last cached it,"
            // not "when the content last changed" — comparing it produced false positives
            // whenever an edge revalidation happened to land between two of this SW's own
            // background fetches, with no actual deploy involved at all. ETag doesn't have
            // that problem since it's a hash of the actual bytes. Still falls back to
            // Last-Modified when either side lacks an ETag (e.g. local dev via `python3 -m
            // http.server`, which never sends one) — that environment doesn't have Vercel's
            // edge-cache drift to begin with, so Last-Modified there is just the file's own
            // real, stable mtime. Guarded throughout so a header missing on either response
            // can't be misread as "changed" (or silently as "unchanged").
            const cachedETag = cached && cached.headers.get('ETag');
            const newETag = response.headers.get('ETag');
            const cachedLastModified = cached && cached.headers.get('Last-Modified');
            const newLastModified = response.headers.get('Last-Modified');
            const changed = !cached ? false
              : (newETag && cachedETag) ? newETag !== cachedETag
              : (newLastModified && cachedLastModified) ? newLastModified !== cachedLastModified
              : false;
            await cache.put(event.request, response.clone());
            if (changed) {
              const clients = await self.clients.matchAll();
              clients.forEach((client) => client.postMessage({ type: 'shell-updated' }));
            }
            return response;
          })
          .catch(() => cached);
        event.waitUntil(network);
        return cached || network;
      })
    )
  );
});
