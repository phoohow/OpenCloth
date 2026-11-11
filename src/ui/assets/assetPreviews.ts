import { useEffect, useState } from 'react';

/** Kinds of preview the render backend can draw for a catalogue row. */
export type PreviewKind = 'model' | 'environment';

/** Draws one asset file as a preview data URL; null when it cannot be rendered. */
type PreviewDrawer = (url: string) => Promise<string | null>;

/** Drawers installed by the app assembly point, which owns the only access to the render backend. */
const drawers: Partial<Record<PreviewKind, PreviewDrawer>> = {};

/** One request per asset, so switching tabs never renders the same file twice. */
const requests = new Map<string, Promise<string | null>>();

/** Installs the drawers that produce catalogue previews. */
export function registerAssetPreviews(next: Partial<Record<PreviewKind, PreviewDrawer>>): void {
  Object.assign(drawers, next);
}

/** Preview of one asset file, drawn on first request and cached for the session. */
export function assetPreview(kind: PreviewKind, url: string): Promise<string | null> {
  const key = `${kind}|${url}`;
  const pending = requests.get(key);
  if (pending) return pending;
  const draw = drawers[kind];
  if (!draw) return Promise.resolve(null);
  const started = draw(url).catch(() => null);
  requests.set(key, started);
  return started;
}

/** Preview of one catalogue asset, starting the render the first time a row asks for it. */
export function useAssetPreview(kind: PreviewKind, url: string | null): string | null {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    if (!url) return undefined;
    let cancelled = false;
    void assetPreview(kind, url).then(result => { if (!cancelled) setPreview(result); });
    return () => { cancelled = true; };
  }, [kind, url]);

  return preview;
}
