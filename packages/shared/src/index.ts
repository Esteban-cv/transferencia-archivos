/**
 * Contrato de mensajes entre el navegador y el servidor de señalización.
 * El servidor solo reenvía estos mensajes: los archivos nunca pasan por él,
 * viajan directo entre dispositivos por WebRTC.
 */

export const DEFAULT_PORT = 8787;

/** Ruta del WebSocket de señalización, en el mismo puerto que la app. */
export const SIGNALING_PATH = '/ws';

/** Sala por defecto: todos los que abren la app sin código. */
export const PUBLIC_ROOM = '';

export const ROOM_CODE_LENGTH = 6;

/** Normaliza un código de sala: mayúsculas, sin espacios ni símbolos. */
export function normalizeRoom(room: string | null | undefined): string {
  return (room ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

export type DeviceKind = 'desktop' | 'mobile' | 'tablet';

export interface PeerInfo {
  id: string;
  name: string;
  kind: DeviceKind;
}

/** Payload WebRTC que se reenvía tal cual entre dos dispositivos. */
export type SignalPayload =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit };

/** Navegador -> servidor */
export type ClientMessage =
  | { type: 'hello'; name: string; kind: DeviceKind; room: string }
  | { type: 'signal'; to: string; payload: SignalPayload };

/** Servidor -> navegador */
export type ServerMessage =
  | { type: 'welcome'; self: PeerInfo; peers: PeerInfo[]; room: string }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; id: string }
  | { type: 'signal'; from: string; payload: SignalPayload }
  | { type: 'error'; message: string }
  /** El servidor exige una sala (modo público en internet) y esta conexión no mandó código. */
  | { type: 'room-required' };

/** Respuesta de GET /api/info: cómo llegar a este servidor desde la red. */
export interface ServerInfo {
  addresses: string[];
  port: number;
  https: boolean;
  /** true cuando el servidor no deja usar la sala pública (ver REQUIRE_ROOM). */
  requireRoom: boolean;
}
