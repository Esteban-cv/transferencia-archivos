import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { normalizeRoom, type ServerInfo } from '@transfer/shared';
import { randomRoomCode } from '../lib/format';
import { urlWithRoom } from '../lib/room';

interface Props {
  room: string;
  onRoomChange: (room: string) => void;
  onClose: () => void;
}

const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** Dirección que deben abrir los demás dispositivos de la red. */
function useShareBase() {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [requireRoom, setRequireRoom] = useState(false);

  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json() as Promise<ServerInfo>)
      .then((info) => {
        setRequireRoom(info.requireRoom);
        if (isLocalhost) setAddresses(info.addresses);
      })
      .catch(() => setAddresses([]));
  }, []);

  const port = location.port ? `:${location.port}` : '';
  const base = isLocalhost
    ? addresses[selected]
      ? `${location.protocol}//${addresses[selected]}${port}/`
      : null
    : `${location.origin}/`;

  return { base, addresses, selected, setSelected, requireRoom };
}

export function ConnectModal({ room, onRoomChange, onClose }: Props) {
  const { base, addresses, selected, setSelected, requireRoom } = useShareBase();
  const [qr, setQr] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const url = base ? urlWithRoom(base, room) : null;

  useEffect(() => {
    if (!url) return;
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement('textarea');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const code = normalizeRoom(joinCode);
    if (code) onRoomChange(code);
    setJoinCode('');
  }

  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" onClick={onClose}>
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title h5 d-flex align-items-center gap-2">
                <i className="bi bi-qr-code-scan text-primary" />
                Conectar otro dispositivo
              </h2>
              <button type="button" className="btn-close" aria-label="Cerrar" onClick={onClose} />
            </div>
            <div className="modal-body">
              <p className="text-body-secondary small">
                Escanea este código con la cámara del celular, o abre la dirección en cualquier
                dispositivo conectado al mismo WiFi.
              </p>

              <div className="qr-box mx-auto mb-3">
                {qr ? (
                  <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />
                ) : (
                  <div className="qr placeholder-glow d-grid place-center text-body-secondary small p-4 text-center">
                    {isLocalhost && addresses.length === 0
                      ? 'No se encontró una red. ¿Está la PC conectada al WiFi?'
                      : 'Generando…'}
                  </div>
                )}
              </div>

              {url && (
                <div className="input-group mb-2">
                  <input className="form-control form-control-sm font-monospace" value={url} readOnly aria-label="Dirección" />
                  <button className="btn btn-sm btn-outline-primary" onClick={copy}>
                    <i className={`bi ${copied ? 'bi-check-lg' : 'bi-clipboard'}`} />
                    <span className="ms-1">{copied ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
              )}

              {addresses.length > 1 && (
                <div className="small mb-2">
                  <label className="form-label small text-body-secondary mb-1" htmlFor="addr">
                    Esta PC tiene varias redes. Si el código no abre, prueba otra:
                  </label>
                  <select
                    id="addr"
                    className="form-select form-select-sm"
                    value={selected}
                    onChange={(e) => setSelected(Number(e.target.value))}
                  >
                    {addresses.map((a, i) => (
                      <option key={a} value={i}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <hr />

              <h3 className="h6 d-flex align-items-center gap-2">
                <i className="bi bi-shield-lock" />
                Sala privada
              </h3>
              {room ? (
                <p className="small mb-2">
                  Estás en la sala <span className="badge text-bg-warning fs-6 font-monospace">{room}</span>. Solo
                  se ven entre sí los dispositivos que entren con este código (o escaneen el QR de arriba).
                </p>
              ) : (
                <p className="small text-body-secondary mb-2">
                  Ahora te ve cualquiera que abra la app en esta red. Con una sala, solo te ven quienes
                  tengan el código.
                </p>
              )}
              <div className="d-flex flex-wrap gap-2">
                <button className="btn btn-sm btn-primary" onClick={() => onRoomChange(randomRoomCode())}>
                  <i className="bi bi-plus-lg me-1" />
                  Crear sala nueva
                </button>
                <form className="d-flex gap-1 flex-grow-1" onSubmit={join}>
                  <input
                    className="form-control form-control-sm font-monospace text-uppercase"
                    placeholder="Código de otra sala"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    maxLength={12}
                    aria-label="Código de sala"
                  />
                  <button className="btn btn-sm btn-outline-primary text-nowrap" type="submit" disabled={!normalizeRoom(joinCode)}>
                    Unirme
                  </button>
                </form>
              </div>
              {room && !requireRoom && (
                <button className="btn btn-sm btn-outline-secondary mt-2" onClick={() => onRoomChange('')}>
                  <i className="bi bi-box-arrow-left me-1" />
                  Salir a la red pública
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}
