const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${UNITS[unit]}`;
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Limita cuántas veces por segundo se llama fn (para no re-renderizar por cada chunk). */
export function throttle<T>(fn: (value: T) => void, ms = 100): (value: T) => void {
  let last = 0;
  return (value) => {
    const now = performance.now();
    if (now - last >= ms) {
      last = now;
      fn(value);
    }
  };
}
