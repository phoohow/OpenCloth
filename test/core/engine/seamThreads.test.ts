import { describe, expect, it } from 'vitest';
import type * as THREE from 'three/webgpu';
import type { Seam } from '../../../src/core/model/types';
import type { SeamPair } from '../../../src/core/engine/mergedCloth';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const three = await import('three/webgpu');
const { SeamThreads } = await import('../../../src/core/engine/seamThreads');

/** The overlay's public methods plus its private line mesh, for reading drawn colors. */
interface Overlay {
  lines: THREE.LineSegments | null;
  attach(scene: THREE.Scene, pairs: SeamPair[], positions: Float32Array, seams: Record<string, Seam>): void;
  setSeams(seams: Record<string, Seam>): void;
  update(pairs: SeamPair[], positions: Float32Array): void;
  detach(scene: THREE.Scene): void;
}

const SEAMS: Record<string, Seam> = {
  s1: { id: 's1', type: 'normal', edgeAId: 'a', edgeBId: 'b', flipB: false, strength: 0.8, threadColor: '#ff0000', stitchVisible: true },
  s2: { id: 's2', type: 'normal', edgeAId: 'c', edgeBId: 'd', flipB: false, strength: 0.8, threadColor: '#00ff00', stitchVisible: false },
};

/** Two particles a metre apart; the second pair sits almost closed. */
const PAIRS: SeamPair[] = [
  { p0: 0, p1: 1, open: 0.5, seamId: 's1' },
  { p0: 2, p1: 3, open: 0.5, seamId: 's2' },
];
const POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.02, 1, 0]);

function colorsOf(overlay: Overlay): Float32Array {
  return (overlay.lines?.geometry.getAttribute('color').array ?? new Float32Array()) as Float32Array;
}

describe('SeamThreads', () => {
  it('tints each segment with its own seam thread color', () => {
    const scene = new three.Scene();
    const overlay = new SeamThreads() as unknown as Overlay;
    overlay.attach(scene, PAIRS, POSITIONS, SEAMS);
    const colors = colorsOf(overlay);
    const red = new three.Color('#ff0000');
    expect(colors[0]).toBeCloseTo(red.r, 5);
    expect(colors[1]).toBe(0);
    // A hidden seam draws nothing under additive blending.
    expect(Array.from(colors.slice(6, 12))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('hides and shows segments as stitch visibility changes', () => {
    const scene = new three.Scene();
    const overlay = new SeamThreads() as unknown as Overlay;
    overlay.attach(scene, PAIRS, POSITIONS, SEAMS);

    overlay.setSeams({ ...SEAMS, s1: { ...SEAMS.s1, stitchVisible: false } });
    overlay.update(PAIRS, POSITIONS);
    expect(Array.from(colorsOf(overlay).slice(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);

    overlay.setSeams({ ...SEAMS, s2: { ...SEAMS.s2, stitchVisible: true } });
    overlay.update(PAIRS, POSITIONS);
    // Nearly closed, so the thread is dimmed by its gap rather than switched off.
    const green = new three.Color('#00ff00');
    const colors = colorsOf(overlay);
    expect(colors[6]).toBe(0);
    expect(colors[7]).toBeGreaterThan(0);
    expect(colors[7]).toBeLessThan(green.g);
  });

  it('detaches the overlay and rebuilds one per attach', () => {
    const scene = new three.Scene();
    const overlay = new SeamThreads() as unknown as Overlay;
    overlay.attach(scene, PAIRS, POSITIONS, SEAMS);
    overlay.attach(scene, PAIRS, POSITIONS, SEAMS);
    expect(scene.children.filter(child => child.name === 'seamThreads')).toHaveLength(1);
    overlay.detach(scene);
    expect(scene.children.filter(child => child.name === 'seamThreads')).toHaveLength(0);
  });
});
