import { useState, type FormEvent } from 'react';
import { notificationsSupported } from '../lib/notify';

interface Props {
  name: string;
  connected: boolean;
  room: string;
  onRename: (name: string) => void;
  onOpenConnect: () => void;
}

export function Header({ name, connected, room, onRename, onOpenConnect }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [permission, setPermission] = useState(
    notificationsSupported ? Notification.permission : 'denied',
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = draft.trim().slice(0, 40);
    if (clean && clean !== name) onRename(clean);
    setEditing(false);
  }

  async function enableNotifications() {
    setPermission(await Notification.requestPermission());
  }

  return (
    <nav className="navbar border-bottom bg-body sticky-top">
      <div className="container gap-2 flex-nowrap">
        <span className="navbar-brand d-flex align-items-center gap-2 fw-semibold me-0 min-w-0">
          <span className="brand-icon">
            <i className="bi bi-arrow-left-right" />
          </span>
          <span className="d-none d-md-inline">Transferencia de archivos</span>
        </span>

        <div className="d-flex align-items-center gap-2 min-w-0">
          <button
            className={`btn btn-sm d-flex align-items-center gap-1 ${room ? 'btn-warning' : 'btn-outline-primary'}`}
            onClick={onOpenConnect}
            title="Conectar otro dispositivo o cambiar de sala"
          >
            <i className={`bi ${room ? 'bi-lock-fill' : 'bi-qr-code'}`} />
            <span className="d-none d-sm-inline">{room ? `Sala ${room}` : 'Conectar'}</span>
            {room && <span className="d-sm-none">{room}</span>}
          </button>

          {notificationsSupported && permission === 'default' && (
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={enableNotifications}
              title="Avisarme cuando me envíen algo"
              aria-label="Activar notificaciones"
            >
              <i className="bi bi-bell" />
            </button>
          )}

          {editing ? (
            <form className="d-flex gap-1" onSubmit={submit}>
              <input
                className="form-control form-control-sm name-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={40}
                autoFocus
                aria-label="Nombre de este dispositivo"
              />
              <button className="btn btn-sm btn-primary" type="submit" aria-label="Guardar nombre">
                <i className="bi bi-check-lg" />
              </button>
            </form>
          ) : (
            <button
              className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-2 min-w-0"
              onClick={() => {
                setDraft(name);
                setEditing(true);
              }}
              title="Cambiar el nombre con el que te ven los demás"
            >
              <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
              <span className="text-truncate device-name">{name}</span>
              <i className="bi bi-pencil small" />
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
