import type { Pattern, Project } from '@/model/types';
import type { DiffTarget } from '@/runtime/diff/diffTypes';

import { layerThicknessCm } from '@/model';
import { sameJson } from '@/runtime/diff/sameJson';
import { changedPanels } from '@/runtime/engine/buildSignatures';

const PRODUCTION_FIELDS = ['topstitches', 'trims', 'internalLines'] as const;

export function diffPattern(prev: Project, next: Project, out: DiffTarget): void {
  const { changed, removed } = changedPanels(prev, next);
  if (changed.length > 0 || removed.length > 0) {
    out.aspects.add('cloth.geometry');
    out.aspects.add('cloth.constraints');
    for (const panelId of [...changed, ...removed]) out.panelIds.add(panelId);
  }

  if (!sameJson(seamPairs(prev.pattern), seamPairs(next.pattern))) out.aspects.add('cloth.constraints');
  if (fabricDiffers(prev, next)) out.aspects.add('cloth.fabric');
  if (markingDiffers(prev, next)) out.aspects.add('cloth.marking');
  if (!sameJson(layerThicknessCm(prev), layerThicknessCm(next))) out.aspects.add('cloth.layer');
  collectPanelFlags(prev, next, out);
}

function seamPairs(pattern: Pattern): unknown {
  return Object.values(pattern.seams ?? {}).map(seam => [
    seam.id, seam.type, seam.flip, seam.gatherRatio ?? null, seam.strength,
    seam.a.edgeId, seam.a.t0, seam.a.t1, seam.a.anchorT ?? null,
    seam.b.edgeId, seam.b.t0, seam.b.t1, seam.b.anchorT ?? null,
  ]);
}

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

function fabricDiffers(prev: Project, next: Project): boolean {
  return !sameJson(prev.fabrics, next.fabrics)
    || !sameJson(prev.pattern.prints ?? {}, next.pattern.prints ?? {});
}

function markingDiffers(prev: Project, next: Project): boolean {
  if (!sameJson(seamMarks(prev.pattern), seamMarks(next.pattern))) return true;
  for (const field of PRODUCTION_FIELDS) {
    if (!sameJson(prev.pattern[field] ?? {}, next.pattern[field] ?? {})) return true;
  }

  return !sameJson(prev.pattern.notches ?? {}, next.pattern.notches ?? {})
    || !sameJson(prev.pattern.annotations ?? {}, next.pattern.annotations ?? {})
    || !sameJson(prev.pattern.measurements ?? {}, next.pattern.measurements ?? {});
}

function seamMarks(pattern: Pattern): unknown {
  return Object.values(pattern.seams ?? {}).map(seam => [seam.id, seam.threadColor, seam.stitchVisible, seam.name]);
}
