/**
 * Decoded images keyed by data URL. Fabric maps, print artwork and the 2D pane all draw the same
 * user-supplied images, so one decode per URL serves every reader.
 */

/** One URL's decode: in flight or finished, with the leases holding it. */
interface Entry {
  promise: Promise<HTMLImageElement | null>;
  /** Decoded image, null while loading and after a failed decode. */
  image: HTMLImageElement | null;
  /** Texture bindings holding this entry; the last release frees it. */
  refs: number;
  /** Kept for the life of the page once drawn, so a repaint never decodes it again. */
  pinned: boolean;
  settled: boolean;
  /** Repaint callbacks waiting for the decode to settle. */
  waiting: (() => void)[];
}

const entries = new Map<string, Entry>();
/** Decodes requested so far and not yet settled. */
const inFlight = new Set<Promise<HTMLImageElement | null>>();

/** Reference to one decoded image held by a texture binding. */
export interface ImageLease {
  /** Decoded image, null until it loads or once it has failed. */
  readonly image: HTMLImageElement | null;
  /** Resolves with the image, or null when the decode failed. */
  readonly ready: Promise<HTMLImageElement | null>;
  /** Drops this lease; the cache entry goes with the last one. */
  release(): void;
}

/**
 * Decoded image for a data URL, or null while it loads. The entry stays cached, and `onReady`
 * fires once when the decode settles, so the caller can repaint and drop its placeholder.
 */
export function imageAt(url: string, onReady?: () => void): HTMLImageElement | null {
  if (!url) return null;
  let entry = entries.get(url);
  if (!entry) {
    entry = open(url, true);
    if (onReady) entry.waiting.push(onReady);
    return null;
  }
  if (entry.settled) return entry.image;
  if (onReady) entry.waiting.push(onReady);
  return null;
}

/** Ref-counted image for a texture binding; the entry lives until the last lease is released. */
export function retainImage(url: string): ImageLease {
  const entry = entries.get(url) ?? open(url, false);
  entry.refs += 1;
  let released = false;
  return {
    get image() { return entry.image; },
    ready: entry.promise,
    release() {
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs <= 0 && !entry.pinned && entry.settled) entries.delete(url);
    },
  };
}

/** Resolves after every image requested so far has finished loading or failed. */
export async function whenImagesReady(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}

/** Starts the decode of one URL and registers its cache entry. */
function open(url: string, pinned: boolean): Entry {
  const promise = new Promise<HTMLImageElement | null>(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    // A broken image resolves null so the caller keeps drawing its placeholder.
    image.onerror = () => resolve(null);
    image.src = url;
  });
  const entry: Entry = { promise, image: null, refs: 0, pinned, settled: false, waiting: [] };
  entries.set(url, entry);
  inFlight.add(promise);
  void promise.then(image => {
    inFlight.delete(promise);
    entry.image = image;
    entry.settled = true;
    const waiting = entry.waiting;
    entry.waiting = [];
    for (const notify of waiting) notify();
    // A failed decode stays cached while anything still holds it, so it is not retried per frame.
    if (!image && entry.refs <= 0 && !entry.pinned) entries.delete(url);
  });
  return entry;
}
