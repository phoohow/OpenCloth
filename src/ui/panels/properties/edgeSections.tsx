import { useState } from 'react';
import { useProjectStore } from '@/store';
import type { EdgeSemantic, EdgeType, Pattern, PatternEdge, Project } from '@/model/types';
import { SetArcParamsCommand, SetEdgeAngleCommand, SetEdgeLengthCommand } from '@/commands';
import type { Command } from '@/commands';
import { edgeLength } from '@/pattern/geom';
import { arcSpan } from '@/common/geom/arc';
import { patchValue } from '@/ui/sceneCommands';
import { edgeLabel } from '@/ui/sceneTree';
import {
  Hint, PopupSelect, Row, Section, SelectRow, SliderRow,
} from '@/ui/widgets/propertyRows';
import { NumberField } from '@/ui/widgets/numberField';
import { reportActionError } from '@/ui/widgets/toast';
import { useElement } from '@/ui/panels/properties/elementData';

export const EDGE_TYPE_LABELS: Record<EdgeType, string> = { line: '直线', bezier: '曲线', arc: '圆弧' };

const EDGE_SEMANTIC_OPTIONS = [
  { value: 'free', label: '自由边' }, { value: 'hem', label: '脚口' }, { value: 'neckline', label: '领口' },
  { value: 'armhole', label: '袖窿' }, { value: 'sideSeam', label: '侧缝' }, { value: 'shoulder', label: '肩线' },
  { value: 'sleeveCap', label: '袖山' }, { value: 'waist', label: '腰节' }, { value: 'dart', label: '省道' },
  { value: 'internal', label: '内部' },
];

export function EdgeData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const edge = el?.kind === 'edge' ? project.pattern.edges[el.id] : null;
  if (!edge) return <Hint>边已删除。</Hint>;
  const pattern = project.pattern;
  const length = edgeLength(pattern, edge.id);

  const setEdge = (label: string, patch: Partial<PatternEdge>) => patchValue(
    label,
    p => p.pattern.edges[edge.id],
    (ctx, value) => { ctx.project.pattern.edges[edge.id] = { ...value }; },
    { ...edge, ...patch },
  );

  /** Outline edges sharing a vertex with this one, as angle references. */
  const neighbours = outlineNeighbours(pattern, edge);

  const execute = (cmd: Command) => {
    try {
      useProjectStore.getState().executeCommand(cmd);
    } catch (err) {
      reportActionError(err);
    }
  };

  return (
    <Section title="边">
      <Row label="边类型">{EDGE_TYPE_LABELS[edge.type]}</Row>
      <Row label="长度(cm)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={length} step={0.1} precision={2} min={0.01} title="目标边长；只移动终点"
            onCommit={v => execute(new SetEdgeLengthCommand(edge.id, v))} />
        </span>
      </Row>
      {edge.type === 'arc' && edge.arc && (
        <>
          <Row label="半径(cm)">
            <NumberField value={edge.arc.radius} step={0.1} precision={2} min={0.01} title="圆弧半径；两端点保持不动"
              onCommit={v => execute(new SetArcParamsCommand(edge.id, { radiusCm: v }))} />
          </Row>
          <Row label="圆心角(°)">
            <NumberField value={Math.abs(arcSpan(edge.arc)) * 180 / Math.PI} step={0.5} precision={1} min={1} max={359} title="圆心角；两端点保持不动"
              onCommit={v => execute(new SetArcParamsCommand(edge.id, { sweepDeg: v }))} />
          </Row>
        </>
      )}
      {neighbours.length > 0 && (
        <Row label="与邻边夹角(°)">
          <AngleRow pattern={pattern} edge={edge} neighbours={neighbours} onCommit={execute} />
        </Row>
      )}
      <SelectRow label="语义" value={edge.semantic ?? 'free'}
        options={EDGE_SEMANTIC_OPTIONS as { value: EdgeSemantic; label: string }[]}
        onChange={v => setEdge('修改边语义', { semantic: v })} />
      <SliderRow label="缝份（此边）" min={0} max={2} step={0.05} unit="cm"
        value={edge.seamAllowanceCm ?? 0}
        commitOnRelease
        onChange={v => setEdge('修改边缝份', { seamAllowanceCm: v })} />
      <SelectRow label="角型" value={edge.cornerStyle ?? 'miter'}
        options={[{ value: 'miter', label: '尖角' }, { value: 'round', label: '圆弧' }, { value: 'bevel', label: '斜角' }]}
        onChange={v => setEdge('修改角型', { cornerStyle: v as 'miter' | 'round' | 'bevel' })} />
    </Section>
  );
}

/** Outline edges of the same panel that meet this edge at one of its vertices. */
function outlineNeighbours(pattern: Pattern, edge: PatternEdge): PatternEdge[] {
  const panel = Object.values(pattern.panels).find(p => p.outlineEdgeIds.includes(edge.id));
  if (!panel) return [];
  return panel.outlineEdgeIds
    .map(id => pattern.edges[id])
    .filter((e): e is PatternEdge => !!e && e.id !== edge.id
      && (e.startPointId === edge.startPointId || e.startPointId === edge.endPointId
        || e.endPointId === edge.startPointId || e.endPointId === edge.endPointId));
}

/** Reference-edge picker plus the target angle, dispatched as SetEdgeAngleCommand. */
function AngleRow({ pattern, edge, neighbours, onCommit }: {
  pattern: Pattern;
  edge: PatternEdge;
  neighbours: PatternEdge[];
  onCommit: (cmd: Command) => void;
}) {
  const [referenceId, setReferenceId] = useState(neighbours[0]!.id);
  const reference = neighbours.find(e => e.id === referenceId) ?? neighbours[0]!;
  const sharedId = reference.startPointId === edge.startPointId || reference.endPointId === edge.startPointId
    ? edge.startPointId
    : edge.endPointId;
  const at = pattern.points[sharedId]!.pos;
  const from = (e: PatternEdge): string => (e.startPointId === sharedId ? e.endPointId : e.startPointId);
  const a = pattern.points[from(edge)]!.pos;
  const b = pattern.points[from(reference)]!.pos;
  const current = Math.abs(((Math.atan2(a.y - at.y, a.x - at.x) - Math.atan2(b.y - at.y, b.x - at.x)) * 180 / Math.PI + 540) % 360 - 180);

  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <PopupSelect
        value={referenceId}
        options={neighbours.map(e => ({ value: e.id, label: edgeLabel(pattern, e.id) }))}
        onChange={setReferenceId}
        title="作为角度参照的邻边"
      />
      <NumberField value={current} step={0.5} precision={1} min={1} max={179} title="输入目标夹角"
        onCommit={v => onCommit(new SetEdgeAngleCommand(edge.id, referenceId, v))} />
    </span>
  );
}
