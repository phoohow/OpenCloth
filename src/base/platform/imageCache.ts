const entries = new Map<string, Entry>();

const inFlight = new Set<Promise<HTMLImageElement | null>>();

interface Entry {
  promise: Promise<HTMLImageElement | null>;
  image: HTMLImageElement | null;
  refs: number;
  pinned: boolean;
  settled: boolean;
  waiting: (() => void)[];
}

export interface ImageLease {
  readonly image: HTMLImageElement | null;
  readonly ready: Promise<HTMLImageElement | null>;
  release(): void;
}

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

export async function whenImagesReady(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}

function open(url: string, pinned: boolean): Entry {
  const promise = new Promise<HTMLImageElement | null>(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
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
    if (!image && entry.refs <= 0 && !entry.pinned) entries.delete(url);
  });
  return entry;
}
