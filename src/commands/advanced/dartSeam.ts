import { genId } from '@/common/id';
import type { ProjectContext } from '@/commands/command';
import type { Pattern, Vec2 } from '@/model/types';

import { SnapshotCommand } from '@/commands/patternSnapshot';
import { newEdge, newPoint } from '@/commands/patternCreateCommands';
import { prunePattern } from '@/commands/patternStructureCommands';
import { edgeLength, pointAtT } from '@/pattern/geom';
import { sampleOutline, samplePanelOutline } from '@/pattern/panel';
import { computeBBox, add, normalize, scale, sub } from '@/common/geom';
import { hasSelfIntersection } from '@/common/geom/offset';
import { jointCornerIds, seamJoint, type SeamJointEnd } from '@/pattern/seam';
import { applyFillets } from '@/commands/patternEditCommands';
import { inwardDepth, inwardDirection, splitLineEdge } from '@/commands/advanced/shared';

/**
 * Adds a diamond dart inside a panel: the outline detours through the inward tip while a
 * fourth closing vertex keeps the base open, drawn with two internal lines.
 */
export class RhombusDartCommand extends SnapshotCommand {
  readonly label = '创建菱形省';

  /** Id of the created dart, readable after execute. */
  dartId = '';

  /** @param t arc-length fraction along the outline edge where the dart base sits */
  constructor(
    private panelId: string,
    private edgeId: string,
    private t: number,
    private intakeCm: number,
    private lengthCm: number,
  ) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    if (!panel.outlineEdgeIds.includes(this.edgeId)) throw new Error('菱形省需在版片的轮廓边上创建');
    const edge = pattern.edges[this.edgeId];
    if (edge.type !== 'line') throw new Error('菱形省暂仅支持直线轮廓边');
    if (!(this.intakeCm > 0)) throw new Error('省量需为正数');
    if (!(this.lengthCm > 0)) throw new Error('省长需为正数');
    if (!(this.t >= 0 && this.t <= 1)) throw new Error('省位需在边的 0 到 1 之间');

    const span = edgeLength(pattern, this.edgeId);
    const centre = this.t * span;
    const half = this.intakeCm / 2;
    if (centre - half < 0 || centre + half > span) throw new Error('省量超出边长，无法布置菱形省');

    const baseA = pointAtT(pattern, this.edgeId, (centre - half) / span)!;
    const baseB = pointAtT(pattern, this.edgeId, (centre + half) / span)!;
    const [, onward] = splitLineEdge(pattern, this.edgeId, baseA);
    const [baseEdge] = splitLineEdge(pattern, onward, baseB);
    const baseStartId = pattern.edges[baseEdge].startPointId;
    const baseEndId = pattern.edges[baseEdge].endPointId;
    const baseStart = pattern.points[baseStartId]!.pos;
    const baseEnd = pattern.points[baseEndId]!.pos;

    const outline = samplePanelOutline(pattern, panel);
    const middle = { x: (baseStart.x + baseEnd.x) / 2, y: (baseStart.y + baseEnd.y) / 2 };
    const normal = inwardDirection(outline, middle, normalize(sub(baseEnd, baseStart)));
    const bbox = computeBBox(outline);
    const reach = Math.hypot(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y) + 1;
    if (inwardDepth(outline, middle, normal, reach) < this.lengthCm + 0.2) throw new Error('省长超出版片范围，无法创建菱形省');

    const tip = add(middle, scale(normal, this.lengthCm));
    const closing = add(middle, scale(normal, this.lengthCm / 2));
    const tipId = newPoint(pattern, tip, 'corner');
    const leg1 = newEdge(pattern, 'line', baseStartId, tipId);
    const leg2 = newEdge(pattern, 'line', tipId, baseEndId);

    const index = panel.outlineEdgeIds.indexOf(baseEdge);
    panel.outlineEdgeIds.splice(index, 1, leg1, leg2);
    delete pattern.edges[baseEdge];
    // The diamond's two closing sides live as internal lines: the model owns no free points.
    for (const pair of [[baseEnd, closing], [closing, baseStart]] as [Vec2, Vec2][]) {
      const id = genId('line');
      pattern.internalLines[id] = { id, kind: 'split', points: pair.map(p => ({ x: p.x, y: p.y })) };
      panel.internalLineIds.push(id);
    }

    const dartId = genId('dart');
    pattern.darts[dartId] = { id: dartId, tipId, edge1Id: leg1, edge2Id: leg2, intakeCm: this.intakeCm };
    panel.dartIds.push(dartId);
    this.dartId = dartId;

    if (hasSelfIntersection(sampleOutline(pattern, panel.outlineEdgeIds))) throw new Error('菱形省导致轮廓自相交');
    prunePattern(pattern);
  }
}

/** Rounds both corners where one seam end joins, removing the point in the sewn joint. */
export class BlendSeamJointCommand extends SnapshotCommand {
  readonly label = '接角圆顺';

  /** Fabric angle of the joint before rounding, in degrees. */
  angleDeg = 0;

  /** @param end which end of the seam interval carries the joint */
  constructor(private seamId: string, private end: SeamJointEnd, private radiusCm: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const joint = seamJoint(pattern, this.seamId, this.end);
    if (!joint) throw new Error('接角圆顺需要缝合两端落在版片轮廓角点上');
    if (!(this.radiusCm > 0)) throw new Error('圆顺半径需为正数');
    this.angleDeg = joint.angleDeg;
    applyFillets(pattern, jointCornerIds(joint), this.radiusCm);
  }
}
