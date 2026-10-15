import { useCallback, useEffect, useState } from 'react';
import { detectDeviceKind, loadDeviceName, saveDeviceName } from './signaling';
import { useTransfers } from './useTransfers';
import { Header } from './components/Header';
import { DeviceList } from './components/DeviceList';
import { SendPanel } from './components/SendPanel';
import { TransferList } from './components/TransferList';
import { IncomingRequests } from './components/IncomingRequests';
import { ConnectModal } from './components/ConnectModal';
import { roomFromUrl, setRoomInUrl } from './lib/room';
import { randomRoomCode } from './lib/format';
import { fromFileList, type OutgoingFile } from './lib/files';
import { takeSharedPayload } from './lib/idb';
import { unlockAudio } from './lib/notify';

const isDesktop = detectDeviceKind() === 'desktop';
const BASE_TITLE = document.title;

export function App() {
  const [name, setName] = useState(loadDeviceName);
  const [room, setRoom] = useState(roomFromUrl);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<OutgoingFile[]>([]);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'files' | 'text'>('files');
  const [showConnect, setShowConnect] = useState(false);

  const changeRoom = useCallback((next: string) => {
    setRoomInUrl(next);
    setRoom(next);
    setSelected(new Set());
  }, []);

  // El servidor exige sala (modo público): se crea una automáticamente y
  // se muestra el modal para que el usuario la comparta con quien reciba.
  const handleRoomRequired = useCallback(() => {
    changeRoom(randomRoomCode());
    setShowConnect(true);
  }, [changeRoom]);

  const { connected, peers, transfers, sendFilesTo, sendTextTo, answer, cancel, dismiss, clearFinished } =
    useTransfers(name, room, handleRoomRequired);

  const targets = peers.filter((p) => selected.has(p.id));
  const incoming = transfers.filter((t) => t.status === 'incoming');

  const addFiles = useCallback((added: OutgoingFile[]) => {
    if (added.length) setFiles((prev) => [...prev, ...added]);
  }, []);

  // Olvidar a los que se desconectaron y, si solo queda uno, dejarlo elegido
  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set([...prev].filter((id) => peers.some((p) => p.id === id)));
      if (alive.size === 0 && peers.length === 1) alive.add(peers[0].id);
      return alive.size === prev.size && [...alive].every((id) => prev.has(id)) ? prev : alive;
    });
  }, [peers]);

  // Lo que llegó desde "Compartir" en otra app (PWA instalada)
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('shared')) return;
    const url = new URL(location.href);
    url.searchParams.delete('shared');
    history.replaceState(null, '', url);
    takeSharedPayload()
      .then((shared) => {
        if (!shared) return;
        if (shared.files.length) addFiles(fromFileList(shared.files));
        else if (shared.text) {
          setText(shared.text);
          setMode('text');
        }
      })
      .catch(() => {});
  }, [addFiles]);

  // Pegar archivos o texto con Ctrl+V en cualquier parte de la página
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea')) return;
      const pasted = e.clipboardData?.files;
      if (pasted && pasted.length) {
        e.preventDefault();
        setMode('files');
        addFiles(fromFileList(pasted));
        return;
      }
      const pastedText = e.clipboardData?.getData('text');
      if (pastedText) {
        setMode('text');
        setText(pastedText);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  // Contador de solicitudes en el título de la pestaña
  useEffect(() => {
    document.title = incoming.length ? `(${incoming.length}) ${BASE_TITLE}` : BASE_TITLE;
  }, [incoming.length]);

  // El navegador solo deja sonar audio después de un toque del usuario
  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
  }, []);

  function rename(next: string) {
    saveDeviceName(next);
    setName(next);
  }

  function togglePeer(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const all = peers.every((p) => selected.has(p.id));
    setSelected(all ? new Set() : new Set(peers.map((p) => p.id)));
  }

  function send() {
    const ids = targets.map((p) => p.id);
    if (mode === 'files') {
      sendFilesTo(ids, files);
      setFiles([]);
    } else {
      sendTextTo(ids, text);
      setText('');
    }
  }

  return (
    <>
      <Header
        name={name}
        connected={connected}
        room={room}
        onRename={rename}
        onOpenConnect={() => setShowConnect(true)}
      />

      {!connected && (
        <div className="alert alert-warning rounded-0 border-0 border-bottom mb-0 small py-2 text-center">
          <i className="bi bi-exclamation-triangle me-1" />
          Sin conexión con el servidor. Reintentando…
        </div>
      )}

      <main className="container py-4">
        <div className="row g-4">
          <div className="col-lg-5">
            <DeviceList
              peers={peers}
              selected={selected}
              connected={connected}
              room={room}
              onToggle={togglePeer}
              onToggleAll={toggleAll}
              onOpenConnect={() => setShowConnect(true)}
            />
          </div>
          <div className="col-lg-7 d-grid gap-4 align-content-start">
            <SendPanel
              files={files}
              text={text}
              mode={mode}
              targetCount={targets.length}
              isDesktop={isDesktop}
              onModeChange={setMode}
              onAdd={addFiles}
              onRemove={(predicate) => setFiles((prev) => prev.filter((f) => !predicate(f)))}
              onClear={() => setFiles([])}
              onTextChange={setText}
              onSend={send}
            />
            <TransferList
              transfers={transfers}
              onCancel={cancel}
              onDismiss={dismiss}
              onClearFinished={clearFinished}
            />
          </div>
        </div>
      </main>

      <IncomingRequests requests={incoming} onAnswer={answer} />
      {showConnect && <ConnectModal room={room} onRoomChange={changeRoom} onClose={() => setShowConnect(false)} />}
    </>
  );
}
