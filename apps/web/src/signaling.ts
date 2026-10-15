import {
  SIGNALING_PATH,
  type ClientMessage,
  type DeviceKind,
  type ServerMessage,
} from '@transfer/shared';

const RECONNECT_DELAY_MS = 2000;
const NAME_KEY = 'transfer.deviceName';

export function signalingUrl(): string {
  const fromEnv = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}${SIGNALING_PATH}`;
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

/** Nombre guardado en este navegador, o uno nuevo si no hay. */
export function loadDeviceName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
  } catch {
    // Sin acceso a localStorage (modo privado, etc.)
  }
  return defaultDeviceName();
}

export function saveDeviceName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Sin acceso a localStorage: el nombre dura solo esta sesión
  }
}

export interface SignalingConnection {
  send: (msg: ClientMessage) => void;
  close: () => void;
}

/**
 * Conecta al servidor de señalización y se reconecta solo si se cae
 * (por ejemplo, al reiniciar el servidor). Tras cada reconexión llega
 * un nuevo 'welcome' con un id distinto.
 */
export function connectSignaling(
  name: string,
  room: string,
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
      send({ type: 'hello', name, kind: detectDeviceKind(), room });
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

  // Al volver a la pestaña (p. ej. el celular salió de suspensión) reconectar de una
  const onVisible = () => {
    if (document.visibilityState === 'visible' && socket.readyState === WebSocket.CLOSED) {
      clearTimeout(retry);
      open();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  return {
    send,
    close: () => {
      closedByUser = true;
      clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
      socket.close();
    },
  };
}
