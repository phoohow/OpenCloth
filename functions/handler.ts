import { storage } from './_qoder/storage.mjs';

interface BundledAsset {
  objectPath: string;
  contentType: string;
}

const BUNDLED_ASSETS: Record<string, BundledAsset> = {
  'weights/rt_hdr.tza': { objectPath: 'weights/rt_hdr.tza', contentType: 'application/octet-stream' },
  'weights/rt_hdr_alb_nrm.tza': { objectPath: 'weights/rt_hdr_alb_nrm.tza', contentType: 'application/octet-stream' },
  'weights/rt_hdr_alb_nrm_small.tza': {
    objectPath: 'weights/rt_hdr_alb_nrm_small.tza',
    contentType: 'application/octet-stream',
  },
  'env/royal_esplanade_1k.hdr': { objectPath: 'env/royal_esplanade_1k.hdr', contentType: 'application/octet-stream' },
  'makehuman/body.bin': { objectPath: 'makehuman/body.bin', contentType: 'application/octet-stream' },
  'makehuman/targets.bin': { objectPath: 'makehuman/targets.bin', contentType: 'application/octet-stream' },
  'makehuman/manifest.json': {
    objectPath: 'makehuman/manifest.json',
    contentType: 'application/json; charset=utf-8',
  },
};

const BUNDLED_NOTES: Record<string, BundledAsset> = {
  'weights/ATTRIBUTION.md': { objectPath: 'weights/ATTRIBUTION.md', contentType: 'text/markdown; charset=utf-8' },
  'env/ATTRIBUTION.md': { objectPath: 'env/ATTRIBUTION.md', contentType: 'text/markdown; charset=utf-8' },
};

const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const ASSET_KEYS = [...Object.keys(BUNDLED_ASSETS), ...Object.keys(BUNDLED_NOTES)].sort();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function assetError(status: number, code: string): Response {
  return json({ error: code, ok: false }, status);
}

function assetFor(key: string): BundledAsset | null {
  return BUNDLED_ASSETS[key] ?? BUNDLED_NOTES[key] ?? null;
}

function assetKey(pathname: string): string | null {
  const marker = '/assets/';
  const start = pathname.indexOf(marker);
  if (start < 0) return null;
  const key = decodeURIComponent(pathname.slice(start + marker.length));
  return assetFor(key) ? key : null;
}

async function serveAsset(key: string, headOnly: boolean): Promise<Response> {
  const asset = assetFor(key);
  if (!asset) return assetError(404, 'route_not_found');
  try {
    const file = await storage.download(asset.objectPath);
    if (!file.ok || !file.body) return assetError(503, 'asset_unavailable');
    return new Response(headOnly ? null : file.body, {
      headers: { 'content-type': asset.contentType, 'cache-control': ASSET_CACHE_CONTROL },
    });
  } catch {
    return assetError(503, 'asset_unavailable');
  }
}

export async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return assetError(405, 'method_not_allowed');
  }

  const pathname = new URL(request.url).pathname;
  if (pathname.endsWith('/assets')) return json({ assets: ASSET_KEYS, ok: true });
  const key = assetKey(pathname);
  if (!key) return assetError(404, 'route_not_found');
  return serveAsset(key, request.method === 'HEAD');
}
