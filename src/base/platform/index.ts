export {
  imageAt, retainImage, whenImagesReady, type ImageLease,
} from '@/base/platform/imageCache';

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

/** PNG data url of an RGBA frame; `pixels` is read back tightly packed, one row after another. */
export function pixelsToPngDataUrl(pixels: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const image = context.createImageData(width, height);
  image.data.set(pixels.subarray(0, width * height * 4));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Resolves once `probe` leaves `from`, or after `timeoutMs`; a slow load must not stall the caller. */
export async function waitForChange(
  probe: () => number, from: number, timeoutMs = 1500, intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (probe() === from && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
