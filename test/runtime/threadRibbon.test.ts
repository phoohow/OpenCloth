import { describe, expect, it } from 'vitest';
import type { MeshData, MeshPatch } from '@/render/world';
import type { PresenterHost } from '@/runtime/world/presenters/host';
import {
  THREAD_FALLBACK_WIDTH_M, THREAD_MAX_WIDTH_M, THREAD_MIN_WIDTH_M, THREAD_PIXELS,
  ThreadRibbon, threadWidthMeters, type ThreadSegment,
} from '@/runtime/world/threadRibbon';
import type { SurfaceAnchor } from '@/runtime/engine/surfaceAnchor';

function anchorAt(particle: number): SurfaceAnchor {
  return { a: particle, b: particle, c: particle, wa: 1, wb: 0, wc: 0 };
}

function recordingHost(): { host: PresenterHost; mesh: () => MeshData } {
  const meshes = new Map<number, MeshData>();
  let nextId = 1;
  const writer = {
    createMesh: (desc: MeshData) => {
      const id = nextId++;
      meshes.set(id, desc);
      return id;
    },
    updateMesh: (id: number, patch: MeshPatch) => {
      const current = meshes.get(id);
      if (current) meshes.set(id, { ...current, ...patch, streams: { ...current.streams, ...patch.streams } });
    },
    createMaterial: () => nextId++,
    createEntity: () => nextId++,
    destroyMesh: (id: number) => meshes.delete(id),
    destroyMaterial: () => {},
    destroyEntity: () => {},
    updateEntity: () => {},
  };
  const host = {
    writer,
    bind: () => {},
    unbind: () => {},
  } as unknown as PresenterHost;
  return { host, mesh: () => [...meshes.values()].at(-1)! };
}

describe('thread ribbon', () => {
  it('builds a quad with the requested width for each segment', () => {
    const { host, mesh } = recordingHost();
    const segments: ThreadSegment[] = [{ a: anchorAt(0), b: anchorAt(1), color: '#d9a441' }];
    const positions = new Float32Array([0, 0, 0, 0.1, 0, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1]);

    new ThreadRibbon().attach(host, segments, positions, normals, 0.004, 'threads', 'threads');

    const data = mesh();
    expect(data.streams.position).toHaveLength(18);
    const corners = data.streams.position;
    const ys = [1, 4, 7, 10, 13, 16].map(index => corners[index]!);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.004, 6);
    expect(Math.max(...[2, 5, 8, 11, 14, 17].map(index => corners[index]!))).toBeCloseTo(0.0005, 6);
  });

  it('follows the particles when they move', () => {
    const { host, mesh } = recordingHost();
    const segments: ThreadSegment[] = [{ a: anchorAt(0), b: anchorAt(1), color: '#d9a441' }];
    const ribbon = new ThreadRibbon();
    ribbon.attach(
      host, segments, new Float32Array([0, 0, 0, 0.1, 0, 0]), new Float32Array(6), 0.004, 'threads', 'threads',
    );
    ribbon.update(new Float32Array([0, 0.2, 0, 0.1, 0.2, 0]), new Float32Array(6), 0.004);
    const corners = mesh().streams.position;
    expect(corners[1]).toBeCloseTo(0.2005, 6);
    expect(corners[4]).toBeCloseTo(0.2005, 6);
  });

  it('keeps the on-screen width inside the readable band', () => {
    expect(threadWidthMeters(0.001)).toBeCloseTo(0.001 * THREAD_PIXELS, 9);
    expect(threadWidthMeters(1e-6)).toBe(THREAD_MIN_WIDTH_M);
    expect(threadWidthMeters(1)).toBe(THREAD_MAX_WIDTH_M);
    expect(threadWidthMeters(0)).toBe(THREAD_FALLBACK_WIDTH_M);
    expect(threadWidthMeters(Number.NaN)).toBe(THREAD_FALLBACK_WIDTH_M);
  });
});
