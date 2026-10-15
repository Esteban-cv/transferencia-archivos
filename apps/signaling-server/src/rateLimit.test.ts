import { describe, expect, it } from 'vitest';
import { ConnectionRateLimiter, MessageRateLimiter, clientIp } from './rateLimit';

describe('ConnectionRateLimiter', () => {
  it('deja pasar hasta el límite de conexiones concurrentes por IP', () => {
    const limiter = new ConnectionRateLimiter(100, 3);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(false);
  });

  it('libera un cupo al cerrar una conexión', () => {
    const limiter = new ConnectionRateLimiter(100, 1);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(false);
    limiter.release('1.2.3.4');
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
  });

  it('no deja pasar más conexiones nuevas que el máximo por minuto', () => {
    const limiter = new ConnectionRateLimiter(2, 100);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(false);
  });

  it('no mezcla los contadores de IPs distintas', () => {
    const limiter = new ConnectionRateLimiter(100, 1);
    expect(limiter.tryAcquire('1.1.1.1')).toBe(true);
    expect(limiter.tryAcquire('2.2.2.2')).toBe(true);
  });
});

describe('MessageRateLimiter', () => {
  it('corta tras agotar los mensajes permitidos por segundo', () => {
    const start = Date.now();
    const limiter = new MessageRateLimiter(5);
    for (let i = 0; i < 5; i++) expect(limiter.allow(start)).toBe(true);
    expect(limiter.allow(start)).toBe(false);
  });

  it('recupera margen con el tiempo (cubeta de tokens)', () => {
    const start = Date.now();
    const limiter = new MessageRateLimiter(10);
    for (let i = 0; i < 10; i++) limiter.allow(start);
    expect(limiter.allow(start)).toBe(false);
    expect(limiter.allow(start + 500)).toBe(true); // medio segundo después: ~5 tokens repuestos
  });
});

describe('clientIp', () => {
  it('usa la IP del socket cuando no se confía en el proxy', () => {
    expect(clientIp('10.0.0.5', '203.0.113.9', false)).toBe('10.0.0.5');
  });

  it('usa X-Forwarded-For solo cuando se confía en el proxy', () => {
    expect(clientIp('10.0.0.5', '203.0.113.9, 10.0.0.1', true)).toBe('203.0.113.9');
  });

  it('cae de vuelta a la IP del socket si no hay X-Forwarded-For', () => {
    expect(clientIp('10.0.0.5', undefined, true)).toBe('10.0.0.5');
  });
});
