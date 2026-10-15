import { useCallback, useEffect, useRef, useState } from 'react';
import type { PeerInfo } from '@transfer/shared';
import { PeerManager } from './rtc/peers';
import {
  receiveTransfer,
  sendFiles,
  sendText,
  TransferEnded,
  type FileMeta,
  type TransferEndReason,
} from './rtc/transfer';
import { directorySinkFactory, type SinkFactory } from './rtc/sinks';
import { connectSignaling } from './signaling';
import { pluralize, randomId, throttle } from './lib/format';
import { announce } from './lib/notify';
import type { OutgoingFile } from './lib/files';

export type TransferStatus =
  | 'waiting' // emisor esperando que el receptor acepte
  | 'incoming' // receptor debe decidir si acepta
  | 'active'
  | 'done'
  | 'rejected'
  | 'cancelled'
  | 'error';

export interface ReceivedItem extends FileMeta {
  /** Blob en memoria; null si se guardó directo en una carpeta. */
  blob: Blob | null;
  url: string | null;
}

export interface Transfer {
  id: string;
  kind: 'files' | 'text';
  direction: 'out' | 'in';
  peerName: string;
  files: FileMeta[];
  totalBytes: number;
  bytes: number;
  /** Bytes por segundo, suavizado. */
  speed: number;
  status: TransferStatus;
  message?: string;
  received: ReceivedItem[];
  savedToFolder?: string;
  text?: string;
  createdAt: number;
}

const FINAL_STATUS: Record<TransferEndReason, TransferStatus> = {
  rejected: 'rejected',
  cancelled: 'cancelled',
  'remote-cancelled': 'cancelled',
  connection: 'error',
};

export function isFinished(t: Transfer) {
  return ['done', 'rejected', 'cancelled', 'error'].includes(t.status);
}

/** Mide la velocidad con un promedio móvil para que no salte tanto. */
function speedMeter() {
  let lastBytes = 0;
  let lastTime = performance.now();
  let speed = 0;
  return (bytes: number) => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    if (dt > 0) {
      const instant = (bytes - lastBytes) / dt;
      speed = speed === 0 ? instant : speed * 0.7 + instant * 0.3;
    }
    lastBytes = bytes;
    lastTime = now;
    return speed;
  };
}

export function useTransfers(name: string, room: string, onRoomRequired?: () => void) {
  const [connected, setConnected] = useState(false);
  const [self, setSelf] = useState<PeerInfo | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  const manager = useRef<PeerManager | null>(null);
  const peersRef = useRef<PeerInfo[]>([]);
  const pendingOffers = useRef(new Map<string, (decision: { accept: boolean; sinkFactory?: SinkFactory }) => void>());
  const cancellers = useRef(new Map<string, () => void>());

  peersRef.current = peers;

  const update = useCallback((id: string, patch: Partial<Transfer> | ((t: Transfer) => Partial<Transfer>)) => {
    setTransfers((list) =>
      list.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)),
    );
  }, []);

  const addTransfer = useCallback((t: Transfer) => setTransfers((list) => [t, ...list]), []);

  const progressUpdater = useCallback(
    (id: string) => {
      const meter = speedMeter();
      return throttle((bytes: number) => update(id, { bytes, speed: meter(bytes) }), 250);
    },
    [update],
  );

  /** Canal abierto por otro dispositivo: es una transferencia entrante. */
  const handleIncomingChannel = useCallback(
    (peerId: string, channel: RTCDataChannel) => {
      const id = randomId();
      const fallbackName = peersRef.current.find((p) => p.id === peerId)?.name ?? 'Dispositivo';
      let totalBytes = 0;

      const controller = receiveTransfer(channel, {
        onOffer: (offer) =>
          new Promise((resolve) => {
            totalBytes = offer.totalBytes;
            pendingOffers.current.set(id, resolve);
            addTransfer({
              id,
              kind: 'files',
              direction: 'in',
              peerName: offer.senderName || fallbackName,
              files: offer.files,
              totalBytes: offer.totalBytes,
              bytes: 0,
              speed: 0,
              status: 'incoming',
              received: [],
              createdAt: Date.now(),
            });
            announce(
              `${offer.senderName || fallbackName} quiere enviarte archivos`,
              pluralize(offer.files.length, 'archivo'),
            );
          }),
        onText: (text, senderName) => {
          addTransfer({
            id,
            kind: 'text',
            direction: 'in',
            peerName: senderName || fallbackName,
            files: [],
            totalBytes: 0,
            bytes: 0,
            speed: 0,
            status: 'done',
            received: [],
            text,
            createdAt: Date.now(),
          });
          announce(`Mensaje de ${senderName || fallbackName}`, text.slice(0, 120));
        },
        onProgress: progressUpdater(id),
        onFile: (file) => {
          const item: ReceivedItem = { ...file, url: file.blob ? URL.createObjectURL(file.blob) : null };
          update(id, (t) => ({ received: [...t.received, item] }));
        },
        onDone: () => {
          cancellers.current.delete(id);
          update(id, { status: 'done', bytes: totalBytes, speed: 0 });
        },
        onEnded: (reason) => {
          cancellers.current.delete(id);
          pendingOffers.current.delete(id);
          update(id, (t) =>
            t.status === 'rejected'
              ? {}
              : { status: FINAL_STATUS[reason], message: new TransferEnded(reason).message, speed: 0 },
          );
        },
      });
      cancellers.current.set(id, controller.cancel);
    },
    [addTransfer, update, progressUpdater],
  );

  useEffect(() => {
    const conn = connectSignaling(
      name,
      room,
      (msg) => {
        switch (msg.type) {
          case 'welcome':
            manager.current?.closeAll();
            manager.current = new PeerManager(
              msg.self.id,
              (to, payload) => conn.send({ type: 'signal', to, payload }),
              handleIncomingChannel,
            );
            setSelf(msg.self);
            setPeers(msg.peers);
            break;
          case 'peer-joined':
            setPeers((p) => [...p.filter((x) => x.id !== msg.peer.id), msg.peer]);
            break;
          case 'peer-left':
            manager.current?.remove(msg.id);
            setPeers((p) => p.filter((x) => x.id !== msg.id));
            break;
          case 'signal':
            manager.current?.handleSignal(msg.from, msg.payload);
            break;
          case 'error':
            console.warn('Servidor de señalización:', msg.message);
            break;
          case 'room-required':
            onRoomRequired?.();
            break;
        }
      },
      setConnected,
    );
    return () => {
      conn.close();
      manager.current?.closeAll();
      manager.current = null;
      setPeers([]);
    };
  }, [name, room, handleIncomingChannel, onRoomRequired]);

  /** Envía los mismos archivos a cada dispositivo elegido, en paralelo. */
  const sendFilesTo = useCallback(
    (peerIds: string[], files: OutgoingFile[]) => {
      const mgr = manager.current;
      if (!mgr || files.length === 0) return;
      const items = files.map((f) => ({
        file: f.file,
        name: f.file.name,
        path: f.path,
        type: f.file.type,
      }));
      const metas: FileMeta[] = items.map((i) => ({ name: i.name, path: i.path, size: i.file.size, type: i.type }));
      const totalBytes = metas.reduce((sum, f) => sum + f.size, 0);

      for (const peerId of peerIds) {
        const peer = peersRef.current.find((p) => p.id === peerId);
        if (!peer) continue;
        const id = randomId();
        const abort = new AbortController();
        cancellers.current.set(id, () => abort.abort());
        addTransfer({
          id,
          kind: 'files',
          direction: 'out',
          peerName: peer.name,
          files: metas,
          totalBytes,
          bytes: 0,
          speed: 0,
          status: 'waiting',
          received: [],
          createdAt: Date.now(),
        });

        const channel = mgr.openChannel(peerId, `files-${id}`);
        sendFiles(
          channel,
          items,
          name,
          { onAccepted: () => update(id, { status: 'active' }), onProgress: progressUpdater(id) },
          abort.signal,
        )
          .then(() => update(id, { status: 'done', bytes: totalBytes, speed: 0 }))
          .catch((err: Error) => {
            const reason: TransferEndReason = err instanceof TransferEnded ? err.reason : 'connection';
            update(id, { status: FINAL_STATUS[reason], message: new TransferEnded(reason).message, speed: 0 });
          })
          .finally(() => cancellers.current.delete(id));
      }
    },
    [name, addTransfer, update, progressUpdater],
  );

  const sendTextTo = useCallback(
    (peerIds: string[], text: string) => {
      const mgr = manager.current;
      if (!mgr || !text.trim()) return;
      for (const peerId of peerIds) {
        const peer = peersRef.current.find((p) => p.id === peerId);
        if (!peer) continue;
        const id = randomId();
        addTransfer({
          id,
          kind: 'text',
          direction: 'out',
          peerName: peer.name,
          files: [],
          totalBytes: 0,
          bytes: 0,
          speed: 0,
          status: 'waiting',
          received: [],
          text,
          createdAt: Date.now(),
        });
        sendText(mgr.openChannel(peerId, `text-${id}`), text, name)
          .then(() => update(id, { status: 'done' }))
          .catch(() => update(id, { status: 'error', message: new TransferEnded('connection').message }));
      }
    },
    [name, addTransfer, update],
  );

  /**
   * Responde una solicitud entrante. Con `folder` el usuario elige una
   * carpeta y los archivos se escriben directo ahí (sin límite de tamaño).
   */
  const answer = useCallback(
    async (id: string, accept: boolean, toFolder = false) => {
      const resolve = pendingOffers.current.get(id);
      if (!resolve) return;

      if (!accept) {
        pendingOffers.current.delete(id);
        update(id, { status: 'rejected', message: 'Rechazaste la transferencia' });
        resolve({ accept: false });
        return;
      }

      let sinkFactory: SinkFactory | undefined;
      let savedToFolder: string | undefined;
      if (toFolder && window.showDirectoryPicker) {
        try {
          const dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'transferencias' });
          sinkFactory = directorySinkFactory(dir);
          savedToFolder = dir.name;
        } catch {
          return; // cerró el selector sin elegir: la solicitud sigue pendiente
        }
      }
      pendingOffers.current.delete(id);
      update(id, { status: 'active', savedToFolder });
      resolve({ accept: true, sinkFactory });
    },
    [update],
  );

  const cancel = useCallback((id: string) => cancellers.current.get(id)?.(), []);

  const dismiss = useCallback((id: string) => {
    setTransfers((list) => {
      list.find((t) => t.id === id)?.received.forEach((r) => r.url && URL.revokeObjectURL(r.url));
      return list.filter((t) => t.id !== id);
    });
  }, []);

  const clearFinished = useCallback(() => {
    setTransfers((list) => {
      for (const t of list) if (isFinished(t)) t.received.forEach((r) => r.url && URL.revokeObjectURL(r.url));
      return list.filter((t) => !isFinished(t));
    });
  }, []);

  return {
    connected,
    self,
    peers,
    transfers,
    sendFilesTo,
    sendTextTo,
    answer,
    cancel,
    dismiss,
    clearFinished,
  };
}
