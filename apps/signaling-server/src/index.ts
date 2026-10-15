import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import {
  DEFAULT_SIGNALING_PORT,
  type ClientMessage,
  type PeerInfo,
  type ServerMessage,
} from '@transfer/shared';

const PORT = Number(process.env.PORT ?? DEFAULT_SIGNALING_PORT);

interface Client {
  socket: WebSocket;
  info: PeerInfo | null;
}

const clients = new Map<string, Client>();

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message: ServerMessage, exceptId?: string) {
  for (const [id, client] of clients) {
    if (id !== exceptId && client.info) send(client.socket, message);
  }
}

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

wss.on('connection', (socket) => {
  const id = randomUUID();
  clients.set(id, { socket, info: null });

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(socket, { type: 'error', message: 'Mensaje inválido' });
    }

    const client = clients.get(id);
    if (!client) return;

    switch (msg.type) {
      case 'hello': {
        client.info = { id, name: msg.name.slice(0, 40), kind: msg.kind };
        const peers = [...clients.values()]
          .map((c) => c.info)
          .filter((p): p is PeerInfo => p !== null && p.id !== id);
        send(socket, { type: 'welcome', self: client.info, peers });
        broadcast({ type: 'peer-joined', peer: client.info }, id);
        break;
      }
      case 'signal': {
        const target = clients.get(msg.to);
        if (!target) return send(socket, { type: 'error', message: 'El dispositivo ya no está conectado' });
        send(target.socket, { type: 'signal', from: id, payload: msg.payload });
        break;
      }
    }
  });

  socket.on('close', () => {
    const had = clients.get(id)?.info;
    clients.delete(id);
    if (had) broadcast({ type: 'peer-left', id });
  });
});

const lanIps = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i!.address);

console.log(`Servidor de señalización escuchando en el puerto ${PORT}`);
for (const ip of lanIps) console.log(`  ws://${ip}:${PORT}`);
