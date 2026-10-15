import type { Channel } from './transfer';

/**
 * Par de canales conectados en memoria que imitan un RTCDataChannel,
 * para probar el protocolo sin navegador ni red.
 */
class MockChannel extends EventTarget implements Channel {
  readyState: RTCDataChannelState = 'connecting';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType: BinaryType = 'arraybuffer';
  peer!: MockChannel;

  send(data: string | ArrayBuffer) {
    if (this.readyState !== 'open') throw new Error('canal cerrado');
    const copy = typeof data === 'string' ? data : data.slice(0);
    queueMicrotask(() => {
      if (this.peer.readyState === 'open') this.peer.dispatchEvent(new MessageEvent('message', { data: copy }));
    });
  }

  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
    // El otro lado se entera un poco después, como en la red
    setTimeout(() => this.peer.close(), 0);
  }

  open() {
    this.readyState = 'open';
    this.dispatchEvent(new Event('open'));
  }
}

export function channelPair(): [MockChannel, MockChannel] {
  const a = new MockChannel();
  const b = new MockChannel();
  a.peer = b;
  b.peer = a;
  setTimeout(() => {
    a.open();
    b.open();
  }, 0);
  return [a, b];
}
