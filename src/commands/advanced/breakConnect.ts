import { genId } from '@/common/id';
import type { ProjectContext } from '@/commands/command';
import type { Pattern } from '@/model/types';
import { PatternTopology } from '@/model';

import { SnapshotCommand } from '@/commands/patternSnapshot';
import { prunePattern } from '@/commands/patternStructureCommands';
import { sampleOutline } from '@/pattern/panel';
import { hasSelfIntersection } from '@/common/geom/offset';
import { refitArcs } from '@/commands/patternMoveGeometry';
import {
  assignClosedChains, closedChains, incidentOutlineEdges, outlineEdgesOfPoint, panelsOwningAny,
} from '@/commands/advanced/shared';

/**
 * Duplicates a shared outline vertex so the named edges stop sharing it: contours that only
 * touched at the point split into separate panels.
 */
export class BreakPointCommand extends SnapshotCommand {
  readonly label = '断开顶点';

  /** @param edgeIds outline edges to move onto the duplicated vertex; omit to break automatically */
  constructor(private pointId: string, private edgeIds?: string[]) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    const point = pattern.points[this.pointId];
    if (!point) throw new Error('顶点不存在，无法断开');
    const topology = new PatternTopology(pattern);
    const incident = incidentOutlineEdges(topology, this.pointId);
    if (incident.size < 2) throw new Error('该顶点相连的轮廓边不足，无法断开');

    const leaving = this.edgeIds?.length ? this.namedLeaving(incident) : this.autoLeaving(pattern, topology, incident);
    if (leaving.size === 0 || leaving.size >= incident.size) throw new Error('断开需保留经过该顶点的部分轮廓边');

    const duplicateId = genId('pt');
    pattern.points[duplicateId] = { ...structuredClone(point), id: duplicateId };
    const touched = panelsOwningAny(pattern, leaving);
    for (const edgeId of leaving) {
      const edge = pattern.edges[edgeId];
      if (edge.startPointId === this.pointId) edge.startPointId = duplicateId;
      if (edge.endPointId === this.pointId) edge.endPointId = duplicateId;
    }
    for (const panel of touched) {
      assignClosedChains(pattern, ctx, panel, '断开');
      if (this.touches(panel.outlineEdgeIds, this.pointId, pattern) && this.touches(panel.outlineEdgeIds, duplicateId, pattern)) {
        throw new Error('所选边断开后未分离出独立轮廓');
      }
    }
  }

  private touches(ids: string[], pointId: string, pattern: Pattern): boolean {
    return ids.some(id => {
      const edge = pattern.edges[id];
      return !!edge && (edge.startPointId === pointId || edge.endPointId === pointId);
    });
  }

  private namedLeaving(incident: Set<string>): Set<string> {
    const leaving = new Set<string>();
    for (const id of this.edgeIds ?? []) {
      if (!incident.has(id)) throw new Error(`边 ${id} 未经过该顶点，无法断开`);
      leaving.add(id);
    }
    return leaving;
  }

  /** Moves every contour after the first one through the vertex: other panels or extra loops. */
  private autoLeaving(pattern: Pattern, topology: PatternTopology, incident: Set<string>): Set<string> {
    const panels = new Set<string>();
    for (const edgeId of incident) for (const panelId of topology.panelsOfEdge(edgeId)) panels.add(panelId);
    if (panels.size >= 2) {
      const keeper = [...panels][0];
      return new Set([...incident].filter(id => !topology.panelsOfEdge(id).includes(keeper)));
    }
    const panel = pattern.panels[[...panels][0]];
    const chains = closedChains(pattern, panel.outlineEdgeIds);
    if (!chains || chains.length < 2) throw new Error('该顶点只连着一条轮廓，无法断开');
    return new Set(chains.slice(1).flat().filter(id => incident.has(id)));
  }
}

/**
 * Welds two outline vertices into one so the contours that ended at them share a vertex, and
 * closes a contour whose two free ends meet there into a panel.
 */
export class ConnectPointsCommand extends SnapshotCommand {
  readonly label = '连接端点';

  constructor(private pointIdA: string, private pointIdB: string) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    const a = pattern.points[this.pointIdA];
    const b = pattern.points[this.pointIdB];
    if (!a || !b) throw new Error('端点不存在，无法连接');
    if (this.pointIdA === this.pointIdB) throw new Error('两个端点是同一个点');

    const topology = new PatternTopology(pattern);
    const edgesA = outlineEdgesOfPoint(topology, this.pointIdA);
    const edgesB = outlineEdgesOfPoint(topology, this.pointIdB);
    if (edgesA.length === 0 || edgesB.length === 0) throw new Error('端点不在任何轮廓上，无法连接');
    if (edgesA.length > 2 || edgesB.length > 2) throw new Error('端点连着多条轮廓链，不是开放端点，无法连接');
    for (const edge of Object.values(pattern.edges)) {
      const ids = [edge.startPointId, edge.endPointId];
      if (ids.includes(this.pointIdA) && ids.includes(this.pointIdB)) throw new Error('两个端点之间已有边相连，无法连接');
    }

    const touched = panelsOwningAny(pattern, edgesB);
    for (const edge of Object.values(pattern.edges)) {
      if (edge.startPointId === this.pointIdB) edge.startPointId = this.pointIdA;
      if (edge.endPointId === this.pointIdB) edge.endPointId = this.pointIdA;
    }
    for (const dart of Object.values(pattern.darts)) if (dart.tipId === this.pointIdB) dart.tipId = this.pointIdA;
    refitArcs(pattern, new Set([this.pointIdA]));
    if (a.kind === undefined) a.kind = b.kind;
    if (a.handleIn === undefined) a.handleIn = b.handleIn;
    if (a.handleOut === undefined) a.handleOut = b.handleOut;
    delete pattern.points[this.pointIdB];

    for (const panel of touched) {
      if (hasSelfIntersection(sampleOutline(pattern, panel.outlineEdgeIds))) throw new Error('连接后轮廓自相交');
      assignClosedChains(pattern, ctx, panel, '闭合');
    }
    prunePattern(pattern);
  }
}
