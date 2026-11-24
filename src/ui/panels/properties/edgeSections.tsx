import type { Command } from '@/commands';
import type { EdgeSemantic, EdgeType, Pattern, PatternEdge, Project } from '@/model/types';

import { arcSpan } from '@/base/geom/arc';
import { angleBetween2, radToDeg, sub2 } from '@/base/math';
import { SetArcParamsCommand, SetEdgeAngleCommand, SetEdgeLengthCommand } from '@/commands';
import { edgeLength } from '@/pattern/geom';
import { useProjectStore } from '@/store';
import { useElement } from '@/ui/panels/properties/elementData';
import { patchValue } from '@/ui/sceneCommands';
import { edgeLabel } from '@/ui/sceneTree';
import { NumberField } from '@/ui/widgets/numberField';
import {
  Field, Hint, PopupSelect, Row, Section, SelectRow, SliderRow,
} from '@/ui/widgets/propertyRows';
import { reportActionError } from '@/ui/widgets/toast';
import { useState } from 'react';

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
  if (!edge) return <Hint>轮廓边已删除。</Hint>;
  const pattern = project.pattern;
  const length = edgeLength(pattern, edge.id);

  const setEdge = (label: string, patch: Partial<PatternEdge>) => patchValue(
    label,
    p => p.pattern.edges[edge.id],
    (ctx, value) => { ctx.project.pattern.edges[edge.id] = { ...value }; },
    { ...edge, ...patch },
  );

  const neighbours = outlineNeighbours(pattern, edge);

  const execute = (cmd: Command) => {
    try {
      useProjectStore.getState().executeCommand(cmd);
    } catch (err) {
      reportActionError(err);
    }
  };

  return (
    <Section title="轮廓边">
      <Row label="边类型">{EDGE_TYPE_LABELS[edge.type]}</Row>
      <Row label="长度" tip="cm">
        <Field>
          <NumberField value={length} step={0.1} precision={2} min={0.01}
            onCommit={v => execute(new SetEdgeLengthCommand(edge.id, v))} />
        </Field>
      </Row>
      {edge.type === 'arc' && edge.arc && (
        <>
          <Row label="半径" tip="改动时两端点不动(cm)">
            <Field>
              <NumberField value={edge.arc.radius} step={0.1} precision={2} min={0.01}
                onCommit={v => execute(new SetArcParamsCommand(edge.id, { radiusCm: v }))} />
            </Field>
          </Row>
          <Row label="圆心角" tip="改动时两端点不动（°）">
            <Field>
              <NumberField value={radToDeg(Math.abs(arcSpan(edge.arc)))} step={0.5} precision={1} min={1} max={359}
                onCommit={v => execute(new SetArcParamsCommand(edge.id, { sweepDeg: v }))} />
            </Field>
          </Row>
        </>
      )}
      {neighbours.length > 0 && (
        <Row label="邻边夹角" tip="与参照边的夹角（°），右侧箭头可换参照边">
          <AngleRow pattern={pattern} edge={edge} neighbours={neighbours} onCommit={execute} />
        </Row>
      )}
      <SelectRow label="语义" tip="边的用途，影响缝份与对位" value={edge.semantic ?? 'free'}
        options={EDGE_SEMANTIC_OPTIONS as { value: EdgeSemantic; label: string }[]}
        onChange={v => setEdge('修改边语义', { semantic: v })} />
      <SliderRow label="缝份" tip="cm" min={0} max={2} step={0.05}
        value={edge.seamAllowanceCm ?? 0}
        commitOnRelease
        onChange={v => setEdge('修改边缝份', { seamAllowanceCm: v })} />
      <SelectRow label="角型" tip="相邻边转角处的连接方式" value={edge.cornerStyle ?? 'miter'}
        options={[{ value: 'miter', label: '尖角' }, { value: 'round', label: '圆弧' }, { value: 'bevel', label: '斜角' }]}
        onChange={v => setEdge('修改角型', { cornerStyle: v as 'miter' | 'round' | 'bevel' })} />
    </Section>
  );
}

function outlineNeighbours(pattern: Pattern, edge: PatternEdge): PatternEdge[] {
  const panel = Object.values(pattern.panels).find(p => p.outlineEdgeIds.includes(edge.id));
  if (!panel) return [];
  return panel.outlineEdgeIds
    .map(id => pattern.edges[id])
    .filter((e): e is PatternEdge => !!e && e.id !== edge.id
      && (e.startPointId === edge.startPointId || e.startPointId === edge.endPointId
        || e.endPointId === edge.startPointId || e.endPointId === edge.endPointId));
}

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
  const current = radToDeg(angleBetween2(sub2(a, at), sub2(b, at)));

  return (
    <Field>
      <NumberField value={current} step={0.5} precision={1} min={1} max={179}
        onCommit={v => onCommit(new SetEdgeAngleCommand(edge.id, referenceId, v))} />
      <PopupSelect
        value={referenceId}
        options={neighbours.map(e => ({ value: e.id, label: edgeLabel(pattern, e.id) }))}
        onChange={setReferenceId}
      />
    </Field>
  );
}
