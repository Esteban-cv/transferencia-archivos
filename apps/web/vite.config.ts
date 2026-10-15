/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { DEFAULT_PORT } from '../../packages/shared/src/index';

const backend = `localhost:${process.env.PORT ?? DEFAULT_PORT}`;

export default defineConfig({
  plugins: [react()],
  server: {
    // Expone Vite en la red local para abrirlo desde el celular
    host: true,
    port: 5173,
    // En desarrollo la señalización corre aparte; se reenvía para usar el mismo origen
    proxy: {
      '/ws': {
        target: `ws://${backend}`,
        ws: true,
        // Cerrar una pestaña corta el socket: no es un error que valga mostrar
        configure: (proxy) => proxy.on('error', () => {}),
      },
      '/api': `http://${backend}`,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
