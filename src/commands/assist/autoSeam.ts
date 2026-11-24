import type { Pattern, SeamEnd } from '@/model/types';

import { clamp01, dot2, length2, normalize2, perp2, scale2, sub2, type Vec2 } from '@/base/math';
import { edgeLength, sampleEdge } from '@/pattern/geom';

const PARTNERS: Record<string, string[]> = {
  shoulder: ['shoulder'],
  sideSeam: ['sideSeam'],
  neckline: ['neckline'],
  waist: ['waist'],
  armhole: ['sleeveCap'],
  sleeveCap: ['armhole'],
};

export interface SeamCandidate {
  a: SeamEnd;
  b: SeamEnd;
  flip: boolean;
  score: number;
  reason: string;
  gatherRatio?: number;
}

export interface SeamCandidateOptions {
  minScore?: number;
  lengthTolerance?: number;
  skipExistingSeams?: boolean;
}

export interface SeamScanSkipped {
  unlabeled: number;
  alreadySeamed: number;
  multiEdge: number;
}

export interface SeamScanResult {
  candidates: SeamCandidate[];
  skipped: SeamScanSkipped;
}

const fullEnd = (edgeId: string): SeamEnd => ({ edgeId, t0: 0, t1: 1 });

const chordOf = (pts: { x: number; y: number }[]): { x: number; y: number } => ({
  x: pts[pts.length - 1].x - pts[0].x,
  y: pts[pts.length - 1].y - pts[0].y,
});

function bowFactor(pts: Vec2[]): number {
  const chord = chordOf(pts);
  const len = length2(chord);
  if (len < 1e-6) return 0;
  const across = perp2(normalize2(chord));
  let sum = 0;
  for (const p of pts) sum += Math.abs(dot2(sub2(p, pts[0]!), across));
  return sum / pts.length / len;
}

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
      const chordB = scale2(chordOf(ptsB), flip ? -1 : 1);
      const lenA = length2(chordA) || 1e-6;
      const lenB = length2(chordB) || 1e-6;
      const cos = clamp01(dot2(chordA, chordB) / (lenA * lenB) * 0.5 + 0.5);
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
