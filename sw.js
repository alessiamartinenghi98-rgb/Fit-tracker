/* ==========================================================================
   sw.js — Service worker per l'uso offline
   --------------------------------------------------------------------------
   Strategia:
   - All'installazione salva in cache tutti i file dell'app e le librerie CDN.
   - File dell'app: risposta immediata dalla cache, aggiornamento in background
     (la nuova versione è visibile alla riapertura successiva).
   - Librerie CDN (versioni fissate, quindi immutabili): sempre dalla cache.
   Quando modifichi i file dell'app, aumenta CACHE_VERSION per forzare
   l'aggiornamento su tutti i dispositivi.
   ========================================================================== */

const CACHE_VERSION = 'v8';
const CACHE_NAME = `fit-tracker-${CACHE_VERSION}`;

// Percorsi relativi: funzionano anche nella sottocartella di GitHub Pages
const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/workouts.js',
  './js/diet.js',
  './js/progress.js',
  './js/home.js',
  './js/templates.js',
  './js/timer.js',
  './js/plan.js',
  './js/water.js',
  './js/treadmill.js',
  './js/motivation.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/lucide@1.52.0/dist/umd/lucide.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // cache: 'reload' scavalca la cache HTTP del browser: si scaricano sempre i file nuovi
    await cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })));
    // Le librerie CDN non bloccano l'installazione se la rete fallisce
    await Promise.all(CDN_FILES.map(async (url) => {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (res.ok) await cache.put(url, res);
      } catch { /* verranno salvate al prossimo caricamento */ }
    }));
    await self.skipWaiting();
  })());
});

// Elimina le cache delle versioni precedenti
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('fit-tracker-') && k !== CACHE_NAME)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Librerie CDN: cache prima di tutto
  if (url.origin !== self.location.origin) {
    if (!CDN_FILES.includes(req.url)) return;
    event.respondWith((async () => {
      const cached = await caches.match(req.url);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req.url, res.clone());
      }
      return res;
    })());
    return;
  }

  // File dell'app: cache subito, aggiornamento in background
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Le navigazioni (apertura dell'app) usano sempre index.html
    const key = req.mode === 'navigate' ? './index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: true });

    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
