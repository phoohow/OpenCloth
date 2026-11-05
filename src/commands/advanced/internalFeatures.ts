import { genId } from '@/common/id';
import type { ProjectContext } from '@/commands/command';
import type { InternalLine, Pattern, Vec2 } from '@/model/types';
import { PatternTopology } from '@/model';

import { SnapshotCommand } from '@/commands/patternSnapshot';
import { addClosedLineOutline, makePanel, placeRight } from '@/commands/patternCreateCommands';
import { samplePanelOutline } from '@/pattern/panel';
import { sampleEdge } from '@/pattern/geom';
import { add, computeBBox, ensureCCW } from '@/common/geom';
import { hasSelfIntersection, offsetPolyline } from '@/common/geom/offset';
import { insidePolygon } from '@/commands/patternStructureCommands';
import { insideOrOnRing, loopRing } from '@/commands/advanced/shared';

/** Options for `OffsetInternalLineCommand`. */
export interface OffsetInternalLineOptions {
  /** Kind written to the created internal lines; defaults to 'decor'. */
  kind?: InternalLine['kind'];
}

/** Copies a panel outline edge inward at each distance and stores the parallel lines. */
export class OffsetInternalLineCommand extends SnapshotCommand {
  readonly label = '生成等距内部线';

  constructor(
    private edgeId: string,
    private distancesCm: number[],
    private opts: OffsetInternalLineOptions = {},
  ) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.edges[this.edgeId]) throw new Error('边不存在，无法生成等距线');
    if (this.distancesCm.length === 0) throw new Error('至少需要一个等距距离');
    for (const d of this.distancesCm) if (!(d > 0)) throw new Error('等距距离需为正数');

    const topology = new PatternTopology(pattern);
    const panelId = topology.panelOfEdge(this.edgeId);
    const panel = panelId ? pattern.panels[panelId] : undefined;
    if (!panel) throw new Error('边不属于任何版片，无法生成等距线');

    const outline = samplePanelOutline(pattern, panel);
    if (outline.length < 3) throw new Error('版片轮廓无效，无法生成等距线');
    const source = sampleEdge(pattern, this.edgeId);
    const kind = this.opts.kind ?? 'decor';
    for (const distanceCm of this.distancesCm) {
      const forward = offsetPolyline(source, distanceCm);
      const inward = forward.every(p => insideOrOnRing(outline, p))
        ? forward
        : offsetPolyline(source, -distanceCm);
      if (!inward.every(p => insideOrOnRing(outline, p))) throw new Error('等距线超出版片轮廓');
      const id = genId('line');
      pattern.internalLines[id] = { id, kind, points: inward.map(p => ({ x: p.x, y: p.y })) };
      panel.internalLineIds.push(id);
    }
  }
}

/** Options for `PanelFromInternalLoopCommand`. */
export interface PanelFromInternalLoopOptions {
  /** Name of the created panel; defaults to the source panel name with the inset suffix. */
  name?: string;
}

/**
 * Turns a closed internal line into a hole in its panel plus a new panel placed beside it,
 * stitched to the hole boundary edge by edge.
 */
export class PanelFromInternalLoopCommand extends SnapshotCommand {
  readonly label = '内部线成片';

  /** Id of the created panel, readable after execute. */
  newPanelId = '';

  constructor(
    private panelId: string,
    private internalLineId: string,
    private opts: PanelFromInternalLoopOptions = {},
  ) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    const line = pattern.internalLines[this.internalLineId];
    if (!line) throw new Error('内部线不存在，无法成片');
    if (!panel.internalLineIds.includes(this.internalLineId)) throw new Error('内部线不属于该版片');

    const ring = loopRing(line.points);
    if (!ring) throw new Error('内部线不是闭合环，无法成片');
    if (hasSelfIntersection(ring)) throw new Error('内部线环自相交，无法成片');
    const outline = samplePanelOutline(pattern, panel);
    if (!ring.every((p: Vec2) => insidePolygon(outline, p))) throw new Error('内部线环需完全位于版片轮廓内');

    const ccw = ensureCCW(ring);
    const holeIds = addClosedLineOutline(pattern, [...ccw].reverse());
    panel.holes = [...(panel.holes ?? []), holeIds];

    const bbox = computeBBox(ccw);
    const shift = placeRight(pattern, bbox.min, bbox.max);
    const outlineIds = addClosedLineOutline(pattern, ccw.map(p => add(p, shift)));
    const created = makePanel(pattern, ctx, {
      name: this.opts.name ?? `${panel.name}内片`, seamAllowanceCm: panel.seamAllowanceCm,
    }, outlineIds);
    created.fabricId = panel.fabricId;
    created.meshResolutionCm = panel.meshResolutionCm;
    created.grainAngleDeg = panel.grainAngleDeg;
    created.grainOffset = panel.grainOffset ? { ...panel.grainOffset } : undefined;
    created.grainLengthCm = panel.grainLengthCm;
    this.newPanelId = created.id;

    const n = ccw.length;
    for (let m = 0; m < outlineIds.length; m++) {
      const seamId = genId('seam');
      pattern.seams[seamId] = {
        id: seamId,
        type: 'normal',
        a: { edgeId: outlineIds[m], t0: 0, t1: 1 },
        b: { edgeId: holeIds[(n - 2 - m + n * 2) % n], t0: 0, t1: 1 },
        flip: true,
        strength: 0.8,
        threadColor: '#ff4444',
        stitchVisible: true,
      };
    }
    line.kind = 'split';
  }
}
