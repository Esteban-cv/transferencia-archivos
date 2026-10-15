import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Expone el servidor en la red local para abrirlo desde el celular
    host: true,
    port: 5173,
  },
});
