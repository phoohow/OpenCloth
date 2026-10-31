import type { Pattern, Seam } from '../../core/model/types';
import { seamInterval, type PatternIssue } from '../../core/model/validatePattern';
import { edgeIntervalLength } from '../geom/edgeSample';

/** Length differences past both tolerances earn a hint; easing below them stays silent. */
const LENGTH_DIFF_CM = 0.3;
const LENGTH_DIFF_RATIO = 0.02;

/** One seam side together with the arc-length span it joins over. */
interface SeamSide {
  edgeId: string;
  t0: number;
  t1: number;
}

/** Unordered key of two ids, so a pairing matches whichever side came first. */
function pairKey(x: string, y: string): string {
  return x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`;
}

/** True when the two spans along one edge share more than an endpoint. */
function spansOverlap(a: SeamSide, b: SeamSide): boolean {
  return Math.min(a.t1, b.t1) > Math.max(a.t0, b.t0);
}

/** Resolves a seam's two sides; null while an edge reference is missing. */
function seamSides(pattern: Pattern, seam: Seam): { a: SeamSide; b: SeamSide } | null {
  const a = seam.a;
  const b = seam.b;
  if (!a || !b || !pattern.edges[a.edgeId] || !pattern.edges[b.edgeId]) return null;
  const [ta0, ta1] = seamInterval(seam, 'a');
  const [tb0, tb1] = seamInterval(seam, 'b');
  return { a: { edgeId: a.edgeId, t0: ta0, t1: ta1 }, b: { edgeId: b.edgeId, t0: tb0, t1: tb1 } };
}

/**
 * Hints at a seam whose sides differ in length more than plain easing explains. Gather seams and
 * the legs of a dart take up length on purpose, so they stay quiet.
 */
function lengthHints(pattern: Pattern, issues: PatternIssue[]): void {
  const dartLegs = new Set<string>();
  for (const dart of Object.values(pattern.darts)) dartLegs.add(pairKey(dart.edge1Id, dart.edge2Id));

  for (const seam of Object.values(pattern.seams)) {
    // Open edges are not stitched, so their lengths never need to match.
    if (seam.type === 'free') continue;
    if (seam.type === 'gather' || seam.gatherRatio !== undefined) continue;
    const sides = seamSides(pattern, seam);
    if (!sides) continue;
    if (dartLegs.has(pairKey(sides.a.edgeId, sides.b.edgeId))) continue;
    const lenA = edgeIntervalLength(pattern, sides.a.edgeId, sides.a.t0, sides.a.t1);
    const lenB = edgeIntervalLength(pattern, sides.b.edgeId, sides.b.t0, sides.b.t1);
    const diff = Math.abs(lenA - lenB);
    const longer = Math.max(lenA, lenB);
    if (!(longer > 0) || diff <= LENGTH_DIFF_CM || diff / longer <= LENGTH_DIFF_RATIO) continue;
    issues.push({
      code: 'seam_length_mismatch',
      targetId: seam.id,
      message: `缝合 ${seam.id} 两侧长度差 ${diff.toFixed(2)} cm（甲 ${lenA.toFixed(2)} / 乙 ${lenB.toFixed(2)}），非缩缝请核对边长`,
      severity: 'warning',
    });
  }
}

/**
 * Hints at two seams stitching the same pair of edges over the same span, in either direction.
 * `seam_overlap` stays the edge-level error for one edge shared by two joins.
 */
function pairHints(pattern: Pattern, issues: PatternIssue[]): void {
  const sides: { id: string; a: SeamSide; b: SeamSide }[] = [];
  for (const seam of Object.values(pattern.seams)) {
    if (seam.type === 'free') continue;
    const resolved = seamSides(pattern, seam);
    if (resolved) sides.push({ id: seam.id, ...resolved });
  }

  for (let i = 0; i < sides.length; i++) {
    for (let j = i + 1; j < sides.length; j++) {
      const x = sides[i]!;
      const y = sides[j]!;
      const sameWay = x.a.edgeId === y.a.edgeId && x.b.edgeId === y.b.edgeId;
      const reversed = x.a.edgeId === y.b.edgeId && x.b.edgeId === y.a.edgeId;
      if (!sameWay && !reversed) continue;
      const runs: [SeamSide, SeamSide][] = sameWay
        ? [[x.a, y.a], [x.b, y.b]]
        : [[x.a, y.b], [x.b, y.a]];
      if (!runs.every(([left, right]) => spansOverlap(left, right))) continue;
      issues.push({
        code: 'seam_duplicate_pair',
        targetId: x.id,
        message: `缝合 ${x.id} 与 ${y.id} 重复配对了同一对边（${x.a.edgeId} / ${x.b.edgeId}）`,
        severity: 'warning',
      });
    }
  }
}

/**
 * Seam hints worth showing the user; they never block a commit, so they stay out of
 * `validatePattern`, which only reports topology errors.
 */
export function seamWarnings(pattern: Pattern): PatternIssue[] {
  const issues: PatternIssue[] = [];
  lengthHints(pattern, issues);
  pairHints(pattern, issues);
  return issues;
}
