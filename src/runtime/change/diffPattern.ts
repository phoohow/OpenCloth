import type { Pattern, Project } from '@/model/types';
import { changedPanels } from './buildSignatures';
import type { DiffTarget } from './diffTypes';
import { sameJson } from './sameJson';

/** Production object kinds that only draw on top of the cloth; prints feed the material instead. */
const PRODUCTION_FIELDS = ['topstitches', 'trims'] as const;

/** Panels whose mesh input changed, and the cloth concerns that follow from it. */
export function diffPattern(prev: Project, next: Project, out: DiffTarget): void {
  const { changed, removed } = changedPanels(prev, next);
  if (changed.length > 0 || removed.length > 0) {
    out.aspects.add('cloth.geometry');
    // Seam constraints are paired on merged vertices, so new geometry re-pairs them.
    out.aspects.add('cloth.constraints');
    for (const panelId of [...changed, ...removed]) out.panelIds.add(panelId);
  }
  if (!sameJson(seamPairs(prev.pattern), seamPairs(next.pattern))) out.aspects.add('cloth.constraints');
  if (fabricDiffers(prev, next)) out.aspects.add('cloth.fabric');
  if (markingDiffers(prev, next)) out.aspects.add('cloth.marking');
  collectPanelFlags(prev, next, out);
}

/** Seam fields the solver pairs and tensions; the drawn thread is not part of the constraint. */
function seamPairs(pattern: Pattern): unknown {
  return Object.values(pattern.seams ?? {}).map(seam => [
    seam.id, seam.type, seam.flip, seam.gatherRatio ?? null, seam.strength,
    seam.a.edgeId, seam.a.t0, seam.a.t1, seam.a.anchorT ?? null,
    seam.b.edgeId, seam.b.t0, seam.b.t1, seam.b.anchorT ?? null,
  ]);
}

/** Per-panel flags that change what is drawn or collided without changing the mesh. */
function collectPanelFlags(prev: Project, next: Project, out: DiffTarget): void {
  const before = prev.pattern.panels;
  const after = next.pattern.panels;
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[id];
    const b = after[id];
    if (!a || !b) continue;
    if (a.visible !== b.visible) {
      out.aspects.add('cloth.visibility');
      out.panelIds.add(id);
    }
    if (a.fabricId !== b.fabricId) {
      out.aspects.add('cloth.fabric');
      out.panelIds.add(id);
    }
    if (a.layer !== b.layer || a.collisionLayer !== b.collisionLayer) {
      out.aspects.add('cloth.layer');
      out.panelIds.add(id);
    }
  }
}

/** Material records and prints feed the cloth materials. */
function fabricDiffers(prev: Project, next: Project): boolean {
  return !sameJson(prev.fabrics, next.fabrics)
    || !sameJson(prev.pattern.prints ?? {}, next.pattern.prints ?? {});
}

/** Stitch, trim and drafting marks are drawn on top of the cloth without touching it. */
function markingDiffers(prev: Project, next: Project): boolean {
  if (!sameJson(seamMarks(prev.pattern), seamMarks(next.pattern))) return true;
  for (const field of PRODUCTION_FIELDS) {
    if (!sameJson(prev.pattern[field] ?? {}, next.pattern[field] ?? {})) return true;
  }
  return !sameJson(prev.pattern.notches ?? {}, next.pattern.notches ?? {})
    || !sameJson(prev.pattern.annotations ?? {}, next.pattern.annotations ?? {})
    || !sameJson(prev.pattern.measurements ?? {}, next.pattern.measurements ?? {});
}

/** Thread colour, viewport visibility and the row name live on the seam record itself. */
function seamMarks(pattern: Pattern): unknown {
  return Object.values(pattern.seams ?? {}).map(seam => [seam.id, seam.threadColor, seam.stitchVisible, seam.name]);
}
