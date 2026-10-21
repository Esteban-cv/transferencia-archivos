import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getIceServers, resetTurnCacheForTests, turnConfigured } from './turnCredentials';

const options = { meteredAppName: 'miapp', meteredApiKey: 'clave123' };
const servers = [{ urls: 'turn:global.relay.metered.ca:80', username: 'u', credential: 'c' }];
const HOUR = 60 * 60 * 1000;

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe('turnCredentials', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetTurnCacheForTests();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('solo se considera configurado con nombre de app y API key', () => {
    expect(turnConfigured({})).toBe(false);
    expect(turnConfigured({ meteredAppName: 'miapp' })).toBe(false);
    expect(turnConfigured({ meteredApiKey: 'clave123' })).toBe(false);
    expect(turnConfigured(options)).toBe(true);
  });

  it('sin configurar no llama a Metered y devuelve lista vacía', async () => {
    expect(await getIceServers({})).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pide las credenciales a la URL de la app en Metered', async () => {
    fetchMock.mockResolvedValue(okResponse(servers));
    expect(await getIceServers(options, 0)).toEqual(servers);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://miapp.metered.live/api/v1/turn/credentials?apiKey=clave123',
      expect.anything(),
    );
  });

  it('cachea dentro de la ventana y vuelve a pedir pasadas 6 horas', async () => {
    fetchMock.mockResolvedValue(okResponse(servers));
    await getIceServers(options, 0);
    await getIceServers(options, 5 * HOUR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getIceServers(options, 6 * HOUR + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('si Metered falla devuelve la última cache buena', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(servers));
    await getIceServers(options, 0);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    expect(await getIceServers(options, 7 * HOUR)).toEqual(servers);
  });

  it('si Metered falla sin cache previa devuelve lista vacía sin romper', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'));
    expect(await getIceServers(options, 0)).toEqual([]);
    fetchMock.mockResolvedValue(okResponse({ error: 'formato raro' }));
    expect(await getIceServers(options, 0)).toEqual([]);
  });
});
