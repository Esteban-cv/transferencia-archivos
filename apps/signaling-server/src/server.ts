import { existsSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { ServerInfo } from '@transfer/shared';
import { attachSignaling } from './signaling';
import { applySecurityHeaders } from './securityHeaders';
import { createStaticHandler } from './static';
import { lanAddresses } from './network';
import { getIceServers, type TurnOptions } from './turnCredentials';

export interface AppServerOptions extends TurnOptions {
  port: number;
  host?: string;
  /** Carpeta con la app compilada. Sin ella solo funciona la señalización (modo desarrollo). */
  staticDir?: string;
  /** Rutas a certificado y llave para servir por HTTPS. */
  tls?: { cert: string; key: string };
  /** Exige código de sala a todos (ver REQUIRE_ROOM en el README: recomendado al publicar en internet). */
  requireRoom?: boolean;
  /** Confiar en X-Forwarded-For para la IP real: solo detrás de un proxy conocido (Render, Cloudflare…). */
  trustProxy?: boolean;
  /** Si se da, el WebSocket solo acepta conexiones con uno de estos orígenes. */
  allowedOrigins?: string[];
}

export async function startAppServer(options: AppServerOptions) {
  const serveStatic = options.staticDir && existsSync(options.staticDir)
    ? createStaticHandler(options.staticDir)
    : null;
  const https = Boolean(options.tls);

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    applySecurityHeaders(res);

    if (req.url?.startsWith('/api/info')) {
      const info: ServerInfo = {
        addresses: lanAddresses(),
        port: actualPort(),
        https,
        requireRoom: Boolean(options.requireRoom),
      };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(info));
      return;
    }
    if (req.url?.startsWith('/api/turn-credentials')) {
      const iceServers = await getIceServers(options);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ iceServers }));
      return;
    }
    if (serveStatic) {
      serveStatic(req, res).catch(() => res.writeHead(500).end());
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Servidor de señalización activo. En desarrollo abre la app desde Vite.');
  };

  const server = options.tls
    ? createHttpsServer(
        { cert: readFileSync(options.tls.cert), key: readFileSync(options.tls.key) },
        handler,
      )
    : createHttpServer(handler);

  const wss = attachSignaling(server, {
    requireRoom: options.requireRoom,
    trustProxy: options.trustProxy,
    allowedOrigins: options.allowedOrigins,
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? '0.0.0.0', resolve);
  });

  function actualPort() {
    return (server.address() as AddressInfo).port;
  }

  return {
    port: actualPort(),
    https,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
