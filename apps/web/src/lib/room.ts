import { normalizeRoom } from '@transfer/shared';

const PARAM = 'sala';

export function roomFromUrl(): string {
  return normalizeRoom(new URLSearchParams(location.search).get(PARAM));
}

export function setRoomInUrl(room: string) {
  const url = new URL(location.href);
  if (room) url.searchParams.set(PARAM, room);
  else url.searchParams.delete(PARAM);
  history.replaceState(null, '', url);
}

export function urlWithRoom(base: string, room: string): string {
  const url = new URL(base);
  if (room) url.searchParams.set(PARAM, room);
  return url.toString();
}
