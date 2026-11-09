import { describe, expect, it } from 'vitest';
import { CHANNEL_ALL, CHANNEL_RASTER, type VersionStamp } from '@/render/common';
import { snapshotSignature } from '@/render/renderer/sceneBuilder';
import { defaultViewSettings, type RenderView } from '@/render/renderer/view/types';

/** One frame with neutral camera and settings. */
function view(patch: Partial<RenderView> = {}): RenderView {
  return {
    camera: {
      projection: 'perspective',
      position: { x: 0, y: 1.4, z: 3.2 },
      target: { x: 0, y: 0.9, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      fovDeg: 45,
      viewHeightMeters: 1,
      aspect: 1,
      near: 0.01,
      far: 100,
    },
    viewport: { width: 800, height: 600 },
    layers: ['underlay', 'subject', 'overlay', 'gizmo'],
    channels: CHANNEL_RASTER,
    settings: defaultViewSettings(),
    overrides: [],
    frame: 1,
    ...patch,
  };
}

/** Version stamp with every counter at zero. */
function versions(patch: Partial<VersionStamp> = {}): VersionStamp {
  return {
    topology: 0, geometry: 0, transform: 0, material: 0,
    visibility: 0, lights: 0, environment: 0,
    ...patch,
  };
}

describe('snapshotSignature', () => {
  it('ignores camera, viewport, frame and post settings', () => {
    const base = snapshotSignature(view(), versions(), 0);
    const moved = view({
      camera: { ...view().camera, position: { x: 1, y: 2, z: 3 } },
      viewport: { width: 1024, height: 768 },
      frame: 42,
      settings: { ...defaultViewSettings(), toneMapping: 'reinhard', exposure: 2 },
    });
    expect(snapshotSignature(moved, versions(), 0)).toBe(base);
  });

  it('changes with every world version counter', () => {
    const base = snapshotSignature(view(), versions(), 0);
    for (const key of Object.keys(versions()) as (keyof VersionStamp)[]) {
      expect(snapshotSignature(view(), versions({ [key]: 1 }), 0)).not.toBe(base);
    }
  });

  it('changes with the drawable view axes and the texture cache', () => {
    const base = snapshotSignature(view(), versions(), 0);
    const settings = defaultViewSettings();
    expect(snapshotSignature(view({ settings: { ...settings, fill: 'uvCheck' } }), versions(), 0)).not.toBe(base);
    expect(snapshotSignature(view({ settings: { ...settings, wire: 'over' } }), versions(), 0)).not.toBe(base);
    // The mode moves the wire between stages, so it has to rebuild the scene as well.
    expect(snapshotSignature(view({ settings: { ...settings, mode: 'pathtrace' } }), versions(), 0))
      .not.toBe(base);
    expect(snapshotSignature(
      view({ settings: { ...settings, wireOptions: { color: 0xff0000, depth: 'tested' } } }), versions(), 0,
    )).not.toBe(base);
    expect(snapshotSignature(view({ channels: CHANNEL_ALL }), versions(), 0)).not.toBe(base);
    expect(snapshotSignature(view({ layers: ['subject'] }), versions(), 0)).not.toBe(base);
    expect(snapshotSignature(view(), versions(), 1)).not.toBe(base);
  });

  it('tracks override content, not the array identity', () => {
    const override = {
      tags: ['subjectSurface'],
      technique: 'heatmap' as const,
      channels: CHANNEL_RASTER,
      stage: 'postTone' as const,
      mode: 'replace' as const,
      params: { heatmap: { palette: ['#000000', '#ffffff'], min: 0, max: 1 } },
    };
    const first = snapshotSignature(view({ overrides: [override] }), versions(), 0);
    const copy = JSON.parse(JSON.stringify(override)) as typeof override;
    expect(snapshotSignature(view({ overrides: [copy] }), versions(), 0)).toBe(first);
    copy.params.heatmap.max = 2;
    expect(snapshotSignature(view({ overrides: [copy] }), versions(), 0)).not.toBe(first);
  });
});