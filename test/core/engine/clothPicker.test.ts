import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { ClothPicker } from '../../../src/core/engine/clothPicker';
import { ParticleGrid, pickNearest, pickNearestToPoint } from '../../../src/sim/picking';
import type { RendererContext } from '../../../src/render/renderer/rendererContext';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const FRONT_COUNT = 9;
const PARTICLE_COUNT = 18;
const PANELS = ['front', 'back'];

/**
 * Two 3×3 grids one millimetre apart, like a front sheet lying on its lining. The back grid has
 * a particle exactly on the view axis; the front grid is offset so no front particle is.
 */
function surfaceParticles(): Float32Array {
  const out = new Float32Array(PARTICLE_COUNT * 3);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const front = (row * 3 + col) * 3;
      out[front] = -0.005 + col * 0.02;
      out[front + 1] = -0.005 + row * 0.02;
      out[front + 2] = 0.1;

      const back = (FRONT_COUNT + row * 3 + col) * 3;
      out[back] = -0.02 + col * 0.02;
      out[back + 1] = -0.02 + row * 0.02;
      out[back + 2] = 0.099;
    }
  }
  return out;
}

/** Triangle corner indices of a 3×3 grid, offset into the merged particle list. */
function gridTriangles(offset: number, out: number[]): void {
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const a = offset + row * 3 + col;
      out.push(a, a + 1, a + 3, a + 3, a + 1, a + 4);
    }
  }
}

/** Panel slot of each stacked-grid particle. */
const PARTICLE_PANEL_SLOT = Array.from({ length: PARTICLE_COUNT }, (_, i) => (i < FRONT_COUNT ? 0 : 1));

/** Particle index → panel slot. */
function particlePanelMap(): Uint32Array {
  return Uint32Array.from(PARTICLE_PANEL_SLOT);
}

/** Extra members a test can override on the picker's targets object. */
type ClothPickerTarget = ConstructorParameters<typeof ClothPicker>[1];

/** Camera at +Z looking down the axis at two sheets lying against each other. */
function stackedSheets(pickParticleAtPoint?: ClothPickerTarget['pickParticleAtPoint']): {
  picker: ClothPicker; positions: Float32Array;
} {
  const positions = surfaceParticles();
  const indices: number[] = [];
  gridTriangles(0, indices);
  gridTriangles(FRONT_COUNT, indices);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));

  const camera = new THREE.PerspectiveCamera(45, 1.33, 0.1, 100);
  camera.position.set(0, 0, 0.8);
  camera.updateMatrixWorld();
  const ctx = {
    scene: new THREE.Scene(), camera, perspectiveCamera: camera,
    projection: 'perspective', orthoViewHeight: 1,
    canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
  } as unknown as RendererContext;

  const grid = () => new ParticleGrid(positions, PARTICLE_COUNT);
  const picker = new ClothPicker(ctx, {
    mesh: () => mesh,
    // Two triangles per grid row, so the first eight belong to the front sheet.
    trianglePanelIds: () => indices.map((_, i) => PANELS[Math.floor(i / 24)]),
    triangleParticles: triangle => {
      const start = triangle * 3;
      return start >= 0 && start + 2 < indices.length ? [indices[start], indices[start + 1], indices[start + 2]] : null;
    },
    particlePositions: () => positions,
    panelIds: () => PANELS,
    pickNearestParticle: (origin, dir, radius) =>
      pickNearest(positions, grid(), particlePanelMap(), origin, dir, radius),
    pickParticleAtPoint: pickParticleAtPoint ?? ((point, radius, panelSlot) =>
      pickNearestToPoint(positions, grid(), particlePanelMap(), point, radius, panelSlot)),
    frameObjects: () => [mesh],
  });
  return { picker, positions };
}

describe('ClothPicker.pickClothParticleAtScreen', () => {
  it('keeps the pick on the sheet that was clicked', () => {
    const { picker, positions } = stackedSheets();
    const point = { x: 0, y: 0, z: 0.1 };

    // Ignoring the panel would hand the PIN to the lining particle a millimetre behind.
    const anyPanel = pickNearestToPoint(
      positions, new ParticleGrid(positions, PARTICLE_COUNT), particlePanelMap(), point, 0.02, -1,
    );
    expect(anyPanel).not.toBeNull();
    expect(anyPanel!.index).toBeGreaterThanOrEqual(FRONT_COUNT);

    const hit = picker.pickClothParticleAtScreen(0, 0, 0.03);
    expect(hit).not.toBeNull();
    expect(hit!.index).toBe(0);
    expect(hit!.panelIndex).toBe(0);
  });

  it('falls back to the clicked triangle corner without a solver pick', () => {
    const { picker } = stackedSheets(() => null);
    const hit = picker.pickClothParticleAtScreen(0, 0, 0.03);
    expect(hit!.index).toBe(0);
    expect(hit!.panelIndex).toBe(0);
  });

  it('returns null once the ray misses the cloth and every particle', () => {
    const { picker } = stackedSheets();
    expect(picker.pickClothParticleAtScreen(0.9, 0.9, 0.03)).toBeNull();
  });
});
