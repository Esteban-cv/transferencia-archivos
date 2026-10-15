import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const openContexts: BrowserContext[] = [];

/** Cierra los dispositivos abiertos en la prueba anterior. */
export async function closeDevices() {
  await Promise.all(openContexts.splice(0).map((c) => c.close()));
}

export interface Device {
  page: Page;
  name: string;
}

/** Abre la app en un "dispositivo" nuevo (contexto aislado) y le pone nombre. */
export async function openDevice(browser: Browser, name: string, path = '/', mobile = false): Promise<Device> {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile' } : {},
  );
  openContexts.push(context);
  await context.addInitScript((deviceName) => localStorage.setItem('transfer.deviceName', deviceName), name);
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log(`[${name}] error:`, err.message));
  await page.goto(path);
  await expect(page.locator('.status-dot.online')).toBeVisible();
  return { page, name };
}

export async function selectPeer(from: Device, to: Device) {
  const item = from.page.locator('.list-group-item', { hasText: to.name });
  await expect(item).toBeVisible();
  if ((await item.getAttribute('aria-pressed')) !== 'true') await item.click();
}

export async function accept(device: Device, { toFolder = false } = {}) {
  const card = device.page.getByRole('alertdialog');
  await expect(card).toBeVisible();
  const toggle = card.getByRole('switch');
  if ((await toggle.count()) && (await toggle.isChecked()) !== toFolder) await toggle.click();
  await card.getByRole('button', { name: /aceptar/i }).click();
}

/** Crea archivos de prueba en una carpeta temporal y devuelve su ruta. */
export function makeFiles(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'transfer-e2e-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

export function randomBuffer(size: number) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i += 4) buf.writeUInt32LE((i * 2654435761) >>> 0, Math.min(i, size - 4));
  return buf;
}
