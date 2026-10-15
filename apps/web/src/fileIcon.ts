const BY_EXTENSION: Record<string, string> = {
  pdf: 'bi-file-earmark-pdf',
  doc: 'bi-file-earmark-word',
  docx: 'bi-file-earmark-word',
  xls: 'bi-file-earmark-excel',
  xlsx: 'bi-file-earmark-excel',
  csv: 'bi-file-earmark-spreadsheet',
  ppt: 'bi-file-earmark-ppt',
  pptx: 'bi-file-earmark-ppt',
  zip: 'bi-file-earmark-zip',
  rar: 'bi-file-earmark-zip',
  '7z': 'bi-file-earmark-zip',
  txt: 'bi-file-earmark-text',
  md: 'bi-file-earmark-text',
  json: 'bi-file-earmark-code',
  js: 'bi-file-earmark-code',
  ts: 'bi-file-earmark-code',
  html: 'bi-file-earmark-code',
  apk: 'bi-android2',
};

/** Clase de Bootstrap Icons que representa el tipo de archivo. */
export function fileIcon(name: string, type = ''): string {
  if (type.startsWith('image/')) return 'bi-file-earmark-image';
  if (type.startsWith('video/')) return 'bi-file-earmark-play';
  if (type.startsWith('audio/')) return 'bi-file-earmark-music';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? 'bi-file-earmark';
}
