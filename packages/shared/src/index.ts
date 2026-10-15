/**
 * Contrato de mensajes entre el navegador y el servidor de señalización.
 * El servidor solo reenvía estos mensajes: los archivos nunca pasan por él,
 * viajan directo entre dispositivos por WebRTC.
 */

export const DEFAULT_SIGNALING_PORT = 8787;

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
  | { type: 'hello'; name: string; kind: DeviceKind }
  | { type: 'signal'; to: string; payload: SignalPayload };

/** Servidor -> navegador */
export type ServerMessage =
  | { type: 'welcome'; self: PeerInfo; peers: PeerInfo[] }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; id: string }
  | { type: 'signal'; from: string; payload: SignalPayload }
  | { type: 'error'; message: string };
