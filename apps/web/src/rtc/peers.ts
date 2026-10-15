import type { SignalPayload } from '@transfer/shared';

/**
 * En la misma red local WebRTC conecta directo con los candidatos "host".
 * El STUN público solo ayuda cuando la red tiene NAT entre dispositivos;
 * nunca transporta los archivos.
 */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

type SendSignal = (to: string, payload: SignalPayload) => void;
type OnChannel = (peerId: string, channel: RTCDataChannel) => void;

/**
 * Una conexión WebRTC por dispositivo remoto, reutilizada por todas las
 * transferencias con ese dispositivo (cada transferencia abre su propio
 * DataChannel). Usa el patrón "perfect negotiation" para que ambos lados
 * puedan iniciar sin pisarse.
 */
class PeerLink {
  readonly pc = new RTCPeerConnection(RTC_CONFIG);
  private makingOffer = false;
  private ignoreOffer = false;

  constructor(
    private readonly peerId: string,
    private readonly polite: boolean,
    private readonly sendSignal: SendSignal,
    onChannel: OnChannel,
  ) {
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        this.sendSignal(this.peerId, { type: 'offer', sdp: this.pc.localDescription!.sdp });
      } catch (err) {
        console.error('Error creando la oferta WebRTC', err);
      } finally {
        this.makingOffer = false;
      }
    };
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal(this.peerId, { type: 'ice', candidate: candidate.toJSON() });
    };
    this.pc.ondatachannel = (e) => onChannel(this.peerId, e.channel);
  }

  get broken() {
    return this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed';
  }

  async handle(payload: SignalPayload) {
    if (payload.type === 'ice') {
      try {
        await this.pc.addIceCandidate(payload.candidate);
      } catch (err) {
        if (!this.ignoreOffer) throw err;
      }
      return;
    }

    const collision =
      payload.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
    this.ignoreOffer = !this.polite && collision;
    if (this.ignoreOffer) return;

    await this.pc.setRemoteDescription({ type: payload.type, sdp: payload.sdp });
    if (payload.type === 'offer') {
      await this.pc.setLocalDescription();
      this.sendSignal(this.peerId, { type: 'answer', sdp: this.pc.localDescription!.sdp });
    }
  }

  close() {
    this.pc.close();
  }
}

export class PeerManager {
  private links = new Map<string, PeerLink>();

  constructor(
    private readonly selfId: string,
    private readonly sendSignal: SendSignal,
    private readonly onChannel: OnChannel,
  ) {}

  private link(peerId: string): PeerLink {
    let link = this.links.get(peerId);
    if (!link || link.broken) {
      link?.close();
      // Regla fija para decidir quién cede si ambos ofrecen a la vez
      const polite = this.selfId < peerId;
      link = new PeerLink(peerId, polite, this.sendSignal, this.onChannel);
      this.links.set(peerId, link);
    }
    return link;
  }

  handleSignal(from: string, payload: SignalPayload) {
    this.link(from)
      .handle(payload)
      .catch((err) => console.error('Error de señalización WebRTC', err));
  }

  openChannel(peerId: string, label: string): RTCDataChannel {
    return this.link(peerId).pc.createDataChannel(label, { ordered: true });
  }

  remove(peerId: string) {
    this.links.get(peerId)?.close();
    this.links.delete(peerId);
  }

  closeAll() {
    for (const link of this.links.values()) link.close();
    this.links.clear();
  }
}
