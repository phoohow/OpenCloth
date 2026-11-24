import { useEffect, useState } from 'react';

const drawers: Partial<Record<PreviewKind, PreviewDrawer>> = {};

const requests = new Map<string, Promise<string | null>>();

type PreviewKind = 'model' | 'body' | 'environment' | 'pattern';

type PreviewDrawer = (key: string) => Promise<string | null>;

export function registerAssetPreviews(next: Partial<Record<PreviewKind, PreviewDrawer>>): void {
  Object.assign(drawers, next);
}

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
