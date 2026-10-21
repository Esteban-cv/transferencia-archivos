import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.min.css';
import { App } from './App';
import { loadIceServers } from './rtc/iceServers';
import './styles.css';

// Tema claro u oscuro según el sistema del dispositivo
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () =>
  document.documentElement.setAttribute('data-bs-theme', dark.matches ? 'dark' : 'light');
applyTheme();
dark.addEventListener('change', applyTheme);

// Service worker: permite instalar la app y recibir archivos desde "Compartir".
// Los navegadores solo lo permiten con HTTPS (o en localhost).
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Pide al servidor el relevo TURN (si lo tiene) antes de crear conexiones
loadIceServers().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
