import { beforeEach, describe, expect, it, vi } from 'vitest';

type PerfModule = typeof import('../../src/store/perfStore');

async function freshPerfStore(): Promise<PerfModule> {
  vi.resetModules();
  return await import('../../src/store/perfStore');
}

describe('fpsFrom', () => {
  it('converts a frame count and a window into frames per second', async () => {
    const { fpsFrom } = await freshPerfStore();
    expect(fpsFrom(30, 500)).toBe(60);
    expect(fpsFrom(15, 1000)).toBe(15);
  });

  it('rounds to the nearest whole frame rate', async () => {
    const { fpsFrom } = await freshPerfStore();
    expect(fpsFrom(7, 300)).toBe(23);
    expect(fpsFrom(1, 3000)).toBe(0);
  });

  it('reads an empty window as zero', async () => {
    const { fpsFrom } = await freshPerfStore();
    expect(fpsFrom(0, 500)).toBe(0);
    expect(fpsFrom(4, 0)).toBe(0);
  });
});

describe('frame rate sampling', () => {
  let perf: PerfModule;

  beforeEach(async () => {
    perf = await freshPerfStore();
  });

  const read = () => perf.usePerfStore.getState().fps;
  const noteDrawnFrame = (pane: '2d' | '3d', now: number) => perf.noteDrawnFrame(pane, now);
  const sampleFps = (now: number) => perf.usePerfStore.getState().sampleFps(now);

  it('holds the previous rate until the sampling window closes', () => {
    noteDrawnFrame('3d', 1000);
    for (let i = 1; i < 20; i++) noteDrawnFrame('3d', 1000 + i * 20);
    sampleFps(1380);
    expect(read()).toEqual({ '2d': 0, '3d': 0 });

    sampleFps(1500);
    expect(read()['3d']).toBe(40);
  });

  it('counts each pane on its own', () => {
    for (let i = 0; i < 10; i++) noteDrawnFrame('3d', 1000 + i * 40);
    for (let i = 0; i < 3; i++) noteDrawnFrame('2d', 1000 + i * 100);
    sampleFps(1500);
    expect(read()).toEqual({ '2d': 6, '3d': 20 });
  });

  it('returns a pane to zero once it stops drawing', () => {
    for (let i = 0; i < 10; i++) noteDrawnFrame('2d', 1000 + i * 40);
    sampleFps(1500);
    expect(read()['2d']).toBe(20);

    sampleFps(2100);
    expect(read()['2d']).toBe(0);
  });

  it('leaves the store alone when the rate is unchanged', () => {
    noteDrawnFrame('3d', 1000);
    sampleFps(1500);
    const changes: number[] = [];
    perf.usePerfStore.subscribe(() => changes.push(1));
    noteDrawnFrame('3d', 1600);
    sampleFps(2000);
    expect(read()['3d']).toBe(2);
    expect(changes).toHaveLength(0);
  });
});

describe('sample count publishing', () => {
  let perf: PerfModule;

  beforeEach(async () => {
    perf = await freshPerfStore();
  });

  const readSamples = () => perf.usePerfStore.getState().samples3D;
  const readCost = () => perf.usePerfStore.getState().costMs3D;
  const noteDrawnFrame = (pane: '2d' | '3d', now: number) => perf.noteDrawnFrame(pane, now);
  const sampleFps = (now: number) => perf.usePerfStore.getState().sampleFps(now);
  const noteSamples = (count: number, now: number, accumulating = true) =>
    perf.noteRayTracingSamples(count, accumulating, now);

  it('starts at zero and publishes the latest count when the window closes', () => {
    expect(readSamples()).toBe(0);

    noteSamples(12, 900);
    sampleFps(1000);
    expect(readSamples()).toBe(0);

    noteDrawnFrame('3d', 1000);
    sampleFps(1500);
    expect(readSamples()).toBe(12);

    noteSamples(37, 2000);
    noteDrawnFrame('3d', 2000);
    sampleFps(2500);
    expect(readSamples()).toBe(37);
  });

  it('drops back to zero when the view stops reporting samples', () => {
    noteDrawnFrame('3d', 1000);
    noteSamples(8, 1400);
    sampleFps(1500);
    expect(readSamples()).toBe(8);

    noteSamples(0, 2000, false);
    noteDrawnFrame('3d', 2000);
    sampleFps(2500);
    expect(readSamples()).toBe(0);
  });

  it('runs the cost from the first sample of a pass to the frame it finishes', () => {
    noteDrawnFrame('3d', 1000);
    noteSamples(4, 1100);
    sampleFps(1500);
    expect(readCost()).toBe(400);

    noteDrawnFrame('3d', 1540);
    noteSamples(8, 1500);
    sampleFps(1600);
    expect(readCost()).toBe(400);

    noteSamples(8, 2000);
    noteDrawnFrame('3d', 2040);
    sampleFps(2500);
    expect(readCost()).toBe(1400);

    noteSamples(8, 2400, false);
    noteDrawnFrame('3d', 2540);
    sampleFps(3000);
    expect(readCost()).toBe(1300);

    noteSamples(8, 3100, false);
    noteDrawnFrame('3d', 3140);
    sampleFps(3600);
    expect(readCost()).toBe(1300);

    noteSamples(0, 9200, false);
    noteDrawnFrame('3d', 9240);
    sampleFps(9740);
    expect(readCost()).toBe(0);

    noteSamples(3, 10100);
    noteDrawnFrame('3d', 10140);
    sampleFps(10700);
    expect(readCost()).toBe(600);
  });
});
