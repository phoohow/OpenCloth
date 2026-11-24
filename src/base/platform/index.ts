export { downloadBlob, downloadTextFile, downloadBytesFile } from '@/base/platform/download';
export { imageAt, retainImage, whenImagesReady, type ImageLease } from '@/base/platform/imageCache';
export {
  canChooseSaveFile, chooseSaveFile, type SaveFile, type SaveFileType,
} from '@/base/platform/saveFile';

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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

export async function waitForChange(
  probe: () => number, from: number, timeoutMs = 1500, intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (probe() === from && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
