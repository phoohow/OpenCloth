import { describe, expect, it } from 'vitest';
import type { RenderConfig } from '@/model/types';
import { createDefaultRayTracing } from '@/model';
import { backendAvailable, resolveSpec } from '@/render/modes/spec';

/** Raster, physical fill, no overlay: the settings a fresh project starts with. */
function config(patch: Partial<RenderConfig> = {}): RenderConfig {
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

describe('resolveSpec', () => {
  it('always tone maps, traced or not', () => {
    expect(resolveSpec(config()).postProcess).toEqual(['toneMap']);
    expect(resolveSpec(config({ backend: 'pathtrace' })).postProcess).toEqual(['toneMap']);
  });

  it('keeps diagnostic colours out of the display curve', () => {
    for (const fill of ['uvCheck', 'normal', 'vertexNormal'] as const) {
      const spec = resolveSpec(config({ fill }));
      expect(spec.toneMapping).toBe('none');
      expect(spec.postProcess).toEqual(['toneMap']);
    }
    expect(resolveSpec(config({ fill: 'physical' })).toneMapping).toBe('aces');
  });

  it('does not denoise a raster frame', () => {
    const spec = resolveSpec(config());
    expect(spec.traces).toBe(false);
    expect(spec.denoises).toBe(false);
  });

  it('denoises traced samples before the compositor sees them', () => {
    const spec = resolveSpec(config({ backend: 'pathtrace' }));
    expect(spec.traces).toBe(true);
    expect(spec.denoises).toBe(true);
  });

  it('skips denoising when the project turns it off', () => {
    const spec = resolveSpec(config({
      backend: 'pathtrace',
      rayTracing: { ...createDefaultRayTracing(), denoise: false },
    }));
    expect(spec.traces).toBe(true);
    expect(spec.denoises).toBe(false);
  });

  it('never traces a wire-only frame, whatever the backend says', () => {
    const spec = resolveSpec(config({ backend: 'pathtrace', wire: 'only' }));
    expect(spec.traces).toBe(false);
    expect(spec.denoises).toBe(false);
    expect(spec.fillsSurface).toBe(false);
  });

  it('keeps the wire overlay out of the fill decision', () => {
    const spec = resolveSpec(config({ wire: 'over' }));
    expect(spec.fillsSurface).toBe(true);
    expect(spec.layers).toContain('overlay');
  });

  it('keeps the floor, the body and the overlays in every mode', () => {
    for (const fill of ['physical', 'uvCheck', 'normal', 'vertexNormal'] as const) {
      const spec = resolveSpec(config({ fill }));
      expect(spec.layers).toEqual(['underlay', 'subject', 'overlay', 'gizmo']);
    }
  });

  it('keeps the floor when a diagnostic fill draws edges only', () => {
    const spec = resolveSpec(config({ fill: 'normal', wire: 'only' }));
    expect(spec.layers).toContain('underlay');
    expect(spec.layers).toContain('overlay');
  });
});

describe('backendAvailable', () => {
  it('rejects the backend for a wire-only frame', () => {
    expect(backendAvailable('physical', 'only')).toBe(false);
  });

  it('rejects the backend for both normal fills', () => {
    expect(backendAvailable('normal', 'off')).toBe(false);
    expect(backendAvailable('vertexNormal', 'off')).toBe(false);
  });

  it('accepts the combinations the tracer can read', () => {
    expect(backendAvailable('physical', 'off')).toBe(true);
    expect(backendAvailable('uvCheck', 'over')).toBe(true);
  });
});
