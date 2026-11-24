import { describe, expect, it } from 'vitest';
import { buildPanelMesh, UV_TILE_CM } from '@/pattern/panel';
import { templatePattern } from '@/app';
import { DEFAULT_MESH_RESOLUTION_CM } from '@/model';

describe('版片 UV', () => {
  const pattern = templatePattern('tshirt');
  const meshes = Object.values(pattern.panels)
    .map(panel => buildPanelMesh(pattern, panel.id, DEFAULT_MESH_RESOLUTION_CM))
    .filter(mesh => mesh !== null);

  it('maps pattern centimetres onto the shared tile on both axes', () => {
    expect(meshes.length).toBeGreaterThan(1);
    for (const mesh of meshes) {
      for (let i = 0; i < mesh.vertexCount; i++) {
        expect(mesh.uvs[i * 2]! * UV_TILE_CM).toBeCloseTo(mesh.positions2D[i * 2]!, 3);
        expect(mesh.uvs[i * 2 + 1]! * UV_TILE_CM).toBeCloseTo(mesh.positions2D[i * 2 + 1]!, 3);
      }
    }
  });

  it('keeps one texel density across panels of different sizes', () => {
    const spans = meshes.map(mesh => {
      const xs = Array.from({ length: mesh.vertexCount }, (_, i) => mesh.positions2D[i * 2]!);
      const us = Array.from({ length: mesh.vertexCount }, (_, i) => mesh.uvs[i * 2]!);
      return { cm: Math.max(...xs) - Math.min(...xs), uv: Math.max(...us) - Math.min(...us) };
    });
    const ratios = spans.map(span => span.uv / Math.max(1e-6, span.cm));
    for (const ratio of ratios) expect(ratio).toBeCloseTo(1 / UV_TILE_CM, 6);
    expect(new Set(ratios.map(r => r.toFixed(6))).size).toBe(1);
  });
});
