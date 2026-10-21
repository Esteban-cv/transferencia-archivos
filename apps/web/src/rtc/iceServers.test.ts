import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentIceServers, loadIceServers, resetIceServersForTests } from './iceServers';

const STUN = { urls: 'stun:stun.l.google.com:19302' };
const TURN = { urls: 'turn:global.relay.metered.ca:80', username: 'u', credential: 'c' };

describe('iceServers', () => {
  beforeEach(() => resetIceServersForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('empieza solo con STUN', () => {
    expect(currentIceServers()).toEqual([STUN]);
  });

  it('agrega los TURN del servidor sin perder el STUN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ iceServers: [TURN] }) }));
    await loadIceServers();
    expect(currentIceServers()).toEqual([STUN, TURN]);
  });

  it('con lista vacía se queda solo con STUN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ iceServers: [] }) }));
    await loadIceServers();
    expect(currentIceServers()).toEqual([STUN]);
  });

  it('si falla la petición no rompe y se queda solo con STUN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')));
    await expect(loadIceServers()).resolves.toBeUndefined();
    expect(currentIceServers()).toEqual([STUN]);
  });
});
