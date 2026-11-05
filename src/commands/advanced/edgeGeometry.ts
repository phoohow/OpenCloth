import type { ProjectContext } from '@/commands/command';
import type { Pattern, PatternEdge, PatternPoint } from '@/model/types';
import { SnapshotCommand } from '@/commands/patternSnapshot';
import { edgeLength } from '@/pattern/geom';
import { prunePattern } from '@/commands/patternStructureCommands';
import { dot, distance, normalize, sub } from '@/common/geom';
import { arcSpan, evalArc } from '@/common/geom/arc';
import { refitArcs } from '@/commands/patternMoveGeometry';
import {
  assertOwningPanelsSimple, chainFractions, dropUnusedHandles, edgeArrays, handleExclusive, interiorPointIds,
  rad, remapChainReferences, rotateAbout, scaleAbout, sharedVertexOf, spliceSequence,
} from '@/commands/advanced/shared';

/**
 * Sets an edge's length by scaling it about its start point: the end vertex slides along the
 * edge direction while curves and arcs keep their shape at the same factor, and the arcs meeting
 * at the end vertex follow it.
 */
export class SetEdgeLengthCommand extends SnapshotCommand {
  readonly label = '修改边长';

  constructor(private edgeId: string, private lengthCm: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const edge = pattern.edges[this.edgeId];
    if (!edge) throw new Error('边不存在，无法改边长');
    if (!(this.lengthCm > 0)) throw new Error('边长需为正数');
    const start = pattern.points[edge.startPointId];
    const end = pattern.points[edge.endPointId];
    if (!start || !end) throw new Error('边端点缺失，无法改边长');
    const current = edgeLength(pattern, this.edgeId);
    if (current < 1e-6) throw new Error('边长度为零，无法确定方向');

    const factor = this.lengthCm / current;
    end.pos = scaleAbout(start.pos, end.pos, factor);
    if (edge.type === 'arc' && edge.arc) {
      edge.arc = { ...edge.arc, center: scaleAbout(start.pos, edge.arc.center, factor), radius: edge.arc.radius * factor };
    } else if (edge.type === 'bezier') {
      if (start.handleOut) start.handleOut = scaleAbout(start.pos, start.handleOut, factor);
      if (end.handleIn) end.handleIn = scaleAbout(start.pos, end.handleIn, factor);
    }
    refitArcs(pattern, new Set([end.id]));
    assertOwningPanelsSimple(pattern, [this.edgeId], '改边长后轮廓自相交');
  }
}

/**
 * Rotates an edge about the vertex it shares with another edge until their angle matches,
 * carrying the far vertex, the arcs meeting there and the edge's own tangents along.
 */
export class SetEdgeAngleCommand extends SnapshotCommand {
  readonly label = '修改边夹角';

  constructor(private edgeId: string, private otherEdgeId: string, private angleDeg: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const edge = pattern.edges[this.edgeId];
    const other = pattern.edges[this.otherEdgeId];
    if (!edge || !other) throw new Error('边不存在，无法改角度');
    if (edge.id === other.id) throw new Error('夹角需要两条不同的边');
    if (!(this.angleDeg > 0 && this.angleDeg < 360)) throw new Error('夹角需大于 0 且小于 360 度');

    const sharedId = sharedVertexOf(edge, other);
    const farId = edge.startPointId === sharedId ? edge.endPointId : edge.startPointId;
    const otherFarId = other.startPointId === sharedId ? other.endPointId : other.startPointId;
    const anchor = pattern.points[sharedId];
    const far = pattern.points[farId];
    const otherFar = pattern.points[otherFarId];
    if (!anchor || !far || !otherFar) throw new Error('边端点缺失，无法改角度');
    const radius = distance(anchor.pos, far.pos);
    if (radius < 1e-6) throw new Error('边长度为零，无法确定方向');
    if (distance(anchor.pos, otherFar.pos) < 1e-6) throw new Error('相邻边长度为零，无法确定方向');

    const reference = normalize(sub(otherFar.pos, anchor.pos));
    const currentVector = sub(far.pos, anchor.pos);
    const current = Math.atan2(
      reference.x * currentVector.y - reference.y * currentVector.x,
      dot(reference, currentVector),
    );
    const delta = (current >= 0 ? rad(this.angleDeg) : -rad(this.angleDeg)) - current;
    far.pos = rotateAbout(anchor.pos, far.pos, delta);
    refitArcs(pattern, new Set([farId]), { midpoint: arc => rotateAbout(anchor.pos, evalArc(arc, 0.5), delta) });
    this.rotateTangents(pattern, edge, anchor, far, farId, sharedId, delta);
    assertOwningPanelsSimple(pattern, [this.edgeId], '改角度后轮廓自相交');
  }

  /** Turns the edge's own endpoint handles with it when no other bezier shares the slot. */
  private rotateTangents(
    pattern: Pattern, edge: PatternEdge, anchor: PatternPoint, far: PatternPoint,
    farId: string, sharedId: string, delta: number,
  ): void {
    if (edge.type !== 'bezier') return;
    const atAnchor: 'handleIn' | 'handleOut' = edge.endPointId === sharedId ? 'handleIn' : 'handleOut';
    const atFar: 'handleIn' | 'handleOut' = edge.endPointId === farId ? 'handleIn' : 'handleOut';
    if (anchor[atAnchor] && handleExclusive(pattern, sharedId, atAnchor, edge.id)) {
      anchor[atAnchor] = rotateAbout(anchor.pos, anchor[atAnchor]!, delta);
    }
    if (far[atFar] && handleExclusive(pattern, farId, atFar, edge.id)) {
      far[atFar] = rotateAbout(far.pos, far[atFar]!, delta);
    }
  }
}

/** New radius or new center angle for an arc; exactly one of the two is supplied. */
export interface ArcParamPatch {
  radiusCm?: number;
  sweepDeg?: number;
}

/**
 * Changes an arc's radius or center angle while keeping both endpoints fixed. The center is
 * rebuilt on the perpendicular bisector on the side that preserves the arc's direction, and a
 * radius shorter than half the chord is clamped to the smallest legal value.
 */
export class SetArcParamsCommand extends SnapshotCommand {
  readonly label = '修改圆弧参数';

  constructor(private edgeId: string, private params: ArcParamPatch) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const edge = pattern.edges[this.edgeId];
    if (!edge) throw new Error('边不存在，无法修改圆弧');
    if (edge.type !== 'arc' || !edge.arc) throw new Error('该边不是圆弧，无法修改弧参数');
    const start = pattern.points[edge.startPointId];
    const end = pattern.points[edge.endPointId];
    if (!start || !end) throw new Error('边端点缺失，无法修改圆弧');

    const dx = end.pos.x - start.pos.x;
    const dy = end.pos.y - start.pos.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-6) throw new Error('圆弧两端点重合，无法修改弧参数');
    if ((this.params.radiusCm === undefined) === (this.params.sweepDeg === undefined)) {
      throw new Error('需要且只能指定半径或圆心角');
    }

    const old = edge.arc;
    const oldSpan = arcSpan(old);
    const oldAbs = Math.abs(oldSpan);
    const mid = { x: (start.pos.x + end.pos.x) / 2, y: (start.pos.y + end.pos.y) / 2 };
    // Left normal of the directed chord.
    const normal = { x: -dy / chord, y: dx / chord };
    const centerSide = Math.sign(dx * (old.center.y - start.pos.y) - dy * (old.center.x - start.pos.x));
    const minorSide = old.ccw ? 1 : -1;
    const branchSide = oldAbs > Math.PI + 1e-9 ? -minorSide : minorSide;

    let radius: number;
    let hSign: number;
    if (this.params.sweepDeg !== undefined) {
      const deg = this.params.sweepDeg;
      if (!Number.isFinite(deg) || deg <= 0 || deg >= 360) throw new Error('圆心角需大于 0° 且小于 360°');
      radius = chord / (2 * Math.sin(rad(deg) / 2));
      const source = deg < 180 ? minorSide : deg > 180 ? -minorSide : 0;
      hSign = source || branchSide;
    } else {
      const requested = this.params.radiusCm!;
      if (!Number.isFinite(requested) || requested <= 0) throw new Error('圆弧半径需为正数');
      radius = Math.max(requested, chord / 2);
      hSign = Math.abs(oldAbs - Math.PI) < 1e-6 ? branchSide : centerSide || branchSide;
    }

    const h = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
    if (!Number.isFinite(h)) throw new Error('圆弧半径过大');
    const center = {
      x: mid.x + hSign * h * normal.x,
      y: mid.y + hSign * h * normal.y,
    };
    edge.arc = {
      center,
      radius,
      startAngle: Math.atan2(start.pos.y - center.y, start.pos.x - center.x),
      endAngle: Math.atan2(end.pos.y - center.y, end.pos.x - center.x),
      ccw: old.ccw,
    };
  }
}

/** Collinearity tolerance for `MergeCollinearEdgesCommand`, in cm. */
const COLLINEAR_TOLERANCE_CM = 1e-6;

/**
 * Replaces a chain of adjacent, collinear, same-allowance straight edges with one edge,
 * mapping the seam intervals and notches of the chain proportionally onto it.
 */
export class MergeCollinearEdgesCommand extends SnapshotCommand {
  readonly label = '合并共线边';

  /** Id of the surviving merged edge, readable after execute. */
  mergedEdgeId = '';

  /** @param edgeIds adjacent straight edges in traversal order; the reverse order also works */
  constructor(private edgeIds: string[]) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (this.edgeIds.length < 2) throw new Error('合并至少需要两条相邻边');
    for (const id of this.edgeIds) if (!pattern.edges[id]) throw new Error(`边 ${id} 不存在，无法合并`);

    const chain = this.traversalOrder(pattern);
    const first = pattern.edges[chain[0]];
    for (const id of chain) {
      const edge = pattern.edges[id];
      if (edge.type !== 'line') throw new Error('仅支持合并直线边');
      if (edge.semantic !== first.semantic) throw new Error('相邻边的语义不同，无法合并');
      if ((edge.seamAllowanceCm ?? null) !== (first.seamAllowanceCm ?? null)) throw new Error('相邻边的缝份不同，无法合并');
      if ((edge.cornerStyle ?? null) !== (first.cornerStyle ?? null)) throw new Error('相邻边的角型不同，无法合并');
    }

    const start = pattern.points[first.startPointId]?.pos;
    const lastEdge = pattern.edges[chain[chain.length - 1]];
    const end = pattern.points[lastEdge.endPointId]?.pos;
    if (!start || !end) throw new Error('边端点缺失，无法合并');
    const straight = sub(end, start);
    const span = Math.hypot(straight.x, straight.y);
    if (span < COLLINEAR_TOLERANCE_CM) throw new Error('合并后的边长度为零，无法合并');
    const normal = { x: straight.y / span, y: -straight.x / span };
    for (const pointId of interiorPointIds(pattern, chain)) {
      const pos = pattern.points[pointId]?.pos;
      if (!pos) throw new Error('边端点缺失，无法合并');
      if (Math.abs(dot(sub(pos, start), normal)) > COLLINEAR_TOLERANCE_CM) throw new Error('所选边不在同一直线上，无法合并');
      if (this.hasForeignEdge(pattern, pointId, chain)) throw new Error('共线边的中间顶点被其他边引用，无法合并');
    }

    const from = chainFractions(pattern, chain);
    const replaced = chain.slice(1);
    for (const id of replaced) {
      dropUnusedHandles(pattern, [pattern.edges[id].startPointId, pattern.edges[id].endPointId]);
      delete pattern.edges[id];
    }
    first.endPointId = lastEdge.endPointId;
    for (const array of edgeArrays(pattern)) {
      if (!array.some(id => chain.includes(id))) continue;
      const spliced = spliceSequence(array, chain, [first.id]);
      if (spliced.some(id => replaced.includes(id))) throw new Error('所选边在轮廓中不连续，无法合并');
      array.splice(0, array.length, ...spliced);
    }
    remapChainReferences(pattern, chain, from, [first.id]);
    this.mergedEdgeId = first.id;
    assertOwningPanelsSimple(pattern, [first.id], '合并后轮廓自相交');
    prunePattern(pattern);
  }

  /** Chain order that follows the edges' own start-to-end direction. */
  private traversalOrder(pattern: Pattern): string[] {
    const adjacent = (ids: string[]) => ids.every((id, i) =>
      i === 0 || pattern.edges[ids[i - 1]].endPointId === pattern.edges[id].startPointId);
    if (adjacent(this.edgeIds)) return [...this.edgeIds];
    const reversed = [...this.edgeIds].reverse();
    if (adjacent(reversed)) return reversed;
    throw new Error('所选边不相邻，无法合并');
  }

  private hasForeignEdge(pattern: Pattern, pointId: string, chain: string[]): boolean {
    return Object.values(pattern.edges).some(edge =>
      !chain.includes(edge.id) && (edge.startPointId === pointId || edge.endPointId === pointId));
  }
}
