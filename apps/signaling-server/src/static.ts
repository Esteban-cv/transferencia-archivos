import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Sirve la app compilada (apps/web/dist) con fallback a index.html. */
export function createStaticHandler(rootDir: string) {
  const root = resolve(rootDir);

  return async function serveStatic(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let filePath = join(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }

    let info = await stat(filePath).catch(() => null);
    if (!info || info.isDirectory()) {
      // Rutas de la SPA: siempre index.html
      filePath = join(root, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info) {
      res
        .writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('No se encontró la app compilada. Corre "npm run build" primero.');
      return;
    }

    const isAsset = relative.startsWith('assets/');
    const noCache = filePath.endsWith('index.html') || filePath.endsWith('sw.js');
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': isAsset
        ? 'public, max-age=31536000, immutable'
        : noCache
          ? 'no-cache'
          : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  };
}
