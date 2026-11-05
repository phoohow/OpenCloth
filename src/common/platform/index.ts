/** Hands a blob to the browser as a downloaded file. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking in the same task can cancel the download of a large blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Downloads text content as a browser file. */
export function downloadTextFile(filename: string, content: string, mime = 'application/json'): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

/** Downloads binary content, such as a generated PDF, as a browser file. */
export function downloadBytesFile(filename: string, content: Uint8Array, mime: string): void {
  // slice() copies into a fresh ArrayBuffer, which is what BlobPart accepts.
  downloadBlob(new Blob([content.slice()], { type: mime }), filename);
}

/** Downloads an existing url, such as a canvas data url, as a browser file. */
export function downloadUrl(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}

/** Reads a user-selected file as text. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/** Reads a user-selected file as a data url. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
