import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  normalizeRoom,
  SIGNALING_PATH,
  type ClientMessage,
  type PeerInfo,
  type ServerMessage,
} from '@transfer/shared';
import { ConnectionRateLimiter, MessageRateLimiter, clientIp } from './rateLimit';

interface Client {
  socket: WebSocket;
  info: PeerInfo | null;
  room: string;
  alive: boolean;
  ip: string;
  limiter: MessageRateLimiter;
}

const HEARTBEAT_MS = 15_000;
const SWEEP_MS = 60_000;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_NAME_LENGTH = 40;

export interface SignalingOptions {
  /** Exige que cada dispositivo entre con un código de sala (para cuando el servidor es público). */
  requireRoom?: boolean;
  /** Confiar en X-Forwarded-For para saber la IP real (solo detrás de un proxy conocido: Render, Cloudflare…). */
  trustProxy?: boolean;
  /** Si se da, solo se aceptan conexiones cuyo encabezado Origin esté en esta lista. */
  allowedOrigins?: string[];
}

/**
 * Señalización WebRTC por salas, con límites anti-abuso para cuando el
 * servidor queda expuesto en internet. Cada dispositivo solo ve y solo
 * puede hablar con los dispositivos de su misma sala.
 */
export function attachSignaling(server: HttpServer, options: SignalingOptions = {}) {
  const { requireRoom = false, trustProxy = false, allowedOrigins } = options;
  const wss = new WebSocketServer({ server, path: SIGNALING_PATH, maxPayload: MAX_MESSAGE_BYTES });
  const clients = new Map<string, Client>();
  const connectionLimiter = new ConnectionRateLimiter();

  function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function broadcast(room: string, message: ServerMessage, exceptId?: string) {
    for (const [id, client] of clients) {
      if (id !== exceptId && client.info && client.room === room) send(client.socket, message);
    }
  }

  wss.on('connection', (socket, request) => {
    const ip = clientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'] as string | undefined, trustProxy);

    if (allowedOrigins && !allowedOrigins.includes(request.headers.origin ?? '')) {
      socket.close(1008, 'Origen no permitido');
      return;
    }
    if (!connectionLimiter.tryAcquire(ip)) {
      socket.close(1013, 'Demasiadas conexiones, intenta en un minuto');
      return;
    }

    const id = randomUUID();
    const client: Client = { socket, info: null, room: '', alive: true, ip, limiter: new MessageRateLimiter() };
    clients.set(id, client);

    socket.on('pong', () => (client.alive = true));

    socket.on('message', (raw) => {
      if (!client.limiter.allow()) {
        socket.close(1008, 'Demasiados mensajes');
        return;
      }

      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(socket, { type: 'error', message: 'Mensaje inválido' });
      }

      switch (msg.type) {
        case 'hello': {
          if (client.info) return; // un solo hello por conexión
          const room = normalizeRoom(msg.room);
          if (requireRoom && !room) {
            send(socket, { type: 'room-required' });
            return; // el cliente puede reintentar con un hello que sí traiga sala
          }
          client.room = room;
          client.info = {
            id,
            name: String(msg.name ?? '').trim().slice(0, MAX_NAME_LENGTH) || 'Dispositivo',
            kind: ['desktop', 'mobile', 'tablet'].includes(msg.kind) ? msg.kind : 'desktop',
          };
          const peers = [...clients.values()]
            .filter((c) => c.info && c.room === client.room && c.info.id !== id)
            .map((c) => c.info!);
          send(socket, { type: 'welcome', self: client.info, peers, room: client.room });
          broadcast(client.room, { type: 'peer-joined', peer: client.info }, id);
          break;
        }
        case 'signal': {
          const target = clients.get(msg.to);
          if (!client.info || !target || target.room !== client.room) {
            return send(socket, { type: 'error', message: 'El dispositivo ya no está conectado' });
          }
          send(target.socket, { type: 'signal', from: id, payload: msg.payload });
          break;
        }
      }
    });

    socket.on('close', () => {
      clients.delete(id);
      connectionLimiter.release(ip);
      if (client.info) broadcast(client.room, { type: 'peer-left', id });
    });
  });

  // Saca de la lista a los dispositivos que se fueron sin cerrar la conexión
  // (por ejemplo, un celular que bloqueó la pantalla o perdió el WiFi).
  const heartbeat = setInterval(() => {
    for (const client of clients.values()) {
      if (!client.alive) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, HEARTBEAT_MS);

  // Evita que los contadores de límite crezcan para siempre con IPs viejas
  const sweep = setInterval(() => connectionLimiter.sweep(), SWEEP_MS);

  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(sweep);
  });
  return wss;
}
