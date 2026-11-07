import { describe, expect, it } from 'vitest';
import { TraceGate, cameraDistance, readCameraValues } from '@/render/trace/gate';
import { createRevisions } from '@/render/scene/revisions';

/** Camera snapshot with every entry offset by `delta`. */
function camera(delta = 0): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].map(value => value + delta);
}

describe('TraceGate', () => {
  it('always syncs before the first capture', () => {
    expect(new TraceGate().needsSync(createRevisions())).toBe(true);
  });

  it('restarts samples when the camera moves past the threshold', () => {
    const gate = new TraceGate();
    gate.observe(camera());
    gate.markSynced(createRevisions(), camera());

    expect(gate.observe(camera())).toEqual({ moving: false, restart: false });
    expect(gate.observe(camera(0.01))).toEqual({ moving: true, restart: true });
  });

  it('settles below the moving threshold and keeps the samples', () => {
    const gate = new TraceGate();
    gate.observe(camera());
    gate.markSynced(createRevisions(), camera());
    expect(gate.observe(camera(0.01)).moving).toBe(true);

    // While a burst is active the settle threshold is the tighter one.
    expect(gate.observe(camera(0.01005)).moving).toBe(false);
    // The snapshot still refers to the pre-move view until the capture catches up.
    gate.markCameraSynced(camera(0.01005));
    expect(gate.observe(camera(0.01006))).toEqual({ moving: false, restart: false });
  });

  it('requests a sync for every revision counter', () => {
    const revisions = createRevisions();
    const gate = new TraceGate();
    gate.markSynced(revisions, camera());

    for (const kind of ['topology', 'material', 'transform', 'visibility', 'groups', 'deform'] as const) {
      const changed = { ...revisions, [kind]: revisions[kind] + 1 };
      expect(gate.needsSync(changed)).toBe(true);
    }
    expect(gate.needsSync({ ...revisions })).toBe(false);
  });

  it('forgets the snapshot on reset', () => {
    const gate = new TraceGate();
    gate.markSynced(createRevisions(), camera());
    gate.reset();

    expect(gate.needsSync(createRevisions())).toBe(true);
  });

  it('records a camera-only update without resetting revisions', () => {
    const gate = new TraceGate();
    const revisions = createRevisions();
    gate.observe(camera(0.001));
    gate.markSynced(revisions, camera(0.001));
    gate.markCameraSynced(camera(0.001));

    expect(gate.observe(camera(0.001))).toEqual({ moving: false, restart: false });
    expect(gate.needsSync(revisions)).toBe(false);
  });
});

describe('camera snapshots', () => {
  it('treats no snapshot or a different length as an infinite distance', () => {
    expect(cameraDistance(null, camera())).toBe(Number.POSITIVE_INFINITY);
    expect(cameraDistance([1, 2], [1])).toBe(Number.POSITIVE_INFINITY);
    expect(cameraDistance(camera(), camera(0.5))).toBeCloseTo(0.5);
  });

  it('flattens the world and projection matrices', () => {
    const view = {
      matrixWorld: { elements: [1, 2, 3] },
      projectionMatrix: { elements: [4, 5] },
    };
    expect(readCameraValues(view)).toEqual([1, 2, 3, 4, 5]);
  });
});
