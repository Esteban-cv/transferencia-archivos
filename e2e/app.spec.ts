import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { accept, closeDevices, makeFiles, openDevice, randomBuffer, selectPeer } from './helpers';

test.afterEach(closeDevices);

// PNG de 1x1 para probar la vista previa
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('envía archivos a dos dispositivos a la vez y llegan idénticos', async ({ browser }) => {
  const big = randomBuffer(25 * 1024 * 1024);
  const dir = makeFiles({ 'grande.bin': big, 'foto.png': PIXEL_PNG, 'nota.txt': 'hola' });
  const pc = await openDevice(browser, 'PC Oficina');
  const cel1 = await openDevice(browser, 'Celular Ana', '/', true);
  const cel2 = await openDevice(browser, 'Celular Luis', '/', true);

  await selectPeer(pc, cel1);
  await selectPeer(pc, cel2);
  await pc.page.getByTestId('file-input').setInputFiles(['grande.bin', 'foto.png', 'nota.txt'].map((f) => join(dir, f)));
  await pc.page.getByRole('button', { name: 'Enviar a 2 dispositivos' }).click();

  for (const cel of [cel1, cel2]) {
    await expect(cel.page.getByRole('alertdialog')).toContainText('PC Oficina quiere enviarte');
    await accept(cel);
  }
  for (const cel of [cel1, cel2]) {
    await expect(cel.page.locator('.transfer.is-done')).toBeVisible({ timeout: 60_000 });
    await expect(cel.page.locator('.previews img')).toHaveCount(1);
  }
  await expect(pc.page.locator('.transfer.is-done')).toHaveCount(2);

  const [download] = await Promise.all([
    cel2.page.waitForEvent('download'),
    cel2.page.locator('a[download="grande.bin"]').first().click(),
  ]);
  expect(readFileSync(await download.path()).equals(big)).toBe(true);
});

test('envía una carpeta completa y se descarga como ZIP con su estructura', async ({ browser }) => {
  const dir = makeFiles({
    'Informe/resumen.txt': 'resumen',
    'Informe/anexos/tabla.csv': 'a,b\n1,2',
    'Informe/anexos/grafica.bin': randomBuffer(300 * 1024),
  });
  const pc = await openDevice(browser, 'PC Carpeta');
  const otra = await openDevice(browser, 'PC Destino');

  await selectPeer(pc, otra);
  await pc.page.getByTestId('folder-input').setInputFiles(join(dir, 'Informe'));
  await expect(pc.page.locator('.file-list')).toContainText('Informe');
  await expect(pc.page.locator('.file-list')).toContainText('3 archivos');
  await pc.page.getByRole('button', { name: 'Enviar a 1 dispositivo' }).click();

  await accept(otra, { toFolder: false });
  await expect(otra.page.locator('.transfer.is-done')).toBeVisible();

  const [download] = await Promise.all([
    otra.page.waitForEvent('download'),
    otra.page.getByRole('button', { name: /Guardar todo \(\.zip\)/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Informe.zip');
  const entries = unzipSync(readFileSync(await download.path()));
  expect(Object.keys(entries).sort()).toEqual([
    'Informe/anexos/grafica.bin',
    'Informe/anexos/tabla.csv',
    'Informe/resumen.txt',
  ]);
  expect(Buffer.from(entries['Informe/anexos/tabla.csv']).toString()).toBe('a,b\n1,2');
});

test('guarda directo en una carpeta del disco, recreando subcarpetas', async ({ browser }) => {
  const dir = makeFiles({ 'Fotos/viaje/playa.bin': randomBuffer(200 * 1024), 'Fotos/lista.txt': 'ok' });
  const pc = await openDevice(browser, 'PC Origen');
  const destino = await openDevice(browser, 'PC Disco');
  // El selector de carpetas no se puede tocar en una prueba: se reemplaza por
  // el sistema de archivos privado del navegador, que usa la misma API.
  await destino.page.evaluate(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = () =>
      navigator.storage.getDirectory();
  });

  await selectPeer(pc, destino);
  await pc.page.getByTestId('folder-input').setInputFiles(join(dir, 'Fotos'));
  await pc.page.getByRole('button', { name: 'Enviar a 1 dispositivo' }).click();
  await accept(destino, { toFolder: true });
  await expect(destino.page.locator('.transfer.is-done')).toContainText('Guardado en la carpeta');

  const written = await destino.page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const fotos = await root.getDirectoryHandle('Fotos');
    const viaje = await fotos.getDirectoryHandle('viaje');
    const playa = await (await viaje.getFileHandle('playa.bin')).getFile();
    const lista = await (await fotos.getFileHandle('lista.txt')).getFile();
    return { playa: playa.size, lista: await lista.text() };
  });
  expect(written).toEqual({ playa: 200 * 1024, lista: 'ok' });
});

test('rechazar y cancelar avisan al otro lado', async ({ browser }) => {
  const dir = makeFiles({ 'a.txt': 'a' });
  const pc = await openDevice(browser, 'PC Rechazo');
  const cel = await openDevice(browser, 'Celular Rechazo', '/', true);
  await selectPeer(pc, cel);

  await pc.page.getByTestId('file-input').setInputFiles(join(dir, 'a.txt'));
  await pc.page.getByRole('button', { name: 'Enviar a 1 dispositivo' }).click();
  await cel.page.getByRole('alertdialog').getByRole('button', { name: 'Rechazar' }).click();
  await expect(pc.page.locator('.transfer.is-rejected')).toBeVisible();

  // El emisor cancela antes de que respondan: la solicitud desaparece del receptor
  await pc.page.getByTestId('file-input').setInputFiles(join(dir, 'a.txt'));
  await pc.page.getByRole('button', { name: 'Enviar a 1 dispositivo' }).click();
  await expect(cel.page.getByRole('alertdialog')).toBeVisible();
  await pc.page.locator('.transfer.is-waiting').getByRole('button', { name: 'Cancelar' }).click();
  await expect(cel.page.getByRole('alertdialog')).toHaveCount(0);
  await expect(cel.page.locator('.transfer.is-cancelled')).toContainText('canceló');
});

test('el receptor puede cancelar a mitad de un archivo grande', async ({ browser }) => {
  const dir = makeFiles({ 'enorme.bin': randomBuffer(400 * 1024 * 1024) });
  const pc = await openDevice(browser, 'PC Grande');
  const cel = await openDevice(browser, 'Celular Grande', '/', true);
  await selectPeer(pc, cel);
  await pc.page.getByTestId('file-input').setInputFiles(join(dir, 'enorme.bin'));
  await pc.page.getByRole('button', { name: 'Enviar a 1 dispositivo' }).click();
  await accept(cel);

  // Se ven velocidad y tiempo restante mientras avanza
  await expect(cel.page.locator('.transfer-stats')).toContainText(/\/s · quedan/);
  await cel.page.locator('.transfer.is-active').getByRole('button', { name: 'Cancelar' }).click();
  await expect(cel.page.locator('.transfer.is-cancelled')).toBeVisible();
  await expect(pc.page.locator('.transfer.is-cancelled, .transfer.is-error')).toBeVisible();
});

test('envía un texto o link y se puede abrir', async ({ browser }) => {
  const pc = await openDevice(browser, 'PC Texto');
  const cel = await openDevice(browser, 'Celular Texto', '/', true);
  await selectPeer(cel, pc);
  await cel.page.getByRole('button', { name: /Texto o link/ }).click();
  await cel.page.getByLabel('Texto a enviar').fill('https://ejemplo.com/documento');
  await cel.page.getByRole('button', { name: 'Enviar a 1 dispositivo' }).click();

  const mensaje = pc.page.locator('.transfer.text');
  await expect(mensaje).toContainText('Mensaje de Celular Texto');
  await expect(mensaje).toContainText('https://ejemplo.com/documento');
  await expect(mensaje.getByRole('link', { name: 'Abrir link' })).toHaveAttribute('href', 'https://ejemplo.com/documento');
});

test('las salas privadas aíslan dispositivos y el QR lleva el código', async ({ browser }) => {
  const publico = await openDevice(browser, 'PC Pública');
  const a = await openDevice(browser, 'PC Sala A');

  await a.page.getByRole('button', { name: 'Conectar' }).click();
  const modal = a.page.getByRole('dialog');
  await modal.getByRole('button', { name: 'Crear sala' }).click();
  const code = (await modal.locator('.badge.font-monospace').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await expect(modal.locator('.qr svg')).toBeVisible();
  await expect(modal.getByLabel('Dirección')).toHaveValue(new RegExp(`sala=${code}$`));
  await modal.getByRole('button', { name: 'Cerrar' }).click();

  const b = await openDevice(browser, 'PC Sala B', `/?sala=${code}`);
  await expect(a.page.locator('.list-group-item', { hasText: 'PC Sala B' })).toBeVisible();
  await expect(b.page.locator('.list-group-item', { hasText: 'PC Sala A' })).toBeVisible();
  await expect(a.page.locator('.list-group-item', { hasText: 'PC Pública' })).toHaveCount(0);
  await expect(publico.page.locator('.list-group-item', { hasText: 'PC Sala' })).toHaveCount(0);
});
