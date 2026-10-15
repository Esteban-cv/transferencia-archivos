import { useRef, useState, type DragEvent } from 'react';
import type { PeerInfo } from '@transfer/shared';
import { defaultDeviceName, signalingUrl } from './signaling';
import { useTransfers, type Transfer } from './useTransfers';
import { formatBytes } from './format';

const ICONS: Record<PeerInfo['kind'], string> = {
  desktop: '💻',
  mobile: '📱',
  tablet: '📲',
};

export function App() {
  const [name] = useState(defaultDeviceName);
  const { connected, self, peers, transfers, sendTo, answer, dismiss } = useTransfers(name);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const targets = peers.filter((p) => selected.has(p.id));
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  function togglePeer(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    // Copiar ya: el FileList del input se vacía cuando se resetea su value
    const added = Array.from(list);
    setFiles((prev) => [...prev, ...added]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  function send() {
    sendTo(
      targets.map((p) => p.id),
      files,
    );
    setFiles([]);
  }

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
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => togglePeer(p.id)}
                  />
                  <span className="icon">{ICONS[p.kind]}</span>
                  {p.name}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Enviar</h2>
        <div
          className={dragging ? 'dropzone over' : 'dropzone'}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {files.length === 0
            ? 'Toca para elegir archivos o arrástralos aquí'
            : `${files.length} archivo(s) · ${formatBytes(totalSize)}`}
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {files.length > 0 && (
          <ul className="file-list">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span>{f.name}</span>
                <span className="muted">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          {files.length > 0 && (
            <button className="secondary" onClick={() => setFiles([])}>
              Limpiar
            </button>
          )}
          <button disabled={files.length === 0 || targets.length === 0} onClick={send}>
            {targets.length === 0
              ? 'Elige al menos un dispositivo'
              : `Enviar a ${targets.length} dispositivo(s)`}
          </button>
        </div>
      </section>

      {transfers.length > 0 && (
        <section>
          <h2>Transferencias</h2>
          <ul className="transfers">
            {transfers.map((t) => (
              <TransferItem key={t.id} transfer={t} onAnswer={answer} onDismiss={dismiss} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

const STATUS_LABEL: Record<Transfer['status'], string> = {
  waiting: 'Esperando que acepte…',
  incoming: 'Quiere enviarte archivos',
  active: 'Transfiriendo…',
  done: 'Completado',
  rejected: 'Rechazado',
  error: 'Error',
};

function TransferItem({
  transfer: t,
  onAnswer,
  onDismiss,
}: {
  transfer: Transfer;
  onAnswer: (id: string, accept: boolean) => void;
  onDismiss: (id: string) => void;
}) {
  const percent = t.totalBytes === 0 ? 100 : Math.round((t.bytes / t.totalBytes) * 100);
  const finished = t.status === 'done' || t.status === 'rejected' || t.status === 'error';

  return (
    <li className={`transfer ${t.status}`} data-testid="transfer">
      <div className="transfer-head">
        <strong>
          {t.direction === 'out' ? `Para ${t.peerName}` : `De ${t.peerName}`}
        </strong>
        <span className="muted">
          {t.files.length} archivo(s) · {formatBytes(t.totalBytes)}
        </span>
      </div>
      <div className="transfer-status">
        {STATUS_LABEL[t.status]}
        {t.error ? `: ${t.error}` : ''}
      </div>

      {t.status === 'incoming' && (
        <div className="actions">
          <button className="secondary" onClick={() => onAnswer(t.id, false)}>
            Rechazar
          </button>
          <button onClick={() => onAnswer(t.id, true)}>Aceptar</button>
        </div>
      )}

      {(t.status === 'active' || t.status === 'done') && (
        <div className="progress" aria-label={`${percent}%`}>
          <div style={{ width: `${percent}%` }} />
        </div>
      )}

      {t.received.length > 0 && (
        <ul className="received">
          {t.received.map((r) => (
            <li key={r.url}>
              <a href={r.url} download={r.name}>
                Guardar {r.name}
              </a>
              <span className="muted">{formatBytes(r.size)}</span>
            </li>
          ))}
        </ul>
      )}

      {finished && (
        <button className="link" onClick={() => onDismiss(t.id)}>
          Quitar de la lista
        </button>
      )}
    </li>
  );
}
