# Transferencia de archivos

App web para pasar archivos entre cualquier dispositivo (PC, celular, tablet) conectado al mismo WiFi, directo desde el navegador. Los archivos viajan P2P por WebRTC; el servidor solo ayuda a que los dispositivos se encuentren.

## Estructura

```
apps/
  web/               React + Vite + TypeScript (lo que abre el usuario)
  signaling-server/  Node + ws: descubrimiento de dispositivos y señalización WebRTC
packages/
  shared/            Tipos de mensajes compartidos entre web y servidor
```

## Requisitos

- Node.js 20 o superior

## Cómo correrlo

```bash
npm install
npm run dev
```

Eso levanta el servidor de señalización (puerto 8787) y Vite (puerto 5173). En la consola de Vite aparece una URL tipo `http://192.168.x.x:5173`: ábrela en la PC y en el celular (mismo WiFi) y cada uno verá al otro en la lista de dispositivos.

Si Windows pregunta por el firewall, permite el acceso en redes privadas para Node.

## Cómo se usa

1. Abre la app en dos o más dispositivos conectados al mismo WiFi.
2. En el que envía, marca uno o varios dispositivos de la lista y elige (o arrastra) los archivos.
3. Cada receptor ve la solicitud y elige **Aceptar** o **Rechazar**.
4. Al terminar, cada archivo aparece con un enlace **Guardar**.

## Hoja de ruta

1. [x] Estructura del monorepo y descubrimiento de dispositivos en la red
2. [x] Conexión WebRTC entre dispositivos y envío de archivos
3. [x] Envío por chunks con control de backpressure
4. [x] Varios archivos por envío
5. [x] Un emisor a varios receptores (mesh P2P)
6. [ ] Guardado en disco por streaming (File System Access API / StreamSaver), necesario para archivos de varios GB
7. [ ] Envío de carpetas completas
8. [ ] HTTPS en LAN y PWA
