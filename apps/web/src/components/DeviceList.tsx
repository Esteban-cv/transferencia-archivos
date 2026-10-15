import type { PeerInfo } from '@transfer/shared';

const ICONS: Record<PeerInfo['kind'], string> = {
  desktop: 'bi-laptop',
  mobile: 'bi-phone',
  tablet: 'bi-tablet',
};

const KIND_LABEL: Record<PeerInfo['kind'], string> = {
  desktop: 'Computador',
  mobile: 'Celular',
  tablet: 'Tablet',
};

interface Props {
  peers: PeerInfo[];
  selected: Set<string>;
  connected: boolean;
  room: string;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpenConnect: () => void;
}

export function DeviceList({ peers, selected, connected, room, onToggle, onToggleAll, onOpenConnect }: Props) {
  const allSelected = peers.length > 0 && peers.every((p) => selected.has(p.id));

  return (
    <div className="card shadow-sm h-100">
      <div className="card-header bg-body d-flex align-items-center justify-content-between py-3">
        <h2 className="h6 mb-0 d-flex align-items-center gap-2">
          <i className={`bi ${room ? 'bi-lock-fill text-warning' : 'bi-wifi text-primary'}`} />
          {room ? `Sala ${room}` : 'Dispositivos en la red'}
          {peers.length > 0 && <span className="badge text-bg-primary rounded-pill">{peers.length}</span>}
        </h2>
        {peers.length > 1 && (
          <button className="btn btn-link btn-sm p-0 text-decoration-none" onClick={onToggleAll}>
            {allSelected ? 'Quitar todos' : 'Elegir todos'}
          </button>
        )}
      </div>

      {peers.length === 0 ? (
        <div className="card-body text-center py-5">
          <div className="radar mx-auto mb-3">
            <i className="bi bi-broadcast" />
          </div>
          <p className="fw-medium mb-1">
            {connected ? 'Buscando dispositivos…' : 'Conectando con el servidor…'}
          </p>
          <p className="text-body-secondary small mb-3">
            Abre la app en otro dispositivo conectado al mismo WiFi
            {room ? ' y entra a la misma sala' : ''}.
          </p>
          <button className="btn btn-outline-primary btn-sm" onClick={onOpenConnect}>
            <i className="bi bi-qr-code me-1" />
            Mostrar código QR
          </button>
        </div>
      ) : (
        <div className="list-group list-group-flush">
          {peers.map((p) => {
            const isSelected = selected.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`list-group-item list-group-item-action d-flex align-items-center gap-3 py-3 ${
                  isSelected ? 'peer-selected' : ''
                }`}
                onClick={() => onToggle(p.id)}
                aria-pressed={isSelected}
              >
                <span className="peer-avatar">
                  <i className={`bi ${ICONS[p.kind]}`} />
                </span>
                <span className="flex-grow-1 text-start min-w-0">
                  <span className="d-block fw-medium text-truncate text-body">{p.name}</span>
                  <span className="d-block small text-body-secondary">{KIND_LABEL[p.kind]}</span>
                </span>
                <i
                  className={`bi fs-4 ${
                    isSelected ? 'bi-check-circle-fill text-primary' : 'bi-circle text-body-tertiary'
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
