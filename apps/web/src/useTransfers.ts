import { useCallback, useEffect, useRef, useState } from 'react';
import type { PeerInfo } from '@transfer/shared';
import { PeerManager } from './rtc/peers';
import {
  receiveFiles,
  sendFiles,
  toMeta,
  TransferRejectedError,
  type FileMeta,
} from './rtc/transfer';
import { connectSignaling, type SignalingConnection } from './signaling';
import { randomId, throttle } from './format';

export type TransferStatus =
  | 'waiting' // emisor esperando que el receptor acepte
  | 'incoming' // receptor debe decidir si acepta
  | 'active'
  | 'done'
  | 'rejected'
  | 'error';

export interface ReceivedLink {
  name: string;
  size: number;
  url: string;
}

export interface Transfer {
  id: string;
  direction: 'out' | 'in';
  peerName: string;
  files: FileMeta[];
  totalBytes: number;
  bytes: number;
  status: TransferStatus;
  error?: string;
  received: ReceivedLink[];
}

export function useTransfers(name: string) {
  const [connected, setConnected] = useState(false);
  const [self, setSelf] = useState<PeerInfo | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  const signaling = useRef<SignalingConnection | null>(null);
  const manager = useRef<PeerManager | null>(null);
  const peersRef = useRef<PeerInfo[]>([]);
  const pendingAnswers = useRef(new Map<string, (accept: boolean) => void>());

  peersRef.current = peers;

  const update = useCallback((id: string, patch: Partial<Transfer>) => {
    setTransfers((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const addTransfer = useCallback((t: Transfer) => {
    setTransfers((list) => [t, ...list]);
  }, []);

  /** Canal abierto por otro dispositivo: es una transferencia entrante. */
  const handleIncomingChannel = useCallback(
    (peerId: string, channel: RTCDataChannel) => {
      const id = randomId();
      const peerName = peersRef.current.find((p) => p.id === peerId)?.name ?? 'Dispositivo';
      let totalBytes = 0;

      receiveFiles(channel, {
        onOffer: (offer) =>
          new Promise<boolean>((resolve) => {
            pendingAnswers.current.set(id, resolve);
            totalBytes = offer.totalBytes;
            addTransfer({
              id,
              direction: 'in',
              peerName: offer.senderName || peerName,
              files: offer.files,
              totalBytes: offer.totalBytes,
              bytes: 0,
              status: 'incoming',
              received: [],
            });
          }),
        onProgress: throttle((bytes: number) => update(id, { bytes })),
        onFile: (file) => {
          const link = { name: file.name, size: file.size, url: URL.createObjectURL(file.blob) };
          setTransfers((list) =>
            list.map((t) => (t.id === id ? { ...t, received: [...t.received, link] } : t)),
          );
        },
        onDone: () => update(id, { status: 'done', bytes: totalBytes }),
        onError: (err) => update(id, { status: 'error', error: err.message }),
      });
    },
    [addTransfer, update],
  );

  useEffect(() => {
    const conn = connectSignaling(
      name,
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
        }
      },
      setConnected,
    );
    signaling.current = conn;
    return () => {
      conn.close();
      manager.current?.closeAll();
      manager.current = null;
    };
  }, [name, handleIncomingChannel]);

  /** Envía los mismos archivos a cada dispositivo elegido, en paralelo. */
  const sendTo = useCallback(
    (peerIds: string[], files: File[]) => {
      const mgr = manager.current;
      if (!mgr || files.length === 0) return;
      const metas = files.map(toMeta);
      const totalBytes = metas.reduce((sum, f) => sum + f.size, 0);

      for (const peerId of peerIds) {
        const peer = peersRef.current.find((p) => p.id === peerId);
        if (!peer) continue;
        const id = randomId();
        addTransfer({
          id,
          direction: 'out',
          peerName: peer.name,
          files: metas,
          totalBytes,
          bytes: 0,
          status: 'waiting',
          received: [],
        });

        const channel = mgr.openChannel(peerId, `transfer-${id}`);
        sendFiles(
          channel,
          files,
          name,
          () => update(id, { status: 'active' }),
          throttle((bytes: number) => update(id, { bytes })),
        )
          .then(() => update(id, { status: 'done', bytes: totalBytes }))
          .catch((err: Error) =>
            update(
              id,
              err instanceof TransferRejectedError
                ? { status: 'rejected' }
                : { status: 'error', error: err.message },
            ),
          );
      }
    },
    [name, addTransfer, update],
  );

  const answer = useCallback(
    (id: string, accept: boolean) => {
      pendingAnswers.current.get(id)?.(accept);
      pendingAnswers.current.delete(id);
      update(id, { status: accept ? 'active' : 'rejected' });
    },
    [update],
  );

  const dismiss = useCallback((id: string) => {
    setTransfers((list) => {
      list.find((t) => t.id === id)?.received.forEach((r) => URL.revokeObjectURL(r.url));
      return list.filter((t) => t.id !== id);
    });
  }, []);

  return { connected, self, peers, transfers, sendTo, answer, dismiss };
}
