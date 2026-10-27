import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDLED_AVATARS } from '../../../src/core/model/defaults';
import { bundledAssetUrl, resolveBundledAssetUrl, storageAssetUrl } from '../../../src/core/assets/bundledAssetUrls';

/** Site paths of every asset bundled from `assets/`. */
const BUNDLED_PATHS = [
  '/models/human-body-f.glb',
  '/models/human-body-pro.glb',
  '/models/human-body.glb',
  '/weights/rt_hdr.tza',
  '/weights/rt_hdr_alb_nrm.tza',
  '/weights/rt_hdr_alb_nrm_small.tza',
  '/env/royal_esplanade_1k.hdr',
];

describe('bundled asset URL resolution', () => {
  it('routes each bundled prefix through the Storage-backed Function route', () => {
    expect(storageAssetUrl('/models/human-body-f.glb'))
      .toBe('/functions/v1/app/assets/models/human-body-f.glb?v=1');
    expect(storageAssetUrl('/weights/rt_hdr_alb_nrm.tza'))
      .toBe('/functions/v1/app/assets/weights/rt_hdr_alb_nrm.tza?v=1');
    expect(storageAssetUrl('/env/royal_esplanade_1k.hdr'))
      .toBe('/functions/v1/app/assets/env/royal_esplanade_1k.hdr?v=1');
  });

  it('rewrites only bundled prefixes when the Storage source is on', () => {
    expect(resolveBundledAssetUrl('/models/human-body-f.glb', true))
      .toBe('/functions/v1/app/assets/models/human-body-f.glb?v=1');
    expect(resolveBundledAssetUrl('/weights/rt_hdr_alb_nrm.tza', true))
      .toBe('/functions/v1/app/assets/weights/rt_hdr_alb_nrm.tza?v=1');
    expect(resolveBundledAssetUrl('/env/royal_esplanade_1k.hdr', true))
      .toBe('/functions/v1/app/assets/env/royal_esplanade_1k.hdr?v=1');
    expect(resolveBundledAssetUrl('/assets/index.js', true)).toBe('/assets/index.js');
    expect(resolveBundledAssetUrl('blob:https://example.com/upload', true))
      .toBe('blob:https://example.com/upload');
  });

  it('keeps every path on its site path when the Storage source is off', () => {
    expect(bundledAssetUrl('/models/human-body-f.glb')).toBe('/models/human-body-f.glb');
    expect(bundledAssetUrl('blob:https://example.com/upload')).toBe('blob:https://example.com/upload');
    expect(resolveBundledAssetUrl('/weights/rt_hdr.tza', false)).toBe('/weights/rt_hdr.tza');
  });

  it('serves every bundled path from the Function allowlist', () => {
    const handler = readFileSync(fileURLToPath(new URL('../../../functions/handler.ts', import.meta.url)), 'utf8');
    for (const path of BUNDLED_PATHS) {
      expect(handler).toContain(`'${path.slice(1)}': {`);
    }
  });

  it('lists every bundled avatar mesh in the Function allowlist', () => {
    const handler = readFileSync(fileURLToPath(new URL('../../../functions/handler.ts', import.meta.url)), 'utf8');
    for (const avatar of BUNDLED_AVATARS) {
      expect(handler).toContain(`'${avatar.url.slice(1)}': {`);
    }
  });
});
