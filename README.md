# Transferencia de archivos

App web para pasar archivos, carpetas y textos entre cualquier dispositivo (PC, celular, tablet) conectado al mismo WiFi, directo desde el navegador. Sin cuentas, sin subir nada a internet y sin límite de tamaño.

Los archivos viajan **directo entre los dispositivos** por WebRTC. El servidor solo sirve la página y ayuda a que los dispositivos se encuentren.

## Usarla (para todos)

1. Alguien en la oficina deja la app corriendo en su PC (ver abajo).
2. Los demás abren en el navegador la dirección que muestra la consola, por ejemplo `http://192.168.1.25:8787`, o escanean el **código QR** del botón **Conectar**.
3. Marca uno o varios dispositivos, elige archivos o una carpeta (o arrástralos, o pégalos con Ctrl+V) y envía.
4. Cada receptor acepta o rechaza. Al terminar puede guardar archivo por archivo, todo en un `.zip`, o, desde Chrome/Edge en la PC donde corre la app, directo en una carpeta.

También puedes mandar **texto o links** (llegan al instante, listos para copiar o abrir) y crear una **sala privada** con código para que solo te vean tus compañeros de equipo.

## Iniciar la app

Requisito: [Node.js](https://nodejs.org) 20 o superior.

**Windows:** doble clic en `Iniciar.bat`. La primera vez instala las dependencias; después arranca directo.

**Cualquier sistema:**

```bash
npm install
npm start
```

`npm start` compila la app y la sirve en el puerto **8787** (cámbialo con la variable `PORT`). Deja esa ventana abierta mientras la usen. Si Windows pregunta por el firewall, permite el acceso en **redes privadas**.

> Si en la terminal de VS Code (PowerShell) sale "la ejecución de scripts está deshabilitada", usa `npm.cmd start` o cambia la terminal a Command Prompt.

## Funciones

| Función | Detalle |
|---|---|
| Varios receptores a la vez | El emisor abre una conexión directa con cada uno |
| Archivos grandes | Probado con 1,5 GB: el receptor usa ~4 MB de memoria de JavaScript porque los datos se agrupan en Blobs que el navegador maneja fuera de la memoria de la página |
| Guardar directo en disco | Chrome/Edge de escritorio, en contexto seguro (localhost o HTTPS): escribe mientras llega, recreando subcarpetas |
| Carpetas | Elegir carpeta o arrastrarla; se conserva la estructura. Descarga en `.zip` (hasta 3,9 GB) |
| Velocidad y tiempo restante | Con botón para cancelar desde cualquiera de los dos lados |
| Texto y links | Sin confirmación, con botones Copiar y Abrir link |
| Salas privadas | Código de 6 caracteres; el QR ya lo incluye |
| Avisos | Sonido, vibración, contador en el título y notificación del sistema (con HTTPS) |
| Vista previa | Miniaturas de las imágenes recibidas |
| App instalable (PWA) | Con HTTPS: se instala en el celular y aparece en el menú **Compartir** de Android |

## HTTPS en la red local (opcional)

Sin HTTPS todo lo esencial funciona. Con HTTPS además se habilitan: instalar como app, recibir desde el menú Compartir, notificaciones del sistema, y guardar directo en carpeta desde otras PCs.

1. Instala [mkcert](https://github.com/FiloSottile/mkcert) y corre `mkcert -install`.
2. En la carpeta del proyecto: `mkdir certs` y luego
   `mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 192.168.1.25` (con la IP de tu PC).
3. `npm start` detecta los certificados y sirve por `https://`.
4. En cada celular instala el certificado raíz de mkcert (`mkcert -CAROOT` muestra dónde está) para que el navegador confíe en él.

## Publicarla en internet

Para que funcione sin que tu PC se quede prendida, con una URL fija, hay que subirla a un servidor (por ejemplo [Render](https://render.com), que tiene un plan gratis). Ahí ya no es tu WiFi local, así que el servidor queda expuesto a cualquiera en internet. Antes de publicarla así, activa estas variables de entorno:

| Variable | Para qué sirve |
| --- | --- |
| `REQUIRE_ROOM=1` | Obliga a cada dispositivo a usar un código de sala. Sin esto, cualquiera que encuentre la URL vería y podría conectarse con todos los demás. Con esto activo, la app genera y comparte el código sola (QR o link) la primera vez que alguien entra. |
| `TRUST_PROXY=1` | Necesario en Render (y en cualquier hosting detrás de un proxy): hace que los límites de conexiones por minuto se cuenten por la IP real de quien se conecta, y no por la IP del proxy. |
| `ALLOWED_ORIGINS=https://tu-app.onrender.com` | Opcional. Si se pone, el servidor rechaza conexiones que no vengan de esa URL exacta (bloquea que otra página intente usar tu servidor). Varias URLs se separan con coma. |

Con `REQUIRE_ROOM=1` ya nadie puede ver "tu PC" ni a los demás sin el código de la sala, y los límites de `rateLimit.ts` (máximo de conexiones nuevas por minuto, conexiones simultáneas por IP, y mensajes por segundo) evitan que una sola IP sature el servidor. Ningún archivo pasa nunca por el servidor — solo coordina la conexión directa entre dispositivos —, así que esto protege la señalización, no el contenido de las transferencias (que ya viaja cifrado punto a punto por WebRTC).

Pasos para Render (plan gratis):

1. Sube este repositorio a GitHub (si no lo has hecho).
2. En Render: **New > Web Service**, conecta el repositorio.
3. Build command: `npm install && npm run build`. Start command: `npm run serve`.
4. En **Environment**, agrega `REQUIRE_ROOM=1` y `TRUST_PROXY=1` (y `ALLOWED_ORIGINS` una vez que sepas la URL que te da Render).
5. Al desplegar te da una URL como `https://transferencia-archivos.onrender.com`. Ese es el link fijo para compartir.

El plan gratis de Render apaga el servicio tras ~15 minutos sin uso y tarda unos segundos en despertar con la primera visita — normal, no es un error.

## Desarrollo

```bash
npm run dev        # servidor + Vite con recarga en caliente en http://localhost:5173
npm run typecheck  # revisa tipos
npm test           # pruebas unitarias (protocolo, servidor, zip)
npm run build && npm run test:e2e   # pruebas en navegador real con Playwright
```

La primera vez que corras las pruebas de navegador: `npx playwright install chromium`.

GitHub Actions corre todo lo anterior en cada push y pull request (`.github/workflows/ci.yml`).

### Estructura

```
apps/
  web/                React + Vite + TypeScript + Bootstrap
    src/rtc/          Conexión WebRTC, protocolo de transferencia y destinos de escritura
    src/components/   Interfaz
    src/lib/          Formatos, carpetas, zip, avisos, salas
    public/           Íconos, manifest y service worker (PWA)
  signaling-server/   Node: sirve la app, señalización por salas (WebSocket /ws) e /api/info
packages/
  shared/             Tipos de mensajes compartidos entre web y servidor
e2e/                  Pruebas de punta a punta con Playwright
```

### Cómo funciona una transferencia

1. Cada navegador se conecta por WebSocket a `/ws` y entra a una sala (la pública o una con código).
2. Para enviar, el emisor abre un `RTCDataChannel` hacia cada receptor; la negociación (SDP/ICE) pasa por el servidor.
3. Por el canal viaja una oferta con la lista de archivos; si el receptor acepta, los archivos van en trozos de 64 KB con control de flujo.
4. El receptor escribe cada trozo en memoria (Blobs) o directo en disco, y confirma al final.

## Limitaciones conocidas

- Algunas redes WiFi corporativas aíslan a los dispositivos entre sí. Si no se ven, prueba con el hotspot del celular.
- En el celular, archivos de varios GB dependen de la memoria y el espacio del teléfono, porque los navegadores móviles no permiten escribir directo en una carpeta.
- Sin HTTPS no se puede instalar como app ni usar el menú Compartir; es una regla de los navegadores.
