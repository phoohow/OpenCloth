import type { Pattern } from './types';

/** Selectable element kinds in the 2D drafting workspace. */
export type PatternElementKind = 'panel' | 'point' | 'edge' | 'internal' | 'dart' | 'seam' | 'notch' | 'annotation' | 'measurement';

/** Every kind addressed with the `@kind:id` element encoding. */
export const PATTERN_ELEMENT_KINDS: PatternElementKind[] = ['panel', 'point', 'edge', 'internal', 'dart', 'seam', 'notch', 'annotation', 'measurement'];
/**
 * Untyped selection rows are opaque ids; element picks are encoded with a `@kind:`
 * prefix so the outliner, 3D overlay and mobile chips keep reading plain panel ids.
 */
export const elementNodeId = (kind: PatternElementKind, id: string): string => `@${kind}:${id}`;

/** Kind and object id of a prefixed selection row; null for plain scene ids. */
export function parseElementNodeId(nodeId: string): { kind: PatternElementKind; id: string } | null {
  const m = /^@(panel|point|edge|internal|dart|seam|notch|annotation|measurement):(.+)$/.exec(nodeId);
  return m ? { kind: m[1] as PatternElementKind, id: m[2] } : null;
}

/** Whether a row addresses an element rather than a plain scene object. */
export function isElementNodeId(nodeId: string): boolean {
  return parseElementNodeId(nodeId) !== null;
}

/** Row addresses one of the given kinds. */
export function isKind(nodeId: string, kind: PatternElementKind): boolean {
  return parseElementNodeId(nodeId)?.kind === kind;
}

/** Selection rows of one kind, unwrapped to object ids. */
export function idsOfKind(selection: readonly string[], kind: PatternElementKind): string[] {
  const out: string[] = [];
  for (const row of selection) {
    const parsed = parseElementNodeId(row);
    if (parsed?.kind === kind) out.push(parsed.id);
    else if (kind === 'panel' && !parsed && !row.startsWith('@')) out.push(row);
  }
  return out;
}

/**
 * Panel ids touched by the selection: direct picks plus the owning panels of the
 * selected points, edges and pattern objects.
 */
export function affectedPanelIds(pattern: Pattern, selection: readonly string[]): string[] {
  const panels = new Set(idsOfKind(selection, 'panel'));
  for (const edgeId of idsOfKind(selection, 'edge')) {
    for (const panel of Object.values(pattern.panels)) {
      if (panel.outlineEdgeIds.includes(edgeId) || (panel.holes ?? []).some(l => l.includes(edgeId))) panels.add(panel.id);
    }
  }
  for (const pointId of idsOfKind(selection, 'point')) {
    for (const panel of Object.values(pattern.panels)) {
      if (panel.outlineEdgeIds.some(eid => {
        const e = pattern.edges[eid];
        return e && (e.startPointId === pointId || e.endPointId === pointId);
      })) panels.add(panel.id);
    }
  }
  for (const seamId of idsOfKind(selection, 'seam')) {
    const seam = pattern.seams[seamId];
    if (!seam) continue;
    for (const end of [seam.a, seam.b]) {
      for (const panel of Object.values(pattern.panels)) {
        if (panel.outlineEdgeIds.includes(end.edgeId)) panels.add(panel.id);
      }
    }
  }
  for (const lineId of idsOfKind(selection, 'internal')) {
    for (const panel of Object.values(pattern.panels)) {
      if (panel.internalLineIds.includes(lineId)) panels.add(panel.id);
    }
  }
  for (const dartId of idsOfKind(selection, 'dart')) {
    for (const panel of Object.values(pattern.panels)) {
      if (panel.dartIds.includes(dartId)) panels.add(panel.id);
    }
  }
  return [...panels];
}
