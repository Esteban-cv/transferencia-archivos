import {
  DEFAULT_SIGNALING_PORT,
  type ClientMessage,
  type DeviceKind,
  type ServerMessage,
} from '@transfer/shared';

const RECONNECT_DELAY_MS = 2000;

export function signalingUrl(): string {
  const fromEnv = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.hostname}:${DEFAULT_SIGNALING_PORT}`;
}

export function detectDeviceKind(): DeviceKind {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function defaultDeviceName(): string {
  const kind = detectDeviceKind();
  const label = kind === 'desktop' ? 'PC' : kind === 'tablet' ? 'Tablet' : 'Celular';
  return `${label}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export interface SignalingConnection {
  send: (msg: ClientMessage) => void;
  close: () => void;
}

/**
 * Conecta al servidor de señalización y se reconecta solo si se cae
 * (por ejemplo, al reiniciar el servidor en desarrollo). Tras cada
 * reconexión llega un nuevo 'welcome' con un id distinto.
 */
export function connectSignaling(
  name: string,
  onMessage: (msg: ServerMessage) => void,
  onStatus: (open: boolean) => void,
): SignalingConnection {
  let socket: WebSocket;
  let closedByUser = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function open() {
    socket = new WebSocket(signalingUrl());
    socket.addEventListener('open', () => {
      onStatus(true);
      send({ type: 'hello', name, kind: detectDeviceKind() });
    });
    socket.addEventListener('message', (e) => onMessage(JSON.parse(e.data)));
    socket.addEventListener('close', () => {
      onStatus(false);
      if (!closedByUser) retry = setTimeout(open, RECONNECT_DELAY_MS);
    });
  }

  function send(msg: ClientMessage) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }

  open();

  return {
    send,
    close: () => {
      closedByUser = true;
      clearTimeout(retry);
      socket.close();
    },
  };
}
