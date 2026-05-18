export interface UploadDropFile {
  relativePath: string;
  file: File;
}

export class UploadDropError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadDropError';
  }
}

interface UploadEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface UploadFileEntry extends UploadEntry {
  isFile: true;
  isDirectory: false;
  file(successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void): void;
}

interface UploadDirectoryEntry extends UploadEntry {
  isFile: false;
  isDirectory: true;
  createReader(): UploadDirectoryReader;
}

interface UploadDirectoryReader {
  readEntries(successCallback: (entries: UploadEntry[]) => void, errorCallback?: (error: DOMException) => void): void;
}

export function hasFileDrop(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) {
    return false;
  }
  const types = Array.from(dataTransfer.types ?? []);
  if (types.includes('Files')) {
    return true;
  }
  if (listItems(dataTransfer.items).some((item) => item.kind === 'file')) {
    return true;
  }
  return listFiles(dataTransfer.files).length > 0;
}

export async function collectUploadDrop(dataTransfer: DataTransfer): Promise<UploadDropFile[]> {
  const items = listItems(dataTransfer.items).filter((item) => item.kind === 'file');
  if (items.length > 0) {
    return collectFromItems(items);
  }
  return collectFromFileList(dataTransfer.files);
}

async function collectFromItems(items: DataTransferItem[]): Promise<UploadDropFile[]> {
  const files: UploadDropFile[] = [];
  for (const item of items) {
    const entry = getUploadEntry(item);
    if (entry) {
      await collectEntry(entry, '', files);
      continue;
    }

    const file = item.getAsFile();
    if (file) {
      files.push({ relativePath: relativePathForFile(file), file });
      continue;
    }

    throw new UploadDropError('Folder upload is not supported by this browser.');
  }

  return files;
}

function collectFromFileList(fileList: FileList): UploadDropFile[] {
  return listFiles(fileList).map((file) => ({
    relativePath: relativePathForFile(file),
    file
  }));
}

async function collectEntry(entry: UploadEntry, parentPath: string, output: UploadDropFile[]) {
  const relativePath = joinPath(parentPath, entry.name);
  if (entry.isFile) {
    const file = await readFileEntry(entry as UploadFileEntry);
    output.push({ relativePath, file });
    return;
  }

  if (!entry.isDirectory) {
    return;
  }

  const reader = (entry as UploadDirectoryEntry).createReader();
  const children = await readAllDirectoryEntries(reader);
  for (const child of children) {
    await collectEntry(child, relativePath, output);
  }
}

function readFileEntry(entry: UploadFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, (error) => reject(error));
  });
}

async function readAllDirectoryEntries(reader: UploadDirectoryReader): Promise<UploadEntry[]> {
  const entries: UploadEntry[] = [];
  while (true) {
    const chunk = await readDirectoryEntries(reader);
    if (chunk.length === 0) {
      return entries;
    }
    entries.push(...chunk);
  }
}

function readDirectoryEntries(reader: UploadDirectoryReader): Promise<UploadEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, (error) => reject(error));
  });
}

function relativePathForFile(file: File): string {
  const webkitRelativePath = file.webkitRelativePath;
  return normalizeRelativePath(typeof webkitRelativePath === 'string' && webkitRelativePath ? webkitRelativePath : file.name);
}

function getUploadEntry(item: DataTransferItem): UploadEntry | null {
  const maybeEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry?.();
  return isUploadEntry(maybeEntry) ? maybeEntry : null;
}

function isUploadEntry(value: unknown): value is UploadEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Partial<UploadEntry>;
  return typeof entry.name === 'string' && typeof entry.isFile === 'boolean' && typeof entry.isDirectory === 'boolean';
}

function joinPath(parentPath: string, name: string): string {
  return normalizeRelativePath(parentPath ? `${parentPath}/${name}` : name);
}

function normalizeRelativePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function listItems(items: DataTransferItemList | undefined): DataTransferItem[] {
  return items ? Array.from(items) : [];
}

function listFiles(files: FileList | undefined): File[] {
  return files ? Array.from(files) : [];
}
