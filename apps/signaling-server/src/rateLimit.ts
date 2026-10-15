/**
 * Límites anti-abuso para cuando el servidor queda expuesto en internet.
 * Nada de esto protege los archivos (nunca pasan por aquí); es solo para
 * que una sola IP no pueda saturar el servidor de señalización.
 */

const WINDOW_MS = 60_000;

/** Cuántas conexiones nuevas deja abrir una misma IP por minuto. */
export const MAX_CONNECTIONS_PER_MINUTE = 30;
/** Cuántas conexiones simultáneas deja tener abiertas una misma IP. */
export const MAX_CONCURRENT_PER_IP = 12;
/** Mensajes por segundo que deja mandar una conexión antes de cortarla. */
export const MAX_MESSAGES_PER_SECOND = 20;

/** Ventana deslizante simple: cuenta eventos recientes por clave. */
class SlidingWindowCounter {
  private hits = new Map<string, number[]>();

  constructor(private readonly windowMs: number) {}

  /** Registra un evento y devuelve cuántos caben en la ventana actual. */
  hit(key: string, now = Date.now()): number {
    const list = this.hits.get(key) ?? [];
    const cutoff = now - this.windowMs;
    const kept = list.filter((t) => t > cutoff);
    kept.push(now);
    this.hits.set(key, kept);
    return kept.length;
  }

  /** Limpia claves sin actividad reciente, para no crecer sin fin. */
  sweep(now = Date.now()) {
    const cutoff = now - this.windowMs;
    for (const [key, list] of this.hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }
}

/** Cuántas conexiones nuevas aceptó cada IP en el último minuto. */
export class ConnectionRateLimiter {
  private readonly window = new SlidingWindowCounter(WINDOW_MS);
  private readonly concurrent = new Map<string, number>();

  constructor(
    private readonly maxPerMinute = MAX_CONNECTIONS_PER_MINUTE,
    private readonly maxConcurrent = MAX_CONCURRENT_PER_IP,
  ) {}

  /** true si esta IP puede abrir una conexión más ahora mismo. */
  tryAcquire(ip: string): boolean {
    if ((this.concurrent.get(ip) ?? 0) >= this.maxConcurrent) return false;
    if (this.window.hit(ip) > this.maxPerMinute) return false;
    this.concurrent.set(ip, (this.concurrent.get(ip) ?? 0) + 1);
    return true;
  }

  /** Se llama cuando esa conexión se cierra. */
  release(ip: string) {
    const current = this.concurrent.get(ip);
    if (!current) return;
    if (current <= 1) this.concurrent.delete(ip);
    else this.concurrent.set(ip, current - 1);
  }

  sweep() {
    this.window.sweep();
  }
}

/** Limita cuántos mensajes por segundo manda una conexión (cubeta simple). */
export class MessageRateLimiter {
  private tokens: number;
  private last = Date.now();

  constructor(private readonly perSecond = MAX_MESSAGES_PER_SECOND) {
    this.tokens = perSecond;
  }

  /** true si este mensaje está dentro del límite; si no, ya se consumió todo el margen. */
  allow(now = Date.now()): boolean {
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.perSecond, this.tokens + elapsed * this.perSecond);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * La IP real del cliente. Solo confía en X-Forwarded-For cuando el
 * servidor corre detrás de un proxy conocido (Render, Cloudflare, etc.):
 * sin eso, cualquiera podría falsificar el encabezado para saltarse el límite.
 */
export function clientIp(socketAddress: string | undefined, forwardedFor: string | undefined, trustProxy: boolean): string {
  if (trustProxy && forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return socketAddress ?? 'desconocida';
}
