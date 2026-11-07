import { describe, expect, it } from 'vitest';
import type { ViewConfig } from '@/model/types';
import { createDefaultRayTracing } from '@/model';
import { resolveViewMode } from '@/render/modes/spec';

/** Raster, physical fill, no overlay: the settings a fresh project starts with. */
function config(patch: Partial<ViewConfig> = {}): ViewConfig {
  return {
    fill: 'physical',
    wire: 'off',
    backend: 'raster',
    wireOptions: { color: 0x66ccff, depth: 'tested' },
    toneMapping: 'aces',
    rayTracing: createDefaultRayTracing(),
    ...patch,
  };
}

describe('resolveViewMode', () => {
  it('always tone maps, traced or not', () => {
    expect(resolveViewMode(config()).postProcess).toEqual(['toneMap']);
    expect(resolveViewMode(config({ backend: 'pathtrace' })).postProcess).toEqual(['toneMap']);
  });

  it('keeps diagnostic colours out of the display curve', () => {
    for (const fill of ['uvCheck', 'normal', 'vertexNormal'] as const) {
      const spec = resolveViewMode(config({ fill }));
      expect(spec.toneMapping).toBe('none');
      expect(spec.postProcess).toEqual(['toneMap']);
    }
    expect(resolveViewMode(config({ fill: 'physical' })).toneMapping).toBe('aces');
  });

  it('does not denoise a raster frame', () => {
    const spec = resolveViewMode(config());
    expect(spec.traces).toBe(false);
    expect(spec.denoises).toBe(false);
  });

  it('denoises traced samples before the compositor sees them', () => {
    const spec = resolveViewMode(config({ backend: 'pathtrace' }));
    expect(spec.traces).toBe(true);
    expect(spec.denoises).toBe(true);
  });

  it('skips denoising when the project turns it off', () => {
    const spec = resolveViewMode(config({
      backend: 'pathtrace',
      rayTracing: { ...createDefaultRayTracing(), denoise: false },
    }));
    expect(spec.traces).toBe(true);
    expect(spec.denoises).toBe(false);
  });

  it('never traces a wire-only frame, whatever the backend says', () => {
    const spec = resolveViewMode(config({ backend: 'pathtrace', wire: 'only' }));
    expect(spec.traces).toBe(false);
    expect(spec.denoises).toBe(false);
    expect(spec.fillsSurface).toBe(false);
  });

  it('keeps the wire overlay out of the fill decision', () => {
    const spec = resolveViewMode(config({ wire: 'over' }));
    expect(spec.fillsSurface).toBe(true);
    expect(spec.layers).toContain('overlay');
  });

  it('keeps the floor, the body and the overlays in every mode', () => {
    for (const fill of ['physical', 'uvCheck', 'normal', 'vertexNormal'] as const) {
      const spec = resolveViewMode(config({ fill }));
      expect(spec.layers).toEqual(['underlay', 'subject', 'overlay', 'gizmo']);
    }
  });

  it('keeps the floor when a diagnostic fill draws edges only', () => {
    const spec = resolveViewMode(config({ fill: 'normal', wire: 'only' }));
    expect(spec.layers).toContain('underlay');
    expect(spec.layers).toContain('overlay');
  });
});
