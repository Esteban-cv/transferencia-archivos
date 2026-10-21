/**
 * Credenciales TURN de Metered (plan gratis) para que dos dispositivos en
 * redes distintas (por ejemplo datos móviles de operadoras distintas, detrás
 * de CGNAT) puedan conectarse cuando la conexión directa falla. El relevo solo
 * reenvía los paquetes ya cifrados por WebRTC: los archivos nunca se ven ahí.
 */
export interface TurnOptions {
  /** Nombre de la app en Metered (el subdominio de <nombre>.metered.live). */
  meteredAppName?: string;
  /** API key de Metered para pedir credenciales TURN. */
  meteredApiKey?: string;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface Cache {
  servers: unknown[];
  fetchedAt: number;
}

let cache: Cache | null = null;

export function turnConfigured(options: TurnOptions): boolean {
  return Boolean(options.meteredAppName && options.meteredApiKey);
}

export async function getIceServers(options: TurnOptions, now = Date.now()): Promise<unknown[]> {
  if (!turnConfigured(options)) return [];
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.servers;

  const url = `https://${options.meteredAppName}.metered.live/api/v1/turn/credentials?apiKey=${options.meteredApiKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Metered respondió ${res.status}`);
    const servers = await res.json();
    if (!Array.isArray(servers)) throw new Error('Respuesta de Metered con formato inesperado');
    cache = { servers, fetchedAt: now };
    return servers;
  } catch (err) {
    console.error('No se pudieron obtener credenciales TURN de Metered:', err);
    return cache?.servers ?? [];
  }
}

export function resetTurnCacheForTests() {
  cache = null;
}
