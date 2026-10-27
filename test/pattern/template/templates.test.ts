import { describe, it, expect } from 'vitest';
import type { Pattern, Seam } from '../../../src/core/model/types';
import { buildPanelMesh, samplePanelOutline, type PanelMesh } from '../../../src/pattern/panel/panelBuilder';
import { computeBBox } from '../../../src/pattern/geom/vec2';
import { bodyLandmarks } from '../../../src/avatar/landmarks';
import { drapePositions, resolveDrape } from '../../../src/pattern/drape/drapePlacement';
import { createStarterProject, GARMENT_TEMPLATES } from '../../../src/pattern/template/index';

const AVATAR = { heightCm: 170, chestCm: 92, waistCm: 74, hipCm: 96, poseArmAngleRad: 0.12 };

/** Mesh and wrapped positions of one panel; the wrapped array is panel-local. */
interface Placed {
  mesh: PanelMesh;
  pos: Float32Array;
}

function placePanels(pattern: Pattern): Map<string, Placed> {
  const body = bodyLandmarks(AVATAR);
  const placed = new Map<string, Placed>();
  for (const panel of Object.values(pattern.panels)) {
    const mesh = buildPanelMesh(pattern, panel.id);
    expect(mesh, `${panel.name} 网格`).not.toBeNull();
    if (!mesh) continue;
    placed.set(panel.id, { mesh, pos: drapePositions(mesh, panel, body) });
  }
  return placed;
}

/** Panel boundary vertices an edge contributes, with that panel's wrapped positions. */
function edgeSide(placed: Map<string, Placed>, edgeId: string): { pos: Float32Array; verts: number[] } | null {
  for (const entry of placed.values()) {
    const verts = entry.mesh.edgeVertexMap.get(edgeId);
    if (verts) return { pos: entry.pos, verts };
  }
  return null;
}

/** Mean distance between the particles a seam joins, in centimeters. */
function seamLength(seam: Seam, placed: Map<string, Placed>, flip = seam.flipB): number {
  const a = edgeSide(placed, seam.edgeAId);
  const b = edgeSide(placed, seam.edgeBId);
  if (!a || !b) return Infinity;
  const vertsB = flip ? [...b.verts].reverse() : b.verts;
  const n = Math.max(a.verts.length, vertsB.length);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const ia = a.verts[Math.min(Math.floor((i * a.verts.length) / n), a.verts.length - 1)];
    const ib = vertsB[Math.min(Math.floor((i * vertsB.length) / n), vertsB.length - 1)];
    const dx = (a.pos[ia * 3] - b.pos[ib * 3]) * 100;
    const dy = (a.pos[ia * 3 + 1] - b.pos[ib * 3 + 1]) * 100;
    const dz = (a.pos[ia * 3 + 2] - b.pos[ib * 3 + 2]) * 100;
    total += Math.hypot(dx, dy, dz);
  }
  return total / n;
}

describe('版型模板结构', () => {
  for (const template of GARMENT_TEMPLATES) {
    describe(template.name, () => {
      const pattern = template.generate(template.defaults, 'fabric_test');

      it('每片轮廓闭合', () => {
        for (const panel of Object.values(pattern.panels)) {
          const ids = panel.outlineEdgeIds;
          expect(ids.length, panel.name).toBeGreaterThan(2);
          for (let i = 0; i < ids.length; i++) {
            const edge = pattern.edges[ids[i]];
            const next = pattern.edges[ids[(i + 1) % ids.length]];
            expect(edge, `${panel.name} 缺边`).toBeDefined();
            expect(next, `${panel.name} 缺边`).toBeDefined();
            if (!edge || !next) continue;
            expect(edge.endPointId, `${panel.name} 边序`).toBe(next.startPointId);
          }
        }
      });

      it('缝合引用存在的边', () => {
        for (const seam of Object.values(pattern.seams) as Seam[]) {
          expect(pattern.edges[seam.edgeAId], seam.id).toBeDefined();
          expect(pattern.edges[seam.edgeBId], seam.id).toBeDefined();
        }
      });

      it('排料互不重叠且水平居中', () => {
        const boxes = Object.values(pattern.panels).map(panel => computeBBox(samplePanelOutline(pattern, panel)));
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
            const overlapY = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
            expect(overlapX > 0.01 && overlapY > 0.01, `第 ${i}/${j} 片重叠`).toBe(false);
          }
        }
        const left = Math.min(...boxes.map(b => b.min.x));
        const right = Math.max(...boxes.map(b => b.max.x));
        expect(left + right).toBeCloseTo(0, 3);
      });

      it('缝合方向配对正确', () => {
        const placed = placePanels(pattern);
        for (const seam of Object.values(pattern.seams) as Seam[]) {
          if (seam.type === 'gather') continue;
          const chosen = seamLength(seam, placed);
          const flipped = seamLength(seam, placed, !seam.flipB);
          const name = pattern.panels[panelIdOfEdge(pattern, seam.edgeAId)].name;
          expect(chosen, `${name} 缝合跨越 ${chosen.toFixed(1)}cm`).toBeLessThanOrEqual(flipped + 1);
        }
      });

      it('跨片缝合距离合理', () => {
        const placed = placePanels(pattern);
        for (const seam of Object.values(pattern.seams) as Seam[]) {
          if (seam.type === 'gather') continue;
          const a = panelIdOfEdge(pattern, seam.edgeAId);
          const b = panelIdOfEdge(pattern, seam.edgeBId);
          if (a === b) continue;
          // The wrapped pose is a dressing target, not an exact fit: the seam stage closes what is left.
          expect(seamLength(seam, placed), `${pattern.panels[a].name} 与 ${pattern.panels[b].name}`).toBeLessThan(20);
        }
      });
    });
  }
});

function panelIdOfEdge(pattern: Pattern, edgeId: string): string {
  for (const panel of Object.values(pattern.panels)) {
    if (panel.outlineEdgeIds.includes(edgeId)) return panel.id;
  }
  return '';
}

describe('starter project garment', () => {
  it('opens with a T-shirt pattern that drapes onto the body', () => {
    const project = createStarterProject();
    const panels = Object.values(project.pattern.panels);
    expect(panels.length).toBeGreaterThan(0);
    expect(project.fabrics[panels[0].fabricId]).toBeDefined();
    for (const panel of panels) {
      expect(resolveDrape(panel).region).toBeTruthy();
      expect(buildPanelMesh(project.pattern, panel.id)?.vertexCount).toBeGreaterThan(0);
    }
  });
});
