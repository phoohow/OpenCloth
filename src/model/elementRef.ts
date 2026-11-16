/** Selectable element kinds in the 2D drafting workspace. */
export type PatternElementKind = 'panel' | 'point' | 'edge' | 'internal' | 'dart' | 'seam' | 'notch' | 'annotation' | 'measurement' | 'print' | 'topstitch' | 'trim';

/** Every kind addressed with the `@kind:id` element encoding. */
export const PATTERN_ELEMENT_KINDS: PatternElementKind[] = ['panel', 'point', 'edge', 'internal', 'dart', 'seam', 'notch', 'annotation', 'measurement', 'print', 'topstitch', 'trim'];
/**
 * Untyped selection rows are opaque ids; element picks are encoded with a `@kind:`
 * prefix so the outliner, 3D overlay and mobile chips keep reading plain panel ids.
 */
export const elementNodeId = (kind: PatternElementKind, id: string): string => `@${kind}:${id}`;

/** Kind and object id of a prefixed selection row; null for plain scene ids. */
export function parseElementNodeId(nodeId: string): { kind: PatternElementKind; id: string } | null {
  const m = /^@(panel|point|edge|internal|dart|seam|notch|annotation|measurement|print|topstitch|trim):(.+)$/.exec(nodeId);
  return m ? { kind: m[1] as PatternElementKind, id: m[2] } : null;
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

