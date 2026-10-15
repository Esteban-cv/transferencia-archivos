import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { zipBlobs } from './zip';

describe('zip', () => {
  it('arma un zip con la estructura de carpetas', async () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 256);
    const zip = await zipBlobs([
      { path: 'Proyecto/leeme.txt', blob: new Blob(['hola']) },
      { path: 'Proyecto/datos/grande.bin', blob: new Blob([big]) },
      { path: 'Proyecto/vacío.txt', blob: new Blob([]) },
    ]);
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['Proyecto/datos/grande.bin', 'Proyecto/leeme.txt', 'Proyecto/vacío.txt']);
    expect(strFromU8(files['Proyecto/leeme.txt'])).toBe('hola');
    // Comparar como Buffer: toEqual sobre millones de bytes es muy lento
    expect(Buffer.from(files['Proyecto/datos/grande.bin']).equals(Buffer.from(big))).toBe(true);
  });
});
