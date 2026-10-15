let audio: AudioContext | null = null;

/** Prepara el audio en el primer toque (los navegadores lo exigen). */
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

/** Dos tonos cortos para avisar que llegó algo. */
export function playChime() {
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    const start = now + i * 0.14;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  }
}

export const notificationsSupported =
  typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;

/** Sonido, vibración y, si la pestaña no está a la vista, notificación del sistema. */
export function announce(title: string, body: string) {
  playChime();
  navigator.vibrate?.([120, 60, 120]);
  if (notificationsSupported && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification(title, { body, icon: '/icons/icon-192.png', tag: 'transfer' });
    } catch {
      // Android exige mostrarla desde el service worker; el sonido y la vibración bastan
    }
  }
}
