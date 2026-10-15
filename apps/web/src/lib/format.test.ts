import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, pluralize, randomRoomCode } from './format';
import { normalizeRoom } from '@transfer/shared';

describe('formato', () => {
  it('muestra tamaños legibles', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });

  it('muestra tiempos restantes', () => {
    expect(formatDuration(0.2)).toBe('1 s');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(180)).toBe('3 min');
    expect(formatDuration(4800)).toBe('1 h 20 min');
    expect(formatDuration(Infinity)).toBe('—');
  });

  it('pluraliza', () => {
    expect(pluralize(1, 'archivo')).toBe('1 archivo');
    expect(pluralize(3, 'archivo')).toBe('3 archivos');
  });

  it('genera códigos de sala válidos', () => {
    const code = randomRoomCode();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(normalizeRoom(code)).toBe(code);
    expect(normalizeRoom(' ab-12 cd ')).toBe('AB12CD');
  });
});
