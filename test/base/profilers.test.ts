import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameProfiler } from '@/base/perf';

/** Controllable clock behind `performance.now`. */
const clock = { now: 0 };

/** Runs one frame with the given spans, advancing the clock by each body's cost. */
function frame(spans: Array<{ label: string; ms: number; nested?: { label: string; ms: number } }>, intervalMs: number): void {
  frameProfiler.beginFrame();
  for (const span of spans) {
    frameProfiler.begin(span.label);
    clock.now += span.ms;
    const nested = span.nested;
    if (nested) {
      frameProfiler.span(nested.label, () => { clock.now += nested.ms; });
    }
    frameProfiler.end();
  }
  frameProfiler.endFrame(intervalMs);
}

describe('base/perf frameProfiler', () => {
  afterEach(() => {
    frameProfiler.setEnabled(false);
    frameProfiler.reset();
    vi.restoreAllMocks();
  });

  it('collects nothing while sampling is off', () => {
    const fn = vi.fn(() => 7);
    expect(frameProfiler.span('idle', fn)).toBe(7);
    expect(fn).toHaveBeenCalledTimes(1);
    frameProfiler.beginFrame();
    frameProfiler.endFrame(16);
    expect(frameProfiler.snapshot()).toBeNull();
  });

  it('keeps nesting, start order and per-label statistics', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    frameProfiler.setEnabled(true);
    clock.now = 0;
    frameProfiler.beginFrame();
    frameProfiler.begin('parent');
    clock.now = 1;
    frameProfiler.span('child', () => { clock.now = 3; });
    clock.now = 5;
    frameProfiler.end();
    frameProfiler.endFrame(16);

    clock.now = 20;
    frameProfiler.beginFrame();
    frameProfiler.span('parent', () => { clock.now = 22; });
    frameProfiler.endFrame(20);

    const snapshot = frameProfiler.snapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.frames).toBe(2);
    expect(snapshot!.lastWorkMs).toBe(2);
    expect(snapshot!.lastIntervalMs).toBe(20);
    expect(snapshot!.avgWorkMs).toBe(3.5);
    expect(snapshot!.spans.map(span => span.label)).toEqual(['parent', 'child']);
    const parent = snapshot!.spans[0]!;
    expect(parent.depth).toBe(0);
    expect(parent.lastMs).toBe(2);
    expect(parent.avgMs).toBe(3.5);
    expect(parent.maxMs).toBe(5);
    expect(parent.samples).toBe(2);
    const child = snapshot!.spans[1]!;
    expect(child.depth).toBe(1);
    expect(child.lastMs).toBeNull();
    expect(child.avgMs).toBe(2);
  });

  it('drops the window when sampling is toggled or reset', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    frameProfiler.setEnabled(true);
    frame([{ label: 'a', ms: 3 }], 16);
    expect(frameProfiler.snapshot()!.frames).toBe(1);
    frameProfiler.reset();
    expect(frameProfiler.snapshot()).toBeNull();
    frame([{ label: 'a', ms: 3 }], 16);
    frameProfiler.setEnabled(false);
    frameProfiler.setEnabled(true);
    expect(frameProfiler.snapshot()).toBeNull();
  });
});
