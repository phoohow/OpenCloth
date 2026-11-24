export type PatternElementKind = 'panel' | 'point' | 'edge' | 'internal' | 'dart' | 'seam' | 'notch' | 'annotation' | 'measurement' | 'print' | 'topstitch' | 'trim';

export const elementNodeId = (kind: PatternElementKind, id: string): string => `@${kind}:${id}`;

export function parseElementNodeId(nodeId: string): { kind: PatternElementKind; id: string } | null {
  const m = /^@(panel|point|edge|internal|dart|seam|notch|annotation|measurement|print|topstitch|trim):(.+)$/.exec(nodeId);
  return m ? { kind: m[1] as PatternElementKind, id: m[2] } : null;
}

export function idsOfKind(selection: readonly string[], kind: PatternElementKind): string[] {
  const out: string[] = [];
  for (const row of selection) {
    const parsed = parseElementNodeId(row);
    if (parsed?.kind === kind) out.push(parsed.id);
    else if (kind === 'panel' && !parsed && !row.startsWith('@')) out.push(row);
  }

  return out;
}
