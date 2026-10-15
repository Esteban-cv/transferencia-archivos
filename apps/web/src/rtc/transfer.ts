/**
 * Protocolo de transferencia sobre un RTCDataChannel ordenado.
 *
 *   emisor                         receptor
 *   offer {files}          ──►
 *                          ◄──     accept | reject
 *   file {index}           ──►
 *   <chunks binarios>      ──►
 *   file-end {index}       ──►     (se repite por cada archivo)
 *   end                    ──►
 *                          ◄──     done
 *
 * Los mensajes de control viajan como texto JSON y los datos como binario.
 */

export const CHUNK_SIZE = 64 * 1024;
const BUFFER_HIGH = 8 * 1024 * 1024;
const BUFFER_LOW = 1 * 1024 * 1024;

export interface FileMeta {
  name: string;
  size: number;
  type: string;
}

export interface TransferOffer {
  senderName: string;
  files: FileMeta[];
  totalBytes: number;
}

export interface ReceivedFile extends FileMeta {
  blob: Blob;
}

type Control =
  | { t: 'offer'; senderName: string; files: FileMeta[] }
  | { t: 'accept' }
  | { t: 'reject' }
  | { t: 'file'; index: number }
  | { t: 'file-end'; index: number }
  | { t: 'end' }
  | { t: 'done' };

export class TransferRejectedError extends Error {
  constructor() {
    super('El receptor rechazó la transferencia');
  }
}

function sendControl(channel: RTCDataChannel, msg: Control) {
  channel.send(JSON.stringify(msg));
}

function waitOpen(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    channel.addEventListener('open', () => resolve(), { once: true });
    channel.addEventListener('close', () => reject(new Error('No se pudo abrir la conexión')), {
      once: true,
    });
  });
}

function nextControl(channel: RTCDataChannel): Promise<Control> {
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      cleanup();
      resolve(JSON.parse(e.data));
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Se perdió la conexión con el otro dispositivo'));
    };
    const cleanup = () => {
      channel.removeEventListener('message', onMessage);
      channel.removeEventListener('close', onClose);
    };
    channel.addEventListener('message', onMessage);
    channel.addEventListener('close', onClose);
  });
}

/** Espera a que el buffer del canal baje para no saturar la memoria. */
function drain(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount < BUFFER_HIGH) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLow = () => {
      channel.removeEventListener('close', onClose);
      resolve();
    };
    const onClose = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      reject(new Error('Se perdió la conexión con el otro dispositivo'));
    };
    channel.addEventListener('bufferedamountlow', onLow, { once: true });
    channel.addEventListener('close', onClose, { once: true });
  });
}

export function toMeta(file: File): FileMeta {
  return { name: file.name, size: file.size, type: file.type };
}

/**
 * Envía los archivos por el canal. Resuelve cuando el receptor confirma que
 * recibió todo y lanza TransferRejectedError si el receptor no acepta.
 */
export async function sendFiles(
  channel: RTCDataChannel,
  files: File[],
  senderName: string,
  onAccepted: () => void,
  onProgress: (sentBytes: number) => void,
): Promise<void> {
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = BUFFER_LOW;
  await waitOpen(channel);

  sendControl(channel, { t: 'offer', senderName, files: files.map(toMeta) });
  const answer = await nextControl(channel);
  if (answer.t !== 'accept') {
    channel.close();
    throw new TransferRejectedError();
  }
  onAccepted();

  const done = nextControl(channel);
  let sent = 0;
  for (const [index, file] of files.entries()) {
    sendControl(channel, { t: 'file', index });
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      await drain(channel);
      channel.send(chunk);
      sent += chunk.byteLength;
      onProgress(sent);
    }
    sendControl(channel, { t: 'file-end', index });
  }
  sendControl(channel, { t: 'end' });

  await done;
  channel.close();
}

export interface ReceiveHandlers {
  /** Debe resolver true si el usuario acepta la transferencia. */
  onOffer: (offer: TransferOffer) => Promise<boolean>;
  onProgress: (receivedBytes: number) => void;
  onFile: (file: ReceivedFile) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

/** Atiende un canal entrante abierto por otro dispositivo. */
export function receiveFiles(channel: RTCDataChannel, handlers: ReceiveHandlers) {
  channel.binaryType = 'arraybuffer';

  let files: FileMeta[] = [];
  let current: { index: number; parts: ArrayBuffer[] } | null = null;
  let received = 0;
  let finished = false;

  channel.addEventListener('message', async (e: MessageEvent) => {
    if (typeof e.data !== 'string') {
      if (!current) return;
      current.parts.push(e.data as ArrayBuffer);
      received += (e.data as ArrayBuffer).byteLength;
      handlers.onProgress(received);
      return;
    }

    const msg = JSON.parse(e.data) as Control;
    switch (msg.t) {
      case 'offer': {
        files = msg.files;
        const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
        const accepted = await handlers.onOffer({ senderName: msg.senderName, files, totalBytes });
        // Si se rechaza, el emisor cierra el canal y eso no es un error
        if (!accepted) finished = true;
        if (channel.readyState !== 'open') return;
        sendControl(channel, { t: accepted ? 'accept' : 'reject' });
        break;
      }
      case 'file':
        current = { index: msg.index, parts: [] };
        break;
      case 'file-end': {
        if (!current || current.index !== msg.index) break;
        const meta = files[msg.index];
        const blob = new Blob(current.parts, { type: meta.type || 'application/octet-stream' });
        current = null;
        handlers.onFile({ ...meta, blob });
        break;
      }
      case 'end':
        finished = true;
        sendControl(channel, { t: 'done' });
        handlers.onDone();
        break;
    }
  });

  channel.addEventListener('close', () => {
    if (!finished && files.length > 0) {
      handlers.onError(new Error('Se perdió la conexión con el otro dispositivo'));
    }
  });
}
