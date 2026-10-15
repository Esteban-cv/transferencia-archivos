/**
 * Mini acceso a IndexedDB para la bandeja de "Compartir" de la PWA.
 * El service worker (public/sw.js) escribe en la misma base y tienda.
 */
const DB_NAME = 'transferencia';
const STORE = 'share-inbox';
const KEY = 'latest';

export interface SharedPayload {
  files: File[];
  text: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Lee y borra lo que se compartió hacia la app desde otra app. */
export async function takeSharedPayload(): Promise<SharedPayload | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(KEY);
    get.onsuccess = () => {
      store.delete(KEY);
      resolve((get.result as SharedPayload | undefined) ?? null);
    };
    get.onerror = () => reject(get.error);
  });
}
