import type { Pattern, SeamEnd } from '../../core/model/types';
import { edgeLength, sampleEdge } from '../../pattern/geom/edgeSample';

/** A suggested seam pairing two edge intervals. */
export interface SeamCandidate {
  a: SeamEnd;
  b: SeamEnd;
  /** True when edge B must be reversed to match edge A. */
  flip: boolean;
  /** Match quality in [0, 1]. */
  score: number;
  /** Chinese description of why the pair matches. */
  reason: string;
  /** Length ratio of the longer side over the shorter; > 1.02 means ease. */
  gatherRatio?: number;
}

/** Options for `seamCandidates`. */
export interface SeamCandidateOptions {
  /** Candidates below this score are dropped; default 0.55. */
  minScore?: number;
  /** Below this length ratio (short/long) a pair is rejected; default 0.55. */
  lengthTolerance?: number;
  /** Skip edges already joined by an existing seam; default false. */
  skipExistingSeams?: boolean;
}

/** Counts of edges and pairs the scan skipped, for UI messaging. */
export interface SeamScanSkipped {
  /** Edges without a semantic, or with a role that has no auto-match partner. */
  unlabeled: number;
  /** Edges excluded because they already belong to a seam (skipExistingSeams). */
  alreadySeamed: number;
  /** Matched pairs dropped when keeping only the best-scoring candidate per edge. */
  multiEdge: number;
}

/** Candidates plus the skip diagnostics that explain what was not matched. */
export interface SeamScanResult {
  candidates: SeamCandidate[];
  skipped: SeamScanSkipped;
}

/** Semantic partners: which edge roles stitch together, including mirrored pairs. */
const PARTNERS: Record<string, string[]> = {
  shoulder: ['shoulder'],
  sideSeam: ['sideSeam'],
  neckline: ['neckline'],
  waist: ['waist'],
  armhole: ['sleeveCap'],
  sleeveCap: ['armhole'],
};

const fullEnd = (edgeId: string): SeamEnd => ({ edgeId, t0: 0, t1: 1 });

const chordOf = (pts: { x: number; y: number }[]): { x: number; y: number } => ({
  x: pts[pts.length - 1].x - pts[0].x,
  y: pts[pts.length - 1].y - pts[0].y,
});

/** Mean absolute deviation of a polyline from its chord, normalized by chord length. */
function bowFactor(pts: { x: number; y: number }[]): number {
  const chord = chordOf(pts);
  const len = Math.hypot(chord.x, chord.y);
  if (len < 1e-6) return 0;
  const nx = chord.y / len;
  const ny = -chord.x / len;
  let sum = 0;
  for (const p of pts) sum += Math.abs((p.x - pts[0].x) * nx + (p.y - pts[0].y) * ny);
  return sum / pts.length / len;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Suggests seam pairings across the pattern: same-or-mirror semantics, similar sampled
 * length, matching chord orientation and curvature. Each edge appears at most once,
 * in the best-scoring candidate. Darts and internal lines never auto-match; the
 * `skipped` counts report what the scan left out.
 */
export function seamCandidates(pattern: Pattern, opts: SeamCandidateOptions = {}): SeamScanResult {
  const minScore = opts.minScore ?? 0.55;
  const lengthTolerance = opts.lengthTolerance ?? 0.55;
  const skipped: SeamScanSkipped = { unlabeled: 0, alreadySeamed: 0, multiEdge: 0 };

  const edgeIds = Object.keys(pattern.edges);
  const seamed = new Set<string>();
  if (opts.skipExistingSeams) {
    for (const seam of Object.values(pattern.seams)) {
      seamed.add(seam.a?.edgeId ?? '');
      seamed.add(seam.b?.edgeId ?? '');
    }
  }

  interface PairEval {
    aId: string;
    bId: string;
    flip: boolean;
    score: number;
    gatherRatio?: number;
    parts: { sem: string; len: number; orient: number; curv: number };
  }

  const evals: PairEval[] = [];
  for (let i = 0; i < edgeIds.length; i++) {
    const edgeA = pattern.edges[edgeIds[i]];
    if (!edgeA) continue;
    if (seamed.has(edgeA.id)) { skipped.alreadySeamed++; continue; }
    const semA = edgeA.semantic;
    if (!semA || !PARTNERS[semA]) { skipped.unlabeled++; continue; }
    for (let j = i + 1; j < edgeIds.length; j++) {
      const a = edgeIds[i];
      const b = edgeIds[j];
      const edgeB = pattern.edges[b];
      const semB = edgeB?.semantic;
      if (!edgeB || !semB || !PARTNERS[semB]?.includes(semA) || seamed.has(b)) continue;
      const la = edgeLength(pattern, a);
      const lb = edgeLength(pattern, b);
      if (la <= 0 || lb <= 0) continue;
      const ratio = Math.min(la, lb) / Math.max(la, lb);
      if (ratio < lengthTolerance) continue;

      const ptsA = sampleEdge(pattern, a);
      const ptsB = sampleEdge(pattern, b);
      if (ptsA.length < 2 || ptsB.length < 2) continue;
      const ca = ptsA[0];
      const cb = ptsB[0];
      const ce = ptsA[ptsA.length - 1];
      const df = ptsB[ptsB.length - 1];
      const straight = Math.hypot(ca.x - cb.x, ca.y - cb.y) + Math.hypot(ce.x - df.x, ce.y - df.y);
      const crossed = Math.hypot(ca.x - df.x, ca.y - df.y) + Math.hypot(ce.x - cb.x, ce.y - cb.y);
      const flip = crossed < straight;

      const chordA = chordOf(ptsA);
      const chordB = flip
        ? { x: -chordOf(ptsB).x, y: -chordOf(ptsB).y }
        : chordOf(ptsB);
      const lenA = Math.hypot(chordA.x, chordA.y) || 1e-6;
      const lenB = Math.hypot(chordB.x, chordB.y) || 1e-6;
      const cos = clamp01((chordA.x * chordB.x + chordA.y * chordB.y) / (lenA * lenB) * 0.5 + 0.5);
      const orient = clamp01((cos - 0.5) / 0.5);

      const bowA = bowFactor(ptsA);
      const bowB = bowFactor(ptsB);
      const curv = clamp01(1 - Math.abs(bowA - bowB) / 0.15);
      const lenScore = clamp01((ratio - lengthTolerance) / (1 - lengthTolerance));

      const score = 0.4 * 1 + 0.25 * lenScore + 0.2 * orient + 0.15 * curv;
      if (score < minScore) continue;

      const gather = Math.max(la, lb) / Math.min(la, lb);
      evals.push({
        aId: a, bId: b, flip, score,
        gatherRatio: gather > 1.02 ? Math.round(gather * 1000) / 1000 : undefined,
        parts: { sem: `${semA}/${semB}`, len: ratio, orient, curv },
      });
    }
  }

  evals.sort((x, y) => y.score - x.score || x.aId.localeCompare(y.aId) || x.bId.localeCompare(y.bId));

  const taken = new Set<string>();
  const candidates: SeamCandidate[] = [];
  for (const e of evals) {
    if (taken.has(e.aId) || taken.has(e.bId)) { skipped.multiEdge++; continue; }
    taken.add(e.aId);
    taken.add(e.bId);
    const reason = [
      `语义匹配 ${e.parts.sem}`,
      `长度比 ${e.parts.len.toFixed(2)}`,
      e.gatherRatio ? `吃势 ${((e.gatherRatio - 1) * 100).toFixed(1)}%（建议缩缝）` : null,
      `方向${e.parts.orient > 0.8 ? '一致' : '接近'}`,
      `曲率${e.parts.curv > 0.8 ? '相近' : '略有差异'}`,
    ].filter(Boolean).join('，');
    candidates.push({
      a: fullEnd(e.aId),
      b: fullEnd(e.bId),
      flip: e.flip,
      score: Math.round(e.score * 1000) / 1000,
      reason,
      ...(e.gatherRatio ? { gatherRatio: e.gatherRatio } : {}),
    });
  }
  return { candidates, skipped };
}
