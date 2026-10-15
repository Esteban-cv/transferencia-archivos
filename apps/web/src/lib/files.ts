/** Archivo por enviar, con su ruta relativa si viene de una carpeta. */
export interface OutgoingFile {
  file: File;
  /** Ej. "Fotos/2024/playa.jpg"; para archivos sueltos es solo el nombre. */
  path: string;
}

export function fromFileList(list: FileList | File[]): OutgoingFile[] {
  return Array.from(list).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(all);
        all.push(...batch);
        next(); // readEntries devuelve máximo 100 por llamada
      }, reject);
    next();
  });
}

async function walk(entry: FileSystemEntry, prefix: string, out: OutgoingFile[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({ file, path: prefix + file.name });
  } else if (entry.isDirectory) {
    const entries = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of entries) await walk(child, `${prefix}${entry.name}/`, out);
  }
}

/** Lee archivos y carpetas soltados con arrastrar y soltar, conservando la estructura. */
export async function fromDataTransfer(data: DataTransfer): Promise<OutgoingFile[]> {
  const entries = Array.from(data.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e));

  if (entries.length === 0) return fromFileList(data.files);

  const out: OutgoingFile[] = [];
  for (const entry of entries) await walk(entry, '', out);
  return out;
}

export const supportsFolderPicker = (() => {
  if (typeof document === 'undefined') return false;
  return 'webkitdirectory' in document.createElement('input');
})();

/** Primer segmento de la ruta si el archivo viene dentro de una carpeta. */
export function topFolder(path: string): string | null {
  const i = path.indexOf('/');
  return i > 0 ? path.slice(0, i) : null;
}
