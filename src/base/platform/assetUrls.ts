const BUNDLED_PREFIXES = ['/weights/', '/env/', '/makehuman/'];

const BUNDLED_ASSET_REVISION = '1';

export function storageAssetUrl(url: string): string {
  return `/functions/v1/app/assets${url}?v=${BUNDLED_ASSET_REVISION}`;
}

export function resolveBundledAssetUrl(url: string, fromStorage: boolean): string {
  if (!fromStorage || !BUNDLED_PREFIXES.some(prefix => url.startsWith(prefix))) return url;
  return storageAssetUrl(url);
}

export function bundledAssetUrl(url: string): string {
  return resolveBundledAssetUrl(url, __BUNDLED_ASSETS_FROM_STORAGE__);
}
