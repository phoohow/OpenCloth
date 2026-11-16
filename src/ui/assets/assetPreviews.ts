import { useEffect, useState } from 'react';

/** Kinds of preview the render backend can draw for a catalogue row. */
type PreviewKind = 'model' | 'body' | 'environment' | 'pattern';

/** Draws one catalogue asset as a preview data URL; null when it cannot be rendered. */
type PreviewDrawer = (key: string) => Promise<string | null>;

/** Drawers installed by the app assembly point, which owns the only access to the render backend. */
const drawers: Partial<Record<PreviewKind, PreviewDrawer>> = {};

/** One request per asset, so switching tabs never renders the same file twice. */
const requests = new Map<string, Promise<string | null>>();

/** Installs the drawers that produce catalogue previews. */
export function registerAssetPreviews(next: Partial<Record<PreviewKind, PreviewDrawer>>): void {
  Object.assign(drawers, next);
}

/**
 * Preview of one asset, drawn on first request and cached for the session. `token` names a
 * revision of the asset, so an edited file is drawn again instead of reusing the old image.
 */
function assetPreview(kind: PreviewKind, key: string, token?: string): Promise<string | null> {
  const cacheKey = `${kind}|${key}|${token ?? ''}`;
  const pending = requests.get(cacheKey);
  if (pending) return pending;
  const draw = drawers[kind];
  if (!draw) return Promise.resolve(null);
  const started = draw(key).catch(() => null);
  requests.set(cacheKey, started);
  return started;
}

/** Preview of one catalogue asset, starting the render the first time a row asks for it. */
export function useAssetPreview(kind: PreviewKind, key: string | null, token?: string): string | null {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    if (!key) return undefined;
    let cancelled = false;
    void assetPreview(kind, key, token).then(result => { if (!cancelled) setPreview(result); });
    return () => { cancelled = true; };
  }, [kind, key, token]);

  return preview;
}
