/** Site path prefixes of the assets bundled from `assets/`. */
const BUNDLED_PREFIXES = ['/models/', '/weights/', '/env/'];

/** Revision carried by Storage-backed asset URLs; bump when a bundled file changes. */
const BUNDLED_ASSET_REVISION = '1';

/** Function route that streams one bundled asset out of site Storage. */
export function storageAssetUrl(url: string): string {
  return `/functions/v1/app/assets${url}?v=${BUNDLED_ASSET_REVISION}`;
}

/** Resolves a site path for the given asset source; non-bundled URLs pass through. */
export function resolveBundledAssetUrl(url: string, fromStorage: boolean): string {
  if (!fromStorage || !BUNDLED_PREFIXES.some(prefix => url.startsWith(prefix))) return url;
  return storageAssetUrl(url);
}

/** Resolves the serving URL of a site path for the build this code came from. */
export function bundledAssetUrl(url: string): string {
  return resolveBundledAssetUrl(url, __BUNDLED_ASSETS_FROM_STORAGE__);
}
