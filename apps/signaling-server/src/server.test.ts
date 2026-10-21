import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '@transfer/shared';
import { startAppServer } from './server';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function start(staticDir?: string, extra: Partial<Parameters<typeof startAppServer>[0]> = {}) {
  const app = await startAppServer({ port: 0, host: '127.0.0.1', staticDir, ...extra });
  close = app.close;
  return app.port;
}

/** Cliente de prueba que guarda todos los mensajes recibidos. */
function client(port: number, name: string, room = '', wsOptions?: WebSocket.ClientOptions) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, wsOptions);
  const messages: ServerMessage[] = [];
  ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  const ready = new Promise<void>((resolve) =>
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', name, kind: 'desktop', room }));
      resolve();
    }),
  );
  const waitFor = async (pred: (m: ServerMessage) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const hit = messages.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`${name} no recibió el mensaje esperado`);
  };
  return { ws, messages, ready, waitFor };
}

describe('servidor de señalización', () => {
  it('presenta a los dispositivos de la misma sala y reenvía señales', async () => {
    const port = await start();
    const a = client(port, 'PC');
    await a.ready;
    const welcomeA = (await a.waitFor((m) => m.type === 'welcome')) as Extract<ServerMessage, { type: 'welcome' }>;
    const b = client(port, 'Celular');
    const welcomeB = (await b.waitFor((m) => m.type === 'welcome')) as Extract<ServerMessage, { type: 'welcome' }>;

    expect(welcomeB.peers.map((p) => p.name)).toEqual(['PC']);
    await a.waitFor((m) => m.type === 'peer-joined' && m.peer.name === 'Celular');

    b.ws.send(JSON.stringify({ type: 'signal', to: welcomeA.self.id, payload: { type: 'offer', sdp: 'x' } }));
    const signal = await a.waitFor((m) => m.type === 'signal');
    expect(signal).toMatchObject({ from: welcomeB.self.id, payload: { type: 'offer', sdp: 'x' } });

    b.ws.close();
    await a.waitFor((m) => m.type === 'peer-left' && m.id === welcomeB.self.id);
    a.ws.close();
  });

  it('aísla las salas privadas', async () => {
    const port = await start();
    const publico = client(port, 'Público');
    await publico.waitFor((m) => m.type === 'welcome');
    const privado1 = client(port, 'Privado 1', 'abc123');
    const w1 = (await privado1.waitFor((m) => m.type === 'welcome')) as Extract<ServerMessage, { type: 'welcome' }>;
    const privado2 = client(port, 'Privado 2', 'ABC123');
    const w2 = (await privado2.waitFor((m) => m.type === 'welcome')) as Extract<ServerMessage, { type: 'welcome' }>;

    expect(w1.room).toBe('ABC123');
    expect(w1.peers).toEqual([]);
    expect(w2.peers.map((p) => p.name)).toEqual(['Privado 1']);

    // El público no se entera de los privados ni puede mandarles señales
    await new Promise((r) => setTimeout(r, 50));
    expect(publico.messages.filter((m) => m.type === 'peer-joined')).toEqual([]);
    publico.ws.send(JSON.stringify({ type: 'signal', to: w1.self.id, payload: { type: 'offer', sdp: 'x' } }));
    await publico.waitFor((m) => m.type === 'error');
    expect(privado1.messages.some((m) => m.type === 'signal')).toBe(false);

    for (const c of [publico, privado1, privado2]) c.ws.close();
  });

  it('sirve la app compilada, la info de red y bloquea rutas fuera de la carpeta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-'));
    writeFileSync(join(dir, 'index.html'), '<h1>app</h1>');
    const port = await start(dir);

    const index = await fetch(`http://127.0.0.1:${port}/cualquier/ruta`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('app');

    const info = await fetch(`http://127.0.0.1:${port}/api/info`).then((r) => r.json());
    expect(info).toMatchObject({ port, https: false });
    expect(Array.isArray(info.addresses)).toBe(true);

    const traversal = await fetch(`http://127.0.0.1:${port}/..%2f..%2fetc%2fpasswd`);
    expect(await traversal.text()).not.toContain('root:');
  });

  it('manda cabeceras de seguridad en toda respuesta HTTP', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/api/info`);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('sin Metered configurado, /api/turn-credentials devuelve lista vacía', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/api/turn-credentials`);
    expect(await res.json()).toEqual({ iceServers: [] });
  });

  it('exige sala cuando requireRoom está activo, y deja pasar con sala', async () => {
    const port = await start(undefined, { requireRoom: true });

    const sinSala = client(port, 'PC');
    await sinSala.ready;
    await sinSala.waitFor((m) => m.type === 'room-required');
    sinSala.ws.close();

    const info = await fetch(`http://127.0.0.1:${port}/api/info`).then((r) => r.json());
    expect(info.requireRoom).toBe(true);

    const conSala = client(port, 'PC', 'xyz987');
    const welcome = await conSala.waitFor((m) => m.type === 'welcome');
    expect(welcome).toMatchObject({ room: 'XYZ987' });
    conSala.ws.close();
  });

  it('rechaza conexiones con un origin fuera de la lista permitida', async () => {
    const port = await start(undefined, { allowedOrigins: ['https://transferencia-archivos.onrender.com'] });

    const extrano = client(port, 'Intruso', '', { headers: { Origin: 'https://evil.example' } });
    await new Promise<void>((resolve) => extrano.ws.on('close', () => resolve()));

    const permitido = client(port, 'PC', '', { headers: { Origin: 'https://transferencia-archivos.onrender.com' } });
    await permitido.waitFor((m) => m.type === 'welcome');
    permitido.ws.close();
  });
});
