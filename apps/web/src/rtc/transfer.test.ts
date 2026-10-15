import { describe, expect, it, vi } from 'vitest';
import { channelPair } from './mockChannel';
import { receiveTransfer, sendFiles, sendText, TransferEnded, type OfferDecision, type ReceivedFile } from './transfer';

function item(content: string | Uint8Array, path: string, type = 'text/plain') {
  const blob = new Blob([content as BlobPart], { type });
  return { file: blob, name: path.split('/').pop()!, path, type };
}

function bigBytes(size: number) {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (i * 31 + 7) % 251;
  return data;
}

function receiver(decision: OfferDecision | (() => Promise<OfferDecision>)) {
  const [a, b] = channelPair();
  const files: ReceivedFile[] = [];
  const events = {
    done: vi.fn(),
    ended: vi.fn(),
    text: vi.fn(),
    offer: vi.fn(),
  };
  const controller = receiveTransfer(b, {
    onOffer: async (offer) => {
      events.offer(offer);
      return typeof decision === 'function' ? decision() : decision;
    },
    onText: events.text,
    onProgress: () => {},
    onFile: (f) => files.push(f),
    onDone: events.done,
    onEnded: events.ended,
  });
  return { sender: a, files, events, controller };
}

describe('protocolo de transferencia', () => {
  it('envía varios archivos con sus carpetas y llegan idénticos', async () => {
    const { sender, files, events } = receiver({ accept: true });
    const big = bigBytes(300 * 1024 + 123); // varios chunks y un resto
    const progress: number[] = [];

    await sendFiles(
      sender,
      [item('hola', 'nota.txt'), item(big, 'Fotos/2024/grande.bin', 'application/octet-stream'), item('', 'vacio.txt')],
      'PC de prueba',
      { onAccepted: () => {}, onProgress: (n) => progress.push(n) },
    );

    expect(events.offer).toHaveBeenCalledWith(
      expect.objectContaining({ senderName: 'PC de prueba', totalBytes: 4 + big.length }),
    );
    expect(events.done).toHaveBeenCalledOnce();
    expect(events.ended).not.toHaveBeenCalled();
    expect(files.map((f) => f.path)).toEqual(['nota.txt', 'Fotos/2024/grande.bin', 'vacio.txt']);
    expect(await files[0].blob!.text()).toBe('hola');
    expect(Buffer.from(await files[1].blob!.arrayBuffer()).equals(Buffer.from(big))).toBe(true);
    expect(files[2].blob!.size).toBe(0);
    expect(progress.at(-1)).toBe(4 + big.length);
  });

  it('avisa al emisor cuando el receptor rechaza', async () => {
    const { sender, events } = receiver({ accept: false });
    const result = sendFiles(sender, [item('x', 'a.txt')], 'PC', { onAccepted: () => {}, onProgress: () => {} });
    await expect(result).rejects.toMatchObject({ reason: 'rejected' });
    await new Promise((r) => setTimeout(r, 10));
    expect(events.ended).not.toHaveBeenCalled(); // rechazar no es un error para el receptor
  });

  it('el emisor puede cancelar mientras espera la respuesta', async () => {
    const { sender, events } = receiver(() => new Promise(() => {})); // el usuario nunca responde
    const abort = new AbortController();
    const result = sendFiles(sender, [item('x', 'a.txt')], 'PC', { onAccepted: () => {}, onProgress: () => {} }, abort.signal);
    await vi.waitFor(() => expect(events.offer).toHaveBeenCalled());
    abort.abort();
    await expect(result).rejects.toMatchObject({ reason: 'cancelled' });
    await vi.waitFor(() => expect(events.ended).toHaveBeenCalledWith('remote-cancelled'));
  });

  it('el receptor puede cancelar a mitad de la transferencia', async () => {
    const { sender, events, controller } = receiver({ accept: true });
    let cancelled = false;
    const result = sendFiles(sender, [item(bigBytes(2 * 1024 * 1024), 'grande.bin')], 'PC', {
      onAccepted: () => {},
      onProgress: (n) => {
        if (!cancelled && n > 256 * 1024) {
          cancelled = true;
          controller.cancel();
        }
      },
    });
    const error = await result.catch((e) => e);
    expect(error).toBeInstanceOf(TransferEnded);
    expect(['remote-cancelled', 'connection']).toContain(error.reason);
    expect(events.ended).toHaveBeenCalledWith('cancelled');
    expect(events.done).not.toHaveBeenCalled();
  });

  it('envía textos sin pedir confirmación', async () => {
    const { sender, events } = receiver({ accept: true });
    await sendText(sender, 'https://ejemplo.com', 'Celular');
    expect(events.text).toHaveBeenCalledWith('https://ejemplo.com', 'Celular');
    expect(events.offer).not.toHaveBeenCalled();
  });
});
