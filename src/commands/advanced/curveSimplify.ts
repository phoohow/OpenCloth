import type { ProjectContext } from '@/commands/command';
import type { Pattern, Vec2 } from '@/model/types';
import { SnapshotCommand } from '@/commands/patternSnapshot';
import { newEdge, newPoint } from '@/commands/patternCreateCommands';
import { prunePattern } from '@/commands/patternStructureCommands';
import { sampleEdge } from '@/pattern/geom';
import { adaptiveSampleBezier, edgeCurve, evalBezier, type CubicBezier2 } from '@/pattern/geom';
import { arcFromThreePoints } from '@/common/geom/arc';
import {
  bezierFromFit, deviationFromArc, distanceToPolyline, fitBezierHandles, maxDistanceToPolyline,
} from '@/common/geom/polyCurve';
import { distance, dot, normalize, sub } from '@/common/geom';
import {
  arrayContainsChain, chainFractions, dropUnusedHandles, edgeArrays, remapChainReferences, spliceSequence,
} from '@/commands/advanced/shared';

/** Options for `SimplifyCurveCommand`. */
export interface SimplifyCurveOptions {
  /** Largest allowed deviation from the original shape in cm; defaults to 0.05. */
  maxDeviationCm?: number;
  /** Largest number of anchor points allowed in the result. */
  maxControls?: number;
}

/** One fitted cubic of a simplified chain, with the dense samples behind it. */
interface CurveSpan {
  /** Dense samples the span follows, including both ends. */
  samples: Vec2[];
  /** Index of each sample in the dense chain samples. */
  sampleIndices: number[];
  /** Travel directions the fit holds at the span ends. */
  tangentStart: Vec2;
  tangentEnd: Vec2;
  /** Fitted cubic stored on the anchor points. */
  curve: CubicBezier2;
}

/**
 * Rebuilds a chain of edges as fewer cubic segments whose handles sit on the anchor points,
 * or turns a single curve edge into an arc or a straight line when it fits the tolerance.
 */
export class SimplifyCurveCommand extends SnapshotCommand {
  readonly label = '简化曲线';

  constructor(private edgeIds: string[], private opts: SimplifyCurveOptions = {}) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (this.edgeIds.length === 0) throw new Error('至少需要一条待简化的边');
    for (const id of this.edgeIds) if (!pattern.edges[id]) throw new Error(`边 ${id} 不存在，无法简化`);
    const tolerance = this.opts.maxDeviationCm ?? 0.05;
    if (!(tolerance > 0)) throw new Error('拟合误差需为正数');

    const chain = this.contiguousChain(pattern);
    if (chain.length === 1) {
      this.simplifySingleEdge(pattern, chain[0], tolerance);
      return;
    }
    const closed = pattern.edges[chain[0]].startPointId === pattern.edges[chain[chain.length - 1]].endPointId;
    const dense = denseSamples(pattern, chain, tolerance, closed);

    // Start from the coarsest anchor set and add the worst-fitting sample until the fit holds.
    let anchors = closed ? [0] : [0, dense.length - 1];
    let spans = fitSpans(dense, anchors, closed);
    let worst = worstSpanDeviation(spans);
    while (worst.deviation > tolerance) {
      if (spans.length >= chain.length) throw new Error('在给公差内无法减少曲线控制点');
      if (anchors.includes(worst.sampleIndex) || anchors.length > dense.length) throw new Error('在给公差内无法简化曲线');
      anchors = [...anchors, worst.sampleIndex].sort((a, b) => a - b);
      spans = fitSpans(dense, anchors, closed);
      worst = worstSpanDeviation(spans);
    }
    if (this.opts.maxControls !== undefined && anchors.length > this.opts.maxControls) {
      throw new Error('在给公差内无法达到目标点数');
    }
    if (spans.length >= chain.length) throw new Error('在给公差内无法减少曲线控制点');
    this.rebuild(pattern, chain, dense, anchors, spans, closed);
  }

  /** The chain must run contiguously through one panel outline or hole loop. */
  private contiguousChain(pattern: Pattern): string[] {
    if (!edgeArrays(pattern).some(ids => arrayContainsChain(ids, this.edgeIds))) {
      throw new Error('所选边需在同一个轮廓内连续');
    }
    return [...this.edgeIds];
  }

  /** Replaces a single curve edge with an arc or a straight line when the tolerance allows. */
  private simplifySingleEdge(pattern: Pattern, edgeId: string, tolerance: number): void {
    const edge = pattern.edges[edgeId];
    const start = pattern.points[edge.startPointId]?.pos;
    const end = pattern.points[edge.endPointId]?.pos;
    if (!start || !end) throw new Error('边端点缺失，无法简化');
    if (edge.type === 'line') throw new Error('直线边无需简化');
    const curve = edge.type === 'bezier' ? edgeCurve(pattern, edge) : null;
    const samples = curve ? adaptiveSampleBezier(curve, Math.min(0.005, tolerance / 10)) : sampleEdge(pattern, edgeId);
    // Two samples only means the adaptive sampler already found the chord close enough.
    const chordDeviation = samples.length >= 3 ? maxDistanceToPolyline(samples, [start, end]) : 0;
    if (chordDeviation <= tolerance) {
      edge.type = 'line';
      delete edge.arc;
      dropUnusedHandles(pattern, [edge.startPointId, edge.endPointId]);
      return;
    }
    if (!curve) throw new Error('在给公差内无法简化曲线');
    const middle = {
      x: (curve.p0.x + 3 * curve.c0.x + 3 * curve.c1.x + curve.p1.x) / 8,
      y: (curve.p0.y + 3 * curve.c0.y + 3 * curve.c1.y + curve.p1.y) / 8,
    };
    const arc = arcFromThreePoints(start, middle, end);
    if (!arc || deviationFromArc(arc, samples) > tolerance) throw new Error('在给公差内无法简化曲线');
    edge.type = 'arc';
    edge.arc = arc;
    dropUnusedHandles(pattern, [edge.startPointId, edge.endPointId]);
  }

  /** Writes the fitted spans back as the chain's replacement edges and rewires the references. */
  private rebuild(
    pattern: Pattern, chain: string[], dense: Vec2[], anchors: number[], spans: CurveSpan[], closed: boolean,
  ): void {
    const from = chainFractions(pattern, chain);
    const anchorPoints = anchorPointIds(pattern, chain, dense, anchors, closed);
    const ids: string[] = [];
    for (let j = 0; j < spans.length; j++) {
      const startPointId = anchorPoints[j];
      const endPointId = anchorPoints[j + 1] ?? anchorPoints[0];
      const id = j < chain.length ? chain[j] : newEdge(pattern, 'bezier', startPointId, endPointId);
      const edge = pattern.edges[id];
      edge.type = 'bezier';
      delete edge.arc;
      edge.startPointId = startPointId;
      edge.endPointId = endPointId;
      if (edge.semantic === undefined) edge.semantic = pattern.edges[chain[0]].semantic;
      const curve = spans[j].curve;
      pattern.points[startPointId].handleOut = { ...curve.c0 };
      pattern.points[endPointId].handleIn = { ...curve.c1 };
      ids.push(id);
    }
    // Anchors keep a kink where the source turns more than a few degrees between the spans.
    anchorPoints.forEach((pointId, j) => {
      if (!closed && (j === 0 || j === anchorPoints.length - 1)) return;
      const incoming = spans[(j - 1 + spans.length) % spans.length];
      const outgoing = spans[j % spans.length];
      const turn = Math.abs(Math.atan2(
        incoming.tangentEnd.x * outgoing.tangentStart.y - incoming.tangentEnd.y * outgoing.tangentStart.x,
        dot(incoming.tangentEnd, outgoing.tangentStart),
      ));
      pattern.points[pointId].kind = turn > 0.14 ? 'corner' : 'smooth';
    });
    for (const id of chain) {
      if (ids.includes(id)) continue;
      dropUnusedHandles(pattern, [pattern.edges[id].startPointId, pattern.edges[id].endPointId]);
      delete pattern.edges[id];
    }
    for (const array of edgeArrays(pattern)) {
      if (!array.some(id => chain.includes(id))) continue;
      const spliced = spliceSequence(array, chain, ids);
      if (spliced.some(id => chain.includes(id) && !ids.includes(id))) throw new Error('所选边在轮廓中不连续，无法简化');
      array.splice(0, array.length, ...spliced);
    }
    remapChainReferences(pattern, chain, from, ids);
    prunePattern(pattern);
  }
}

/**
 * Chain samples in traversal order, densified so a fit cannot slip between two vertices;
 * the repeated closing vertex of a closed chain is dropped.
 */
function denseSamples(pattern: Pattern, chain: string[], tolerance: number, closed: boolean): Vec2[] {
  const raw: Vec2[] = [];
  for (const id of chain) {
    const edge = pattern.edges[id];
    const curve = edgeCurve(pattern, edge);
    const pts = curve ? adaptiveSampleBezier(curve, Math.min(0.02, tolerance / 4)) : sampleEdge(pattern, id);
    for (let i = raw.length === 0 ? 0 : 1; i < pts.length; i++) raw.push({ x: pts[i].x, y: pts[i].y });
  }
  if (closed && raw.length > 1) raw.pop();
  const step = Math.max(0.05, tolerance * 2);
  const dense: Vec2[] = [];
  raw.forEach((point, i) => {
    dense.push(point);
    const next = i + 1 < raw.length ? raw[i + 1] : closed ? raw[0] : null;
    if (!next) return;
    const runs = Math.max(1, Math.ceil(distance(point, next) / step));
    for (let k = 1; k < runs; k++) {
      const f = k / runs;
      dense.push({ x: point.x + (next.x - point.x) * f, y: point.y + (next.y - point.y) * f });
    }
  });
  if (dense.length < 3) throw new Error('曲线采样点不足，无法简化');
  return dense;
}

/** Cubic fit of every anchor span of the chain, the last one wrapping around when closed. */
function fitSpans(dense: Vec2[], anchors: number[], closed: boolean): CurveSpan[] {
  const pairs: [number, number][] = [];
  for (let j = 0; j + 1 < anchors.length; j++) pairs.push([anchors[j], anchors[j + 1]]);
  if (closed) pairs.push([anchors[anchors.length - 1], anchors[0]]);
  const spanIndices = (from: number, to: number): number[] => {
    const run = (lo: number, hi: number): number[] => {
      const out: number[] = [];
      for (let i = lo; i <= hi; i++) out.push(i);
      return out;
    };
    if (to > from) return run(from, to);
    if (to === from && !closed) return [from];
    return [...run(from, dense.length - 1), ...run(0, to)];
  };
  return pairs.map(([from, to]) => {
    const sampleIndices = spanIndices(from, to);
    const samples = sampleIndices.map(i => dense[i]);
    const tangentStart = spanDirection(dense, from, true, closed);
    const tangentEnd = spanDirection(dense, to, false, closed);
    const input = { samples, start: samples[0], end: samples[samples.length - 1], startTangent: tangentStart, endTangent: tangentEnd };
    return {
      samples, sampleIndices, tangentStart, tangentEnd,
      curve: bezierFromFit(input, fitBezierHandles(input)),
    };
  }).filter(span => span.samples.length >= 2);
}

/** Travel direction at one end of a span, taken from the neighbouring sample on the span's side. */
function spanDirection(dense: Vec2[], index: number, forwards: boolean, closed: boolean): Vec2 {
  const n = dense.length;
  const other = closed
    ? (index + (forwards ? 1 : n - 1)) % n
    : Math.max(0, Math.min(n - 1, index + (forwards ? 1 : -1)));
  const delta = forwards ? sub(dense[other], dense[index]) : sub(dense[index], dense[other]);
  if (Math.hypot(delta.x, delta.y) < 1e-9) return { x: 1, y: 0 };
  return normalize(delta);
}

/**
 * Largest deviation among the fitted spans, with the offending dense index. A non-finite
 * distance counts as failure so a broken fit is never accepted.
 */
function worstSpanDeviation(spans: CurveSpan[]): { deviation: number; sampleIndex: number } {
  let deviation = 0;
  let sampleIndex = spans[0]?.sampleIndices[0] ?? 0;
  for (const span of spans) {
    const curve = sampleCubic(span.curve);
    for (let k = 0; k < span.samples.length; k++) {
      const d = distanceToPolyline(span.samples[k], curve);
      if (!Number.isFinite(d)) return { deviation: Infinity, sampleIndex: span.sampleIndices[k] };
      if (d > deviation) {
        deviation = d;
        sampleIndex = span.sampleIndices[k];
      }
    }
  }
  return { deviation, sampleIndex };
}

/** Uniform samples of a cubic, used as the deviation reference for its span samples. */
function sampleCubic(curve: CubicBezier2): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= 128; i++) out.push(evalBezier(curve, i / 128));
  return out;
}

/** Pattern point id for each anchor: an existing chain vertex when the position matches. */
function anchorPointIds(pattern: Pattern, chain: string[], dense: Vec2[], anchors: number[], closed: boolean): string[] {
  const existing = new Set<string>();
  for (const id of chain) {
    existing.add(pattern.edges[id].startPointId);
    existing.add(pattern.edges[id].endPointId);
  }
  return anchors.map((index, j) => {
    const pos = dense[index];
    for (const id of existing) {
      const point = pattern.points[id];
      if (point && distance(point.pos, pos) <= 1e-6) return id;
    }
    const outerEnd = !closed && (j === 0 || j === anchors.length - 1);
    return newPoint(pattern, pos, outerEnd ? undefined : 'smooth');
  });
}
