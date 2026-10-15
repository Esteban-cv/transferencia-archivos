/* Service worker: instalación como app y recepción desde "Compartir". */
const CACHE = 'transferencia-v1';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname === '/share') {
    event.respondWith(receiveShare(event.request));
    return;
  }

  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/ws')
  ) {
    return;
  }

  // Red primero (siempre la versión más nueva), caché si no hay red
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/'))),
  );
});

/** Guarda lo compartido en IndexedDB y abre la app, que lo carga para enviar. */
async function receiveShare(request) {
  const form = await request.formData();
  const files = form.getAll('files').filter((f) => f instanceof File && f.size >= 0 && f.name);
  const text = ['title', 'text', 'url']
    .map((key) => form.get(key))
    .filter((v) => typeof v === 'string' && v.trim())
    .join('\n');
  await saveShared({ files, text });
  return Response.redirect('/?shared=1', 303);
}

function saveShared(payload) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('transferencia', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('share-inbox');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('share-inbox', 'readwrite');
      tx.objectStore('share-inbox').put(payload, 'latest');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}
