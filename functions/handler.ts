import { storage } from './_qoder/storage.mjs';

/** Storage object and response type served for one bundled asset. */
interface BundledAsset {
  objectPath: string;
  contentType: string;
}

/** Site paths of the bundled assets, mirrored as Storage object keys. */
const BUNDLED_ASSETS: Record<string, BundledAsset> = {
  'models/human-body-f.glb': { objectPath: 'models/human-body-f.glb', contentType: 'model/gltf-binary' },
  'models/human-body-pro.glb': { objectPath: 'models/human-body-pro.glb', contentType: 'model/gltf-binary' },
  'models/human-body.glb': { objectPath: 'models/human-body.glb', contentType: 'model/gltf-binary' },
  'weights/rt_hdr.tza': { objectPath: 'weights/rt_hdr.tza', contentType: 'application/octet-stream' },
  'weights/rt_hdr_alb_nrm.tza': { objectPath: 'weights/rt_hdr_alb_nrm.tza', contentType: 'application/octet-stream' },
  'weights/rt_hdr_alb_nrm_small.tza': {
    objectPath: 'weights/rt_hdr_alb_nrm_small.tza',
    contentType: 'application/octet-stream',
  },
  'env/royal_esplanade_1k.hdr': { objectPath: 'env/royal_esplanade_1k.hdr', contentType: 'application/octet-stream' },
};

/** Attribution notes served next to the assets they describe. */
const BUNDLED_NOTES: Record<string, BundledAsset> = {
  'models/ATTRIBUTION.md': { objectPath: 'models/ATTRIBUTION.md', contentType: 'text/markdown; charset=utf-8' },
  'weights/ATTRIBUTION.md': { objectPath: 'weights/ATTRIBUTION.md', contentType: 'text/markdown; charset=utf-8' },
  'env/ATTRIBUTION.md': { objectPath: 'env/ATTRIBUTION.md', contentType: 'text/markdown; charset=utf-8' },
};

/** Asset URLs carry a build revision, so responses can be cached forever. */
const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Served asset paths, for the manifest route. */
const ASSET_KEYS = [...Object.keys(BUNDLED_ASSETS), ...Object.keys(BUNDLED_NOTES)].sort();

/** Builds a JSON response. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Error responses stay generic so no provider detail reaches the browser. */
function assetError(status: number, code: string): Response {
  return json({ error: code, ok: false }, status);
}

/** Looks up an allowlisted asset by its site path. */
function assetFor(key: string): BundledAsset | null {
  return BUNDLED_ASSETS[key] ?? BUNDLED_NOTES[key] ?? null;
}

/** Resolves an allowlisted asset key from the request path suffix. */
function assetKey(pathname: string): string | null {
  const marker = '/assets/';
  const start = pathname.indexOf(marker);
  if (start < 0) return null;
  const key = decodeURIComponent(pathname.slice(start + marker.length));
  return assetFor(key) ? key : null;
}

/** Streams one allowlisted bundled asset from site Storage. */
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

/** Routes asset reads; every other path is a not-found. */
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
