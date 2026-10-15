import { useMemo, useRef, useState, type DragEvent } from 'react';
import { formatBytes, pluralize } from '../lib/format';
import { fileIcon } from '../lib/fileIcon';
import { fromDataTransfer, fromFileList, supportsFolderPicker, topFolder, type OutgoingFile } from '../lib/files';

interface Props {
  files: OutgoingFile[];
  text: string;
  mode: 'files' | 'text';
  targetCount: number;
  isDesktop: boolean;
  onModeChange: (mode: 'files' | 'text') => void;
  onAdd: (files: OutgoingFile[]) => void;
  onRemove: (predicate: (f: OutgoingFile) => boolean) => void;
  onClear: () => void;
  onTextChange: (text: string) => void;
  onSend: () => void;
}

interface Group {
  key: string;
  folder: string | null;
  files: OutgoingFile[];
  size: number;
}

/** Agrupa por carpeta de primer nivel para no listar 500 fotos una por una. */
function groupFiles(files: OutgoingFile[]): Group[] {
  const groups = new Map<string, Group>();
  for (const f of files) {
    const folder = topFolder(f.path);
    const key = folder ? `dir:${folder}` : `file:${f.path}:${groups.size}`;
    const group = groups.get(key) ?? { key, folder, files: [], size: 0 };
    group.files.push(f);
    group.size += f.file.size;
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function SendPanel(props: Props) {
  const { files, text, mode, targetCount, isDesktop } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);
  const groups = useMemo(() => groupFiles(files), [files]);

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    props.onModeChange('files');
    props.onAdd(await fromDataTransfer(e.dataTransfer));
  }

  const canSend = targetCount > 0 && (mode === 'files' ? files.length > 0 : text.trim().length > 0);
  const sendLabel =
    targetCount === 0
      ? 'Elige a quién enviar'
      : mode === 'files' && files.length === 0
        ? 'Elige los archivos'
        : mode === 'text' && !text.trim()
          ? 'Escribe el mensaje'
          : `Enviar a ${pluralize(targetCount, 'dispositivo')}`;

  return (
    <div
      className="card shadow-sm"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="card-header bg-body pt-3 pb-0 border-bottom-0">
        <ul className="nav nav-tabs card-header-tabs">
          <li className="nav-item">
            <button
              className={`nav-link d-flex align-items-center gap-2 ${mode === 'files' ? 'active' : ''}`}
              onClick={() => props.onModeChange('files')}
            >
              <i className="bi bi-files" />
              Archivos
              {files.length > 0 && <span className="badge text-bg-primary rounded-pill">{files.length}</span>}
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link d-flex align-items-center gap-2 ${mode === 'text' ? 'active' : ''}`}
              onClick={() => props.onModeChange('text')}
            >
              <i className="bi bi-chat-left-text" />
              Texto o link
            </button>
          </li>
        </ul>
      </div>

      <div className="card-body border-top">
        {mode === 'files' ? (
          <>
            <button
              type="button"
              className={`dropzone w-100 ${dragging ? 'over' : ''}`}
              onClick={() => fileInput.current?.click()}
            >
              <i className="bi bi-cloud-arrow-up display-6 text-primary" />
              {isDesktop ? (
                <span className="d-block fw-medium mt-2">
                  Arrastra archivos o carpetas aquí, o <span className="text-primary">elígelos</span>
                </span>
              ) : (
                <span className="d-block fw-medium mt-2 text-primary">Toca para elegir archivos</span>
              )}
              <span className="d-block small text-body-secondary">
                {isDesktop ? 'También puedes pegar con Ctrl+V' : 'Fotos, videos, PDF, documentos…'}
              </span>
            </button>
            {isDesktop && supportsFolderPicker && (
              <div className="text-center mt-2">
                <button className="btn btn-link btn-sm text-decoration-none" onClick={() => folderInput.current?.click()}>
                  <i className="bi bi-folder-plus me-1" />
                  Elegir una carpeta completa
                </button>
              </div>
            )}
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              data-testid="file-input"
              onChange={(e) => {
                // Copiar ya: el FileList del input se vacía cuando se resetea su value
                props.onAdd(fromFileList(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <input
              ref={folderInput}
              type="file"
              hidden
              data-testid="folder-input"
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => {
                props.onAdd(fromFileList(e.target.files ?? []));
                e.target.value = '';
              }}
            />

            {files.length > 0 && (
              <>
                <div className="d-flex justify-content-between align-items-center mt-3 mb-2">
                  <span className="small text-body-secondary">
                    {pluralize(files.length, 'archivo')} · {formatBytes(totalSize)}
                  </span>
                  <button className="btn btn-link btn-sm p-0 text-decoration-none text-danger" onClick={props.onClear}>
                    Quitar todos
                  </button>
                </div>
                <ul className="list-group file-list">
                  {groups.map((g) => (
                    <li key={g.key} className="list-group-item d-flex align-items-center gap-2">
                      <i
                        className={`bi ${
                          g.folder ? 'bi-folder-fill text-warning' : fileIcon(g.files[0].file.name, g.files[0].file.type)
                        } fs-5 ${g.folder ? '' : 'text-body-secondary'}`}
                      />
                      <span className="flex-grow-1 text-truncate min-w-0" title={g.folder ?? g.files[0].path}>
                        {g.folder ?? g.files[0].file.name}
                        {g.folder && (
                          <span className="small text-body-secondary ms-2">{pluralize(g.files.length, 'archivo')}</span>
                        )}
                      </span>
                      <span className="small text-body-secondary text-nowrap">{formatBytes(g.size)}</span>
                      <button
                        className="btn btn-sm btn-link text-body-secondary p-0 ms-1"
                        onClick={() => props.onRemove((f) => g.files.includes(f))}
                        aria-label={`Quitar ${g.folder ?? g.files[0].file.name}`}
                      >
                        <i className="bi bi-x-lg" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <>
            <textarea
              className="form-control"
              rows={5}
              placeholder="Pega un link, una dirección, una contraseña o cualquier texto…"
              value={text}
              onChange={(e) => props.onTextChange(e.target.value)}
              maxLength={20000}
              aria-label="Texto a enviar"
            />
            <div className="form-text">Le llega al otro dispositivo al instante, listo para copiar.</div>
          </>
        )}

        <button
          className="btn btn-primary btn-lg w-100 mt-3 d-flex align-items-center justify-content-center gap-2"
          disabled={!canSend}
          onClick={props.onSend}
        >
          <i className="bi bi-send-fill" />
          {sendLabel}
        </button>
      </div>
    </div>
  );
}
