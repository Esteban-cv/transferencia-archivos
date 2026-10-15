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
 *   Texto:  text {text}    ──►     ◄── done
 *   Cualquiera de los dos puede mandar `cancel` y cerrar el canal.
 *
 * Los mensajes de control viajan como texto JSON y los datos como binario.
 */
import { memorySinkFactory, type FileSink, type SinkFactory } from './sinks';

export const CHUNK_SIZE = 64 * 1024;
const BUFFER_HIGH = 8 * 1024 * 1024;
const BUFFER_LOW = 1 * 1024 * 1024;

export interface FileMeta {
  name: string;
  /** Ruta relativa con carpetas, ej. "Fotos/playa.jpg". */
  path: string;
  size: number;
  type: string;
}

export interface TransferOffer {
  senderName: string;
  files: FileMeta[];
  totalBytes: number;
}

export interface ReceivedFile extends FileMeta {
  /** null si el archivo se escribió directo en disco. */
  blob: Blob | null;
}

/** Lo mínimo que usamos de RTCDataChannel (permite probar el protocolo sin WebRTC). */
export interface Channel extends EventTarget {
  readonly readyState: RTCDataChannelState;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  binaryType: BinaryType;
  send(data: string | ArrayBuffer): void;
  close(): void;
}

type Control =
  | { t: 'offer'; senderName: string; files: FileMeta[] }
  | { t: 'text'; senderName: string; text: string }
  | { t: 'accept' }
  | { t: 'reject' }
  | { t: 'file'; index: number }
  | { t: 'file-end'; index: number }
  | { t: 'end' }
  | { t: 'done' }
  | { t: 'cancel' };

export type TransferEndReason = 'rejected' | 'cancelled' | 'remote-cancelled' | 'connection';

/** Fin anticipado de una transferencia, con el motivo. */
export class TransferEnded extends Error {
  constructor(readonly reason: TransferEndReason) {
    super(
      {
        rejected: 'El receptor rechazó la transferencia',
        cancelled: 'Cancelaste la transferencia',
        'remote-cancelled': 'El otro dispositivo canceló la transferencia',
        connection: 'Se perdió la conexión con el otro dispositivo',
      }[reason],
    );
  }
}

function sendControl(channel: Channel, msg: Control) {
  if (channel.readyState === 'open') channel.send(JSON.stringify(msg));
}

function waitOpen(channel: Channel): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    channel.addEventListener('open', () => resolve(), { once: true });
    channel.addEventListener('close', () => reject(new TransferEnded('connection')), { once: true });
  });
}

/** Cola de mensajes de control entrantes. */
function controlInbox(channel: Channel) {
  const queue: Control[] = [];
  let waiter: ((msg: Control | null) => void) | null = null;
  let closed = false;
  let remoteCancelled = false;

  channel.addEventListener('message', (e) => {
    const data = (e as MessageEvent).data;
    if (typeof data !== 'string') return;
    const msg = JSON.parse(data) as Control;
    if (msg.t === 'cancel') remoteCancelled = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(msg);
    } else {
      queue.push(msg);
    }
  });
  channel.addEventListener('close', () => {
    closed = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(null);
    }
  });

  return {
    next(): Promise<Control | null> {
      if (queue.length) return Promise.resolve(queue.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => (waiter = resolve));
    },
    get remoteCancelled() {
      return remoteCancelled;
    },
  };
}

/** Espera a que el buffer del canal baje para no saturar la memoria. */
function drain(channel: Channel): Promise<void> {
  if (channel.bufferedAmount < BUFFER_HIGH) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      channel.removeEventListener('bufferedamountlow', finish);
      channel.removeEventListener('close', finish);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', finish);
    channel.addEventListener('close', finish);
  });
}

export interface OutgoingItem {
  file: Blob;
  name: string;
  path: string;
  type: string;
}

export interface SendCallbacks {
  onAccepted: () => void;
  onProgress: (sentBytes: number) => void;
}

/**
 * Envía los archivos por el canal. Resuelve cuando el receptor confirma que
 * recibió todo; si no, lanza TransferEnded con el motivo.
 */
export async function sendFiles(
  channel: Channel,
  items: OutgoingItem[],
  senderName: string,
  callbacks: SendCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = BUFFER_LOW;
  const inbox = controlInbox(channel);

  const abortIfNeeded = () => {
    if (signal?.aborted) {
      sendControl(channel, { t: 'cancel' });
      channel.close();
      throw new TransferEnded('cancelled');
    }
    if (inbox.remoteCancelled) {
      channel.close();
      throw new TransferEnded('remote-cancelled');
    }
    if (channel.readyState !== 'open') throw new TransferEnded('connection');
  };

  await waitOpen(channel);
  sendControl(channel, {
    t: 'offer',
    senderName,
    files: items.map((i) => ({ name: i.name, path: i.path, size: i.file.size, type: i.type })),
  });

  // Esperar la respuesta, atentos a una cancelación local mientras tanto
  const onAbort = () => {
    sendControl(channel, { t: 'cancel' });
    channel.close();
  };
  signal?.addEventListener('abort', onAbort);
  const answer = await inbox.next();
  signal?.removeEventListener('abort', onAbort);
  if (signal?.aborted) throw new TransferEnded('cancelled');
  if (!answer) throw new TransferEnded('connection');
  if (answer.t === 'reject') {
    channel.close();
    throw new TransferEnded('rejected');
  }
  if (answer.t !== 'accept') throw new TransferEnded('remote-cancelled');
  callbacks.onAccepted();

  let sent = 0;
  for (const [index, item] of items.entries()) {
    abortIfNeeded();
    sendControl(channel, { t: 'file', index });
    for (let offset = 0; offset < item.file.size; offset += CHUNK_SIZE) {
      const chunk = await item.file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      await drain(channel);
      abortIfNeeded();
      channel.send(chunk);
      sent += chunk.byteLength;
      callbacks.onProgress(sent);
    }
    sendControl(channel, { t: 'file-end', index });
  }
  sendControl(channel, { t: 'end' });

  const final = await inbox.next();
  if (final?.t === 'cancel') throw new TransferEnded('remote-cancelled');
  if (final?.t !== 'done') throw new TransferEnded('connection');
  channel.close();
}

/** Envía un texto corto (link, nota, contraseña del WiFi…). */
export async function sendText(channel: Channel, text: string, senderName: string): Promise<void> {
  const inbox = controlInbox(channel);
  await waitOpen(channel);
  sendControl(channel, { t: 'text', senderName, text });
  const reply = await inbox.next();
  if (reply?.t !== 'done') throw new TransferEnded('connection');
  channel.close();
}

export interface OfferDecision {
  accept: boolean;
  /** Dónde escribir los archivos; por defecto en memoria (Blobs). */
  sinkFactory?: SinkFactory;
}

export interface ReceiveHandlers {
  /** Se llama cuando llega una oferta; resolver con la decisión del usuario. */
  onOffer: (offer: TransferOffer) => Promise<OfferDecision>;
  onText: (text: string, senderName: string) => void;
  onProgress: (receivedBytes: number) => void;
  onFile: (file: ReceivedFile) => void;
  onDone: () => void;
  onEnded: (reason: TransferEndReason) => void;
}

export interface IncomingController {
  cancel: () => void;
}

/** Atiende un canal abierto por otro dispositivo. */
export function receiveTransfer(channel: Channel, handlers: ReceiveHandlers): IncomingController {
  channel.binaryType = 'arraybuffer';

  let files: FileMeta[] = [];
  let factory: SinkFactory = memorySinkFactory;
  let sink: FileSink | null = null;
  let received = 0;
  let finished = false;
  let failed = false;
  let awaitingDecision = false;
  // Los mensajes se procesan en orden, esperando cada escritura en disco
  let chain = Promise.resolve();

  const end = async (reason: TransferEndReason) => {
    if (finished) return;
    finished = true;
    await sink?.abort().catch(() => {});
    sink = null;
    handlers.onEnded(reason);
  };

  const handle = async (data: unknown) => {
    if (finished) return;

    if (typeof data !== 'string') {
      if (!sink) return;
      const chunk = data as ArrayBuffer;
      await sink.write(chunk);
      received += chunk.byteLength;
      handlers.onProgress(received);
      return;
    }

    const msg = JSON.parse(data) as Control;
    switch (msg.t) {
      case 'text':
        finished = true;
        handlers.onText(msg.text, msg.senderName);
        sendControl(channel, { t: 'done' });
        break;
      case 'offer': {
        files = msg.files.map((f) => ({ ...f, path: f.path || f.name }));
        const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
        awaitingDecision = true;
        const decision = await handlers.onOffer({ senderName: msg.senderName, files, totalBytes });
        awaitingDecision = false;
        if (finished) return; // el emisor canceló mientras decidíamos
        if (!decision.accept) {
          finished = true; // el emisor cerrará el canal: no es un error
          sendControl(channel, { t: 'reject' });
          return;
        }
        factory = decision.sinkFactory ?? memorySinkFactory;
        sendControl(channel, { t: 'accept' });
        break;
      }
      case 'file':
        sink = await factory(files[msg.index]);
        break;
      case 'file-end': {
        if (!sink) break;
        const blob = await sink.close();
        sink = null;
        handlers.onFile({ ...files[msg.index], blob });
        break;
      }
      case 'end':
        finished = true;
        sendControl(channel, { t: 'done' });
        handlers.onDone();
        break;
      case 'cancel':
        await end('remote-cancelled');
        break;
    }
  };

  channel.addEventListener('message', (e) => {
    const data = (e as MessageEvent).data;
    // Una cancelación no espera en la cola (puede estar esperando la decisión del usuario)
    if (typeof data === 'string' && awaitingDecision && JSON.parse(data).t === 'cancel') {
      void end('remote-cancelled');
      return;
    }
    chain = chain
      .then(() => handle(data))
      .catch(async (err) => {
        if (failed) return;
        failed = true;
        console.error('Error recibiendo archivos', err);
        sendControl(channel, { t: 'cancel' });
        channel.close();
        await end('connection');
      });
  });

  channel.addEventListener('close', () => {
    if (awaitingDecision) void end('connection');
    else chain = chain.then(() => end('connection'));
  });

  return {
    cancel() {
      if (finished) return;
      sendControl(channel, { t: 'cancel' });
      channel.close();
      void end('cancelled');
    },
  };
}
