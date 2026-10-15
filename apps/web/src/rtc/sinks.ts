import type { FileMeta } from './transfer';

/** Destino donde se va escribiendo un archivo mientras llega. */
export interface FileSink {
  write(chunk: ArrayBuffer): Promise<void>;
  /** Devuelve el archivo en memoria, o null si quedó guardado en disco. */
  close(): Promise<Blob | null>;
  abort(): Promise<void>;
}

export type SinkFactory = (meta: FileMeta) => Promise<FileSink>;

/** Cada cuánto se compactan los chunks en un Blob. */
const BLOB_BATCH_BYTES = 16 * 1024 * 1024;

/**
 * Guarda el archivo como Blob. En vez de acumular miles de ArrayBuffers en
 * la memoria de JavaScript, los agrupa en Blobs de 16 MB; el navegador
 * maneja esos Blobs fuera del heap y los pasa a disco cuando son grandes.
 * Funciona en cualquier navegador, incluso sin HTTPS.
 */
export function memorySink(meta: FileMeta): FileSink {
  let pieces: Blob[] = [];
  let pending: ArrayBuffer[] = [];
  let pendingBytes = 0;

  const flush = () => {
    if (pending.length === 0) return;
    pieces.push(new Blob(pending));
    pending = [];
    pendingBytes = 0;
  };

  return {
    async write(chunk) {
      pending.push(chunk);
      pendingBytes += chunk.byteLength;
      if (pendingBytes >= BLOB_BATCH_BYTES) flush();
    },
    async close() {
      flush();
      const blob = new Blob(pieces, { type: meta.type || 'application/octet-stream' });
      pieces = [];
      return blob;
    },
    async abort() {
      pieces = [];
      pending = [];
    },
  };
}

export const memorySinkFactory: SinkFactory = async (meta) => memorySink(meta);

const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

function safeSegment(segment: string): string {
  const clean = segment.replace(INVALID_CHARS, '_').replace(/^\.+$/, '_').trim();
  return clean || '_';
}

async function exists(dir: FileSystemDirectoryHandle, name: string) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function uniqueName(dir: FileSystemDirectoryHandle, name: string) {
  if (!(await exists(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await exists(dir, candidate))) return candidate;
  }
}

/**
 * Escribe directo en una carpeta elegida por el usuario (File System Access
 * API), recreando las subcarpetas. No usa memoria sin importar el tamaño.
 * Solo existe en Chrome/Edge de escritorio y en contexto seguro (HTTPS o localhost).
 */
export function directorySinkFactory(root: FileSystemDirectoryHandle): SinkFactory {
  return async (meta) => {
    const segments = (meta.path || meta.name).split('/').map(safeSegment);
    const fileName = segments.pop()!;
    let dir = root;
    for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create: true });

    const name = await uniqueName(dir, fileName);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();

    return {
      write: (chunk) => writable.write(chunk),
      async close() {
        await writable.close();
        return null;
      },
      async abort() {
        await writable.abort().catch(() => {});
        await dir.removeEntry(name).catch(() => {});
      },
    };
  };
}

export const supportsDirectorySave =
  typeof window !== 'undefined' && 'showDirectoryPicker' in window && window.isSecureContext;

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
      id?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
}
