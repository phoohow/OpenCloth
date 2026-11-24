import { describe, expect, it } from 'vitest';
import { resolveBundledAssetUrl, storageAssetUrl } from '../../src/base/platform/assetUrls';

describe('resolveBundledAssetUrl', () => {
  it('routes bundled directories through the site Function when assets come from Storage', () => {
    expect(resolveBundledAssetUrl('/env/royal_esplanade_1k.hdr', true))
      .toBe('/functions/v1/app/assets/env/royal_esplanade_1k.hdr?v=1');
    expect(resolveBundledAssetUrl('/weights/model_small.onnx', true))
      .toBe('/functions/v1/app/assets/weights/model_small.onnx?v=1');
    expect(resolveBundledAssetUrl('/makehuman/body.bin', true))
      .toBe('/functions/v1/app/assets/makehuman/body.bin?v=1');
  });

  it('keeps site paths untouched in dev builds', () => {
    expect(resolveBundledAssetUrl('/env/royal_esplanade_1k.hdr', false)).toBe('/env/royal_esplanade_1k.hdr');
  });

  it('passes paths outside the bundled directories through', () => {
    expect(resolveBundledAssetUrl('/models/avatar.glb', true)).toBe('/models/avatar.glb');
    expect(resolveBundledAssetUrl('blob:https://example.test/1', true)).toBe('blob:https://example.test/1');
    expect(resolveBundledAssetUrl('https://cdn.test/hdri.hdr', true)).toBe('https://cdn.test/hdri.hdr');
  });
});

describe('storageAssetUrl', () => {
  it('appends the asset revision the Function caches on', () => {
    expect(storageAssetUrl('/env/a.hdr')).toBe('/functions/v1/app/assets/env/a.hdr?v=1');
  });
});
