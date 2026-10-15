import { useState } from 'react';
import { isFinished, type ReceivedItem, type Transfer } from '../useTransfers';
import { formatBytes, formatDuration, formatSpeed, pluralize } from '../lib/format';
import { fileIcon, isPreviewableImage } from '../lib/fileIcon';
import { downloadBlob, zipBlobs, ZIP_MAX_BYTES } from '../lib/zip';
import { topFolder } from '../lib/files';

const STATUS: Record<Transfer['status'], { label: string; badge: string }> = {
  waiting: { label: 'Esperando respuesta', badge: 'text-bg-secondary' },
  incoming: { label: 'Pendiente', badge: 'text-bg-warning' },
  active: { label: 'En curso', badge: 'text-bg-primary' },
  done: { label: 'Completado', badge: 'text-bg-success' },
  rejected: { label: 'Rechazado', badge: 'text-bg-danger' },
  cancelled: { label: 'Cancelado', badge: 'text-bg-secondary' },
  error: { label: 'Error', badge: 'text-bg-danger' },
};

interface Props {
  transfers: Transfer[];
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearFinished: () => void;
}

export function TransferList({ transfers, onCancel, onDismiss, onClearFinished }: Props) {
  const visible = transfers.filter((t) => t.status !== 'incoming');
  const finishedCount = visible.filter(isFinished).length;

  return (
    <div className="card shadow-sm">
      <div className="card-header bg-body d-flex align-items-center justify-content-between py-3">
        <h2 className="h6 mb-0 d-flex align-items-center gap-2">
          <i className="bi bi-clock-history text-primary" />
          Transferencias
        </h2>
        {finishedCount > 1 && (
          <button className="btn btn-link btn-sm p-0 text-decoration-none" onClick={onClearFinished}>
            Limpiar terminadas
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <div className="card-body text-center text-body-secondary py-4 small">
          <i className="bi bi-inbox fs-3 d-block mb-1" />
          Aquí verás lo que envíes y recibas.
        </div>
      ) : (
        <ul className="list-group list-group-flush">
          {visible.map((t) =>
            t.kind === 'text' ? (
              <TextItem key={t.id} transfer={t} onDismiss={onDismiss} />
            ) : (
              <FilesItem key={t.id} transfer={t} onCancel={onCancel} onDismiss={onDismiss} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function Avatar({ outgoing, icon }: { outgoing: boolean; icon?: string }) {
  return (
    <span className={`peer-avatar ${outgoing ? 'out' : 'in'}`}>
      <i className={`bi ${icon ?? (outgoing ? 'bi-arrow-up-right' : 'bi-arrow-down-left')}`} />
    </span>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Sin HTTPS no hay API de portapapeles: usar el método clásico
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function linkify(text: string) {
  const match = text.trim().match(/^https?:\/\/\S+$/i);
  return match ? match[0] : null;
}

function TextItem({ transfer: t, onDismiss }: { transfer: Transfer; onDismiss: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const outgoing = t.direction === 'out';
  const link = linkify(t.text ?? '');
  const status = STATUS[t.status];

  return (
    <li className={`list-group-item py-3 transfer text is-${t.status}`} data-testid="transfer">
      <div className="d-flex align-items-center gap-3">
        <Avatar outgoing={outgoing} icon="bi-chat-left-text" />
        <div className="flex-grow-1 min-w-0">
          <div className="d-flex align-items-center gap-2">
            <span className="fw-medium text-truncate">{outgoing ? `Mensaje para ${t.peerName}` : `Mensaje de ${t.peerName}`}</span>
            {t.status !== 'done' && <span className={`badge ${status.badge} ms-auto`}>{status.label}</span>}
          </div>
        </div>
      </div>
      <div className="text-message mt-2">{t.text}</div>
      <div className="d-flex justify-content-end gap-2 mt-2">
        {!outgoing && link && (
          <a className="btn btn-sm btn-outline-primary" href={link} target="_blank" rel="noreferrer noopener">
            <i className="bi bi-box-arrow-up-right me-1" />
            Abrir link
          </a>
        )}
        {!outgoing && (
          <button
            className="btn btn-sm btn-primary"
            onClick={async () => {
              await copyText(t.text ?? '');
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <i className={`bi ${copied ? 'bi-check-lg' : 'bi-clipboard'} me-1`} />
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        )}
        <button className="btn btn-sm btn-outline-secondary" onClick={() => onDismiss(t.id)}>
          Quitar
        </button>
      </div>
    </li>
  );
}

function FilesItem({
  transfer: t,
  onCancel,
  onDismiss,
}: {
  transfer: Transfer;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [zipping, setZipping] = useState<number | null>(null);
  const percent = t.totalBytes === 0 ? 100 : Math.min(100, Math.round((t.bytes / t.totalBytes) * 100));
  const finished = isFinished(t);
  const status = STATUS[t.status];
  const outgoing = t.direction === 'out';
  const remaining = t.speed > 0 ? (t.totalBytes - t.bytes) / t.speed : Infinity;

  const inMemory = t.received.filter((r): r is ReceivedItem & { blob: Blob; url: string } => Boolean(r.blob && r.url));
  const images = inMemory.filter((r) => isPreviewableImage(r.type, r.size));
  const hasFolders = t.files.some((f) => topFolder(f.path));
  const canZip = t.status === 'done' && inMemory.length > 1 && t.totalBytes <= ZIP_MAX_BYTES;

  async function saveZip() {
    setZipping(0);
    try {
      const blob = await zipBlobs(
        inMemory.map((r) => ({ path: r.path, blob: r.blob })),
        (done) => setZipping(Math.round((done / t.totalBytes) * 100)),
      );
      const folder = hasFolders ? topFolder(inMemory[0].path) : null;
      downloadBlob(blob, `${folder ?? `archivos-de-${t.peerName}`}.zip`);
    } finally {
      setZipping(null);
    }
  }

  function saveEach() {
    for (const r of inMemory) downloadBlob(r.blob, r.name);
  }

  return (
    <li className={`list-group-item py-3 transfer is-${t.status}`} data-testid="transfer">
      <div className="d-flex align-items-center gap-3">
        <Avatar outgoing={outgoing} />
        <div className="flex-grow-1 min-w-0">
          <div className="d-flex align-items-center gap-2">
            <span className="fw-medium text-truncate">{outgoing ? `Para ${t.peerName}` : `De ${t.peerName}`}</span>
            <span className={`badge ${status.badge} ms-auto`}>{status.label}</span>
          </div>
          <div className="small text-body-secondary">
            {pluralize(t.files.length, 'archivo')} · {formatBytes(t.totalBytes)}
          </div>
        </div>
      </div>

      {(t.status === 'active' || t.status === 'done') && (
        <>
          <div className="progress mt-2" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} style={{ height: 6 }}>
            <div
              className={`progress-bar ${t.status === 'done' ? 'bg-success' : 'progress-bar-striped progress-bar-animated'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          {t.status === 'active' && (
            <div className="d-flex justify-content-between small text-body-secondary mt-1 transfer-stats">
              <span>
                {percent}% · {formatBytes(t.bytes)} de {formatBytes(t.totalBytes)}
              </span>
              <span>
                {t.speed > 0 ? `${formatSpeed(t.speed)} · quedan ${formatDuration(remaining)}` : 'Conectando…'}
              </span>
            </div>
          )}
        </>
      )}

      {t.message && t.status !== 'done' && <div className="small text-body-secondary mt-2">{t.message}</div>}

      {t.savedToFolder !== undefined && t.status === 'done' && (
        <div className="small text-success mt-2">
          <i className="bi bi-folder-check me-1" />
          {t.savedToFolder ? `Guardado en la carpeta «${t.savedToFolder}»` : 'Guardado en la carpeta que elegiste'}
        </div>
      )}

      {images.length > 0 && (
        <div className="previews mt-3">
          {images.slice(0, 12).map((r) => (
            <a key={r.url} href={r.url} download={r.name} title={`Guardar ${r.name}`}>
              <img src={r.url} alt={r.name} loading="lazy" />
            </a>
          ))}
        </div>
      )}

      {inMemory.length > 0 && inMemory.length <= 20 && (
        <ul className="list-unstyled mt-3 mb-0 d-grid gap-2">
          {inMemory.map((r) => (
            <li key={r.url} className="d-flex align-items-center gap-2">
              <i className={`bi ${fileIcon(r.name, r.type)} text-body-secondary`} />
              <span className="flex-grow-1 text-truncate min-w-0 small" title={r.path}>
                {r.path}
              </span>
              <span className="small text-body-secondary text-nowrap">{formatBytes(r.size)}</span>
              <a className="btn btn-sm btn-outline-primary" href={r.url} download={r.name}>
                <i className="bi bi-download" />
                <span className="d-none d-sm-inline ms-1">Guardar</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {inMemory.length > 20 && (
        <div className="small text-body-secondary mt-2">{pluralize(inMemory.length, 'archivo')} listos para guardar.</div>
      )}

      <div className="d-flex flex-wrap justify-content-end gap-2 mt-2">
        {(t.status === 'waiting' || t.status === 'active') && (
          <button className="btn btn-sm btn-outline-danger" onClick={() => onCancel(t.id)}>
            <i className="bi bi-x-circle me-1" />
            Cancelar
          </button>
        )}
        {canZip && (
          <button className="btn btn-sm btn-primary" onClick={saveZip} disabled={zipping !== null}>
            <i className="bi bi-file-earmark-zip me-1" />
            {zipping === null ? 'Guardar todo (.zip)' : `Preparando ZIP… ${zipping}%`}
          </button>
        )}
        {t.status === 'done' && inMemory.length > 1 && !hasFolders && (
          <button className="btn btn-sm btn-outline-primary" onClick={saveEach}>
            <i className="bi bi-download me-1" />
            Guardar cada uno
          </button>
        )}
        {finished && (
          <button className="btn btn-sm btn-outline-secondary" onClick={() => onDismiss(t.id)}>
            Quitar
          </button>
        )}
      </div>
    </li>
  );
}
