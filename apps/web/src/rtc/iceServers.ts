/**
 * Servidores ICE para WebRTC. En la misma red local se conecta directo con los
 * candidatos "host"; el STUN público ayuda cuando hay NAT de por medio. Si el
 * servidor tiene relevo TURN configurado (Metered), se agrega para que también
 * conecte entre redes distintas, como datos móviles. Ninguno ve los archivos.
 */
const STUN_ONLY: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

let current: RTCIceServer[] = STUN_ONLY;

export function currentIceServers(): RTCIceServer[] {
  return current;
}

export async function loadIceServers() {
  try {
    const res = await fetch('/api/turn-credentials', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      current = [...STUN_ONLY, ...data.iceServers];
    }
  } catch {
    // sigue con solo STUN
  }
}

export function resetIceServersForTests() {
  current = STUN_ONLY;
}
