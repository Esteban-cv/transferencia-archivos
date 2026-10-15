import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '@transfer/shared';
import { startAppServer } from './server';
import { lanAddresses } from './network';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const staticDir = resolve(repoRoot, 'apps/web/dist');
const certFile = resolve(repoRoot, 'certs/cert.pem');
const keyFile = resolve(repoRoot, 'certs/key.pem');
const tls = existsSync(certFile) && existsSync(keyFile) ? { cert: certFile, key: keyFile } : undefined;
const devMode = process.argv.includes('--dev');

// Variables de entorno para cuando el servidor queda expuesto en internet
// (ver "Publicarla en internet" en el README). En LAN no hace falta tocarlas.
const requireRoom = ['1', 'true'].includes((process.env.REQUIRE_ROOM ?? '').toLowerCase());
const trustProxy = ['1', 'true'].includes((process.env.TRUST_PROXY ?? '').toLowerCase());
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

try {
  const app = await startAppServer({
    port,
    staticDir: devMode ? undefined : staticDir,
    tls,
    requireRoom,
    trustProxy,
    allowedOrigins,
  });
  const scheme = app.https ? 'https' : 'http';

  console.log('');
  if (devMode) {
    console.log(`  Señalización lista en el puerto ${app.port} (modo desarrollo)`);
  } else {
    console.log('  Transferencia de archivos lista. Abre en cualquier dispositivo del mismo WiFi:');
    console.log('');
    console.log(`    Esta PC:   ${scheme}://localhost:${app.port}`);
    for (const ip of lanAddresses()) console.log(`    En la red: ${scheme}://${ip}:${app.port}`);
    console.log('');
    console.log('  Deja esta ventana abierta mientras la usen. Ctrl+C para cerrar.');
  }
  if (requireRoom) console.log('  Modo público: cada quien necesita un código de sala para verse con otros.');
  if (trustProxy) console.log('  Confiando en X-Forwarded-For para la IP real (TRUST_PROXY=1).');
  if (allowedOrigins?.length) console.log(`  Solo se aceptan conexiones desde: ${allowedOrigins.join(', ')}`);
  console.log('');

  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`\n  El puerto ${port} ya está en uso. ¿Ya hay otra ventana con la app abierta?\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
}
