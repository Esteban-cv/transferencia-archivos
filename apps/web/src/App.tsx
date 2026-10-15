import { useEffect, useState } from 'react';
import type { PeerInfo } from '@transfer/shared';
import { connectSignaling, defaultDeviceName, signalingUrl } from './signaling';

const ICONS: Record<PeerInfo['kind'], string> = {
  desktop: '💻',
  mobile: '📱',
  tablet: '📲',
};

export function App() {
  const [name] = useState(defaultDeviceName);
  const [connected, setConnected] = useState(false);
  const [self, setSelf] = useState<PeerInfo | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);

  useEffect(() => {
    const conn = connectSignaling(
      name,
      (msg) => {
        switch (msg.type) {
          case 'welcome':
            setSelf(msg.self);
            setPeers(msg.peers);
            break;
          case 'peer-joined':
            setPeers((p) => [...p.filter((x) => x.id !== msg.peer.id), msg.peer]);
            break;
          case 'peer-left':
            setPeers((p) => p.filter((x) => x.id !== msg.id));
            break;
        }
      },
      setConnected,
    );
    return () => conn.close();
  }, [name]);

  return (
    <main className="app">
      <header>
        <h1>Transferencia de archivos</h1>
        <p className={connected ? 'status ok' : 'status off'}>
          {connected ? `Conectado como ${self?.name ?? name}` : `Sin conexión a ${signalingUrl()}`}
        </p>
      </header>

      <section>
        <h2>Dispositivos en la red</h2>
        {peers.length === 0 ? (
          <p className="empty">Abre esta misma página en otro dispositivo conectado al mismo WiFi.</p>
        ) : (
          <ul className="peers">
            {peers.map((p) => (
              <li key={p.id}>
                <span className="icon">{ICONS[p.kind]}</span>
                {p.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
