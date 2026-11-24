import { describe, expect, it } from 'vitest';
import { COMPLIANCE_REFERENCE_AREA_M2, meshDensitySubsteps } from '@/sim/common';
import type { TriangleMesh } from '@/pattern/triangulate';

function grid(edgeCm: number): TriangleMesh {
  const n = Math.round(10 / edgeCm);
  const positions = new Float32Array((n + 1) * (n + 1) * 2);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i;
      positions[k * 2] = i * edgeCm;
      positions[k * 2 + 1] = j * edgeCm;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  return {
    positions, indices: new Uint32Array(indices),
    vertexCount: (n + 1) * (n + 1), triangleCount: indices.length / 3,
  };
}

describe('meshDensitySubsteps', () => {
  it('adds no substeps at the reference resolution or coarser', () => {
    for (const edge of [1, 2, 5]) {
      expect(Math.round(4 * meshDensitySubsteps([{ mesh: grid(edge) }]))).toBe(4);
    }
  });

  it('doubles the substeps on a 0.5 cm mesh', () => {
    expect(Math.round(4 * meshDensitySubsteps([{ mesh: grid(0.5) }]))).toBe(8);
  });

  it('never asks for more than double', () => {
    expect(meshDensitySubsteps([{ mesh: grid(0.25) }])).toBe(2);
  });

  it('follows the finest panel in the scene', () => {
    expect(meshDensitySubsteps([{ mesh: grid(2) }, { mesh: grid(0.5) }])).toBeCloseTo(2, 5);
  });

  it('ignores panels without area', () => {
    const empty: TriangleMesh = {
      positions: new Float32Array(0), indices: new Uint32Array(0), vertexCount: 0, triangleCount: 0,
    };
    expect(meshDensitySubsteps([{ mesh: empty }])).toBe(1);
    expect(meshDensitySubsteps([])).toBe(1);
  });

  it('keeps the reference at one square centimetre per particle', () => {
    expect(COMPLIANCE_REFERENCE_AREA_M2).toBeCloseTo(1e-4, 12);
  });
});
