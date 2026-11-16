import { describe, expect, it } from 'vitest';
import { FILE_TEMPLATES, templatePattern } from '@/pattern/template';
import { sampleEdge } from '@/pattern/panel';
import { buildPanelMesh, samplePanelOutline, type PanelMesh } from '@/pattern/panel/panelBuilder';
import type { Vec2 } from '@/model/types';

const pointOf = (mesh: PanelMesh, i: number): Vec2 => ({
  x: mesh.positions2D[i * 2]!,
  y: mesh.positions2D[i * 2 + 1]!,
});

function distanceToOutline(p: Vec2, outline: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
      ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
      : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

function edgeLengths(mesh: PanelMesh): number[] {
  const uses = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = mesh.indices[t + e]!, b = mesh.indices[t + ((e + 1) % 3)]!;
      uses.set(a < b ? `${a}_${b}` : `${b}_${a}`, 1);
    }
  }
  return [...uses.keys()].map(key => {
    const [a, b] = key.split('_').map(Number) as [number, number];
    const pa = pointOf(mesh, a), pb = pointOf(mesh, b);
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  }).sort((x, y) => x - y);
}

function smallestAngle(mesh: PanelMesh): number {
  let best = Math.PI;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = [0, 1, 2].map(k => pointOf(mesh, mesh.indices[t + k]!));
    for (let i = 0; i < 3; i++) {
      const at = tri[i]!, u = tri[(i + 1) % 3]!, v = tri[(i + 2) % 3]!;
      const ux = u.x - at.x, uy = u.y - at.y, vx = v.x - at.x, vy = v.y - at.y;
      const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
      best = Math.min(best, Math.acos(Math.max(-1, Math.min(1, cos))));
    }
  }
  return (best * 180) / Math.PI;
}

describe('版片网格质量', () => {
  const pattern = templatePattern('tshirt');
  const panel = Object.values(pattern.panels).find(p => p.name === '前片')!;

  for (const resolution of [2.5, 1.5]) {
    describe(`网格密度 ${resolution}cm`, () => {
      const mesh = buildPanelMesh(pattern, panel.id, resolution)!;

      it('边长集中，最长边不超过目标的一点五倍', () => {
        const lengths = edgeLengths(mesh);
        const median = lengths[Math.floor(lengths.length / 2)]!;
        expect(median).toBeGreaterThan(resolution * 0.7);
        expect(median).toBeLessThan(resolution * 1.1);
        expect(lengths[lengths.length - 1]!).toBeLessThanOrEqual(resolution * 1.5 + 1e-6);
      });

      it('三角形没有瘦成尖角', () => {
        expect(smallestAngle(mesh)).toBeGreaterThanOrEqual(20);
      });

      it('轮廓顶点留在缝线上', () => {
        const outline = samplePanelOutline(pattern, panel);
        for (const p of mesh.boundaryEdges.flatMap(([a]) => [a])) {
          expect(distanceToOutline(pointOf(mesh, p), outline)).toBeLessThan(1e-3);
        }
      });
    });
  }
});

describe('edge vertex runs', () => {
  // A seam stitches vertex run to vertex run, so a run that stops one mesh step short of a corner
  // leaves that last piece of the edge unstitched, and the two pieces open a notch there once the
  // garment is dressed. Every run therefore has to start and end on the edge's own endpoints.
  for (const template of FILE_TEMPLATES) {
    it(`covers both corners of every ${template.key} edge`, () => {
      const pattern = template.generate('fabric_default');
      for (const panel of Object.values(pattern.panels)) {
        const mesh = buildPanelMesh(pattern, panel.id);
        if (!mesh) continue;
        for (const edgeId of panel.outlineEdgeIds) {
          const run = mesh.edgeVertexMap.get(edgeId);
          const samples = sampleEdge(pattern, edgeId);
          if (!run || run.length === 0 || samples.length === 0) continue;
          const first = pointOf(mesh, run[0]!);
          const last = pointOf(mesh, run[run.length - 1]!);
          const start = samples[0]!;
          const end = samples[samples.length - 1]!;
          expect(Math.hypot(first.x - start.x, first.y - start.y), `${panel.name} ${edgeId} start`)
            .toBeLessThan(1e-3);
          expect(Math.hypot(last.x - end.x, last.y - end.y), `${panel.name} ${edgeId} end`)
            .toBeLessThan(1e-3);
        }
      }
    });
  }
});
