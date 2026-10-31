/** Recording targets tried in preference order. */
const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm', 'video/webm;codecs=vp8'];

const DEFAULT_DURATION_MS = 5000;
const DEFAULT_FPS = 30;

export interface AnimationExportOptions {
  /** Recording length in milliseconds. */
  durationMs?: number;
  /** Frames per second captured from the canvas. */
  fps?: number;
}

/** First supported WebM container; undefined lets MediaRecorder pick its default. */
function supportedMimeType(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type));
}

/** Hands the recording to the browser as a downloaded file. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking in the same task can cancel the download of a large blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Waits for the recording window without blocking the page. */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Records the canvas for a fixed duration and downloads it as WebM.
 * The caller keeps the canvas drawing; this only captures, then stops the stream and hands over the file.
 * Returns `'unsupported'` when the browser cannot record the canvas or produced no data.
 */
export async function recordCanvasToWebM(
  canvas: HTMLCanvasElement,
  filename = 'animation.webm',
  options: AnimationExportOptions = {},
): Promise<'saved' | 'unsupported'> {
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') return 'unsupported';
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  const fps = options.fps ?? DEFAULT_FPS;

  const stream = canvas.captureStream(fps);
  const mimeType = supportedMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
  const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });

  try {
    recorder.start();
  } catch {
    stream.getTracks().forEach(track => track.stop());
    return 'unsupported';
  }

  await wait(durationMs);
  if (recorder.state !== 'inactive') recorder.stop();
  await stopped;
  stream.getTracks().forEach(track => track.stop());

  if (chunks.length === 0) return 'unsupported';
  downloadBlob(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }), filename);
  return 'saved';
}
