export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadTextFile(filename: string, content: string, mime = 'application/json'): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

export function downloadBytesFile(filename: string, content: Uint8Array, mime: string): void {
  downloadBlob(new Blob([content.slice()], { type: mime }), filename);
}
