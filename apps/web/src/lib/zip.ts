import { Zip, ZipPassThrough } from 'fflate';

const READ_SLICE = 1024 * 1024;
const BLOB_BATCH_BYTES = 16 * 1024 * 1024;

/** El formato ZIP clásico no soporta más de 4 GB sin la extensión ZIP64. */
export const ZIP_MAX_BYTES = 3.9 * 1024 * 1024 * 1024;

export interface ZipEntry {
  path: string;
  blob: Blob;
}

/**
 * Arma un .zip sin comprimir (rápido, y las fotos/videos/PDF ya vienen
 * comprimidos) leyendo los archivos por partes, para no duplicar todo en memoria.
 */
export async function zipBlobs(entries: ZipEntry[], onProgress?: (done: number) => void): Promise<Blob> {
  const pieces: Blob[] = [];
  let pending: BlobPart[] = [];
  let pendingBytes = 0;
  let processed = 0;

  const finished = new Promise<void>((resolve, reject) => {
    const zip = new Zip((err, chunk, final) => {
      if (err) return reject(err);
      pending.push(chunk as Uint8Array<ArrayBuffer>);
      pendingBytes += chunk.length;
      if (pendingBytes >= BLOB_BATCH_BYTES || final) {
        pieces.push(new Blob(pending));
        pending = [];
        pendingBytes = 0;
      }
      if (final) resolve();
    });

    (async () => {
      for (const entry of entries) {
        const file = new ZipPassThrough(entry.path);
        zip.add(file);
        if (entry.blob.size === 0) {
          file.push(new Uint8Array(0), true);
          continue;
        }
        for (let offset = 0; offset < entry.blob.size; offset += READ_SLICE) {
          const part = new Uint8Array(await entry.blob.slice(offset, offset + READ_SLICE).arrayBuffer());
          const last = offset + READ_SLICE >= entry.blob.size;
          file.push(part, last);
          processed += part.length;
          onProgress?.(processed);
        }
      }
      zip.end();
    })().catch(reject);
  });

  await finished;
  return new Blob(pieces, { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
