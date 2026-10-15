import { useState } from 'react';
import type { Transfer } from '../useTransfers';
import { formatBytes, pluralize } from '../lib/format';
import { fileIcon } from '../lib/fileIcon';
import { topFolder } from '../lib/files';
import { supportsDirectorySave } from '../rtc/sinks';
import { detectDeviceKind } from '../signaling';

// Elegir carpeta solo existe en Chrome/Edge de escritorio
const canSaveToFolder = supportsDirectorySave && detectDeviceKind() === 'desktop';

interface Props {
  requests: Transfer[];
  onAnswer: (id: string, accept: boolean, toFolder: boolean) => void;
}

/** A partir de este tamaño conviene escribir directo en disco. */
const LARGE_BYTES = 500 * 1024 * 1024;

/** Solicitudes entrantes, flotando sobre la página para que no se pierdan. */
export function IncomingRequests({ requests, onAnswer }: Props) {
  if (requests.length === 0) return null;
  return (
    <div className="incoming-stack">
      {requests.map((t) => (
        <IncomingCard key={t.id} transfer={t} onAnswer={onAnswer} />
      ))}
    </div>
  );
}

function IncomingCard({ transfer: t, onAnswer }: { transfer: Transfer; onAnswer: Props['onAnswer'] }) {
  const hasFolders = t.files.some((f) => topFolder(f.path));
  const [toFolder, setToFolder] = useState(
    canSaveToFolder && (hasFolders || t.totalBytes >= LARGE_BYTES || t.files.length > 5),
  );
  const folders = [...new Set(t.files.map((f) => topFolder(f.path)).filter(Boolean))] as string[];
  const looseFiles = t.files.filter((f) => !topFolder(f.path));

  return (
    <div className="card shadow-lg border-primary incoming-card" role="alertdialog" aria-label="Solicitud de transferencia">
      <div className="card-body">
        <div className="d-flex align-items-center gap-3 mb-2">
          <span className="peer-avatar bg-primary text-white">
            <i className="bi bi-download" />
          </span>
          <div className="min-w-0">
            <div className="fw-semibold text-truncate">{t.peerName} quiere enviarte</div>
            <div className="small text-body-secondary">
              {pluralize(t.files.length, 'archivo')} · {formatBytes(t.totalBytes)}
            </div>
          </div>
        </div>

        <ul className="list-unstyled small mb-3 incoming-files">
          {folders.slice(0, 3).map((folder) => (
            <li key={folder} className="d-flex gap-2 text-truncate">
              <i className="bi bi-folder-fill text-warning" />
              <span className="text-truncate">{folder}</span>
            </li>
          ))}
          {looseFiles.slice(0, Math.max(0, 4 - Math.min(folders.length, 3))).map((f, i) => (
            <li key={i} className="d-flex gap-2 text-truncate">
              <i className={`bi ${fileIcon(f.name, f.type)}`} />
              <span className="text-truncate">{f.name}</span>
            </li>
          ))}
          {folders.length + looseFiles.length > 4 && (
            <li className="text-body-secondary">y más…</li>
          )}
        </ul>

        {canSaveToFolder && (
          <div className="form-check form-switch small mb-3">
            <input
              className="form-check-input"
              type="checkbox"
              role="switch"
              id={`folder-${t.id}`}
              checked={toFolder}
              onChange={(e) => setToFolder(e.target.checked)}
            />
            <label className="form-check-label" htmlFor={`folder-${t.id}`}>
              Guardar directo en una carpeta de mi PC
              <span className="d-block text-body-secondary">Recomendado para carpetas y archivos grandes</span>
            </label>
          </div>
        )}

        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary flex-fill" onClick={() => onAnswer(t.id, false, false)}>
            Rechazar
          </button>
          <button className="btn btn-primary flex-fill" onClick={() => onAnswer(t.id, true, toFolder)}>
            {toFolder ? 'Elegir carpeta y aceptar' : 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
}
