import { describe, expect, it } from 'vitest';
import { TraceGate, cameraDistance, readCameraValues } from '@/render/backend/trace/traceGate';

/** Camera snapshot with every entry offset by `delta`. */
function camera(delta = 0): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].map(value => value + delta);
}

describe('TraceGate', () => {
  it('restarts before the first capture', () => {
    expect(new TraceGate().observe(camera())).toEqual({ moving: true, restart: true });
  });

  it('restarts samples when the camera moves past the threshold', () => {
    const gate = new TraceGate();
    gate.observe(camera());
    gate.markSynced(camera());

    expect(gate.observe(camera())).toEqual({ moving: false, restart: false });
    expect(gate.observe(camera(0.01))).toEqual({ moving: true, restart: true });
  });

  it('settles below the moving threshold and keeps the samples', () => {
    const gate = new TraceGate();
    gate.observe(camera());
    gate.markSynced(camera());
    expect(gate.observe(camera(0.01)).moving).toBe(true);

    // While a burst is active the settle threshold is the tighter one.
    expect(gate.observe(camera(0.01005)).moving).toBe(false);
    // The snapshot still refers to the pre-move view until the capture catches up.
    gate.markSynced(camera(0.01005));
    expect(gate.observe(camera(0.01006))).toEqual({ moving: false, restart: false });
  });

  it('restarts once when the interaction ends, even below the move tolerance', () => {
    const gate = new TraceGate();
    gate.observe(camera());
    gate.markSynced(camera());
    expect(gate.observe(camera(0.01)).moving).toBe(true);

    // The burst stops just short of the restart tolerance, but the samples were discarded during
    // it, so the tracer still has to take the camera it stopped at.
    expect(gate.observe(camera(0.01005))).toEqual({ moving: false, restart: true });
    gate.markSynced(camera(0.01005));
    expect(gate.observe(camera(0.01006))).toEqual({ moving: false, restart: false });
  });

  it('forgets the snapshot on reset', () => {
    const gate = new TraceGate();
    gate.markSynced(camera());
    gate.reset();

    expect(gate.observe(camera())).toEqual({ moving: true, restart: true });
  });});

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
