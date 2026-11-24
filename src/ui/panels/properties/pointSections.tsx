import type { PatternPoint, Project } from '@/model/types';

import { MovePointsCommand, SetPointGradingCommand, SetPointsGradingCommand } from '@/commands';
import { idsOfKind } from '@/model';
import { gradingPasteMap, orderedSizes } from '@/pattern/grading';
import { pointHeightOffsetCm } from '@/scene';
import { useProjectStore, useUIStore } from '@/store';
import { useElement, useHeightOffsets } from '@/ui/panels/properties/elementData';
import { patchValue } from '@/ui/sceneCommands';
import { NumberField } from '@/ui/widgets/numberField';
import { Field, Hint, IconButton, Row, Section, SelectRow } from '@/ui/widgets/propertyRows';

const styles: Record<string, React.CSSProperties> = {
  gradeRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
    minHeight: 'var(--oc-h-row)', fontSize: 'var(--oc-fs-micro)',
  },
  gradeLabel: { color: '#999', flex: '0 0 auto', whiteSpace: 'nowrap' },
};

export function PointData({ project, nodeId }: { project: Project; nodeId: string }) {
  const offsets = useHeightOffsets(project);
  const el = useElement(project, nodeId);
  const point = el?.kind === 'point' ? project.pattern.points[el.id] : null;
  if (!point) return <Hint>点已删除。</Hint>;
  const heightCm = pointHeightOffsetCm(project.pattern, point.id, offsets);

  const setPoint = (label: string, patch: Partial<PatternPoint>) => patchValue(
    label,
    p => p.pattern.points[point.id],
    (ctx, value) => { ctx.project.pattern.points[point.id] = { ...value }; },
    { ...point, ...patch },
  );

  const move = (delta: { x: number; y: number }) => useProjectStore.getState()
    .executeCommand(new MovePointsCommand(new Map([[point.id, delta]])));

  return (
    <Section title="顶点">
      <Row label="坐标" tip="X 为水平位置，Y 为离地高度(cm)">
        <Field>
          <NumberField value={point.pos.x} step={0.1} precision={2}
            onCommit={v => move({ x: v - point.pos.x, y: 0 })} />
          <NumberField value={point.pos.y + heightCm} step={0.1} precision={2}
            onCommit={v => move({ x: 0, y: v - heightCm - point.pos.y })} />
        </Field>
      </Row>
      <SelectRow label="类型" tip="角点保持折角，曲线点带可调手柄" value={point.kind ?? 'corner'}
        options={[{ value: 'corner', label: '角点' }, { value: 'smooth', label: '曲线点' }]}
        onChange={v => setPoint('修改点类型', { kind: v as 'corner' | 'smooth' })} />
      <Row label="手柄">{point.handleIn || point.handleOut ? '有' : '无'}</Row>
      <GradingRows project={project} point={point} />
    </Section>
  );
}

function GradingRows({ project, point }: { project: Project; point: PatternPoint }) {
  const sizes = orderedSizes(project).filter(s => !s.isBase);
  const selection = useUIStore(s => s.selection);
  const clipboard = useUIStore(s => s.gradingClipboard);
  const setClipboard = useUIStore(s => s.setGradingClipboard);
  if (sizes.length === 0) return null;

  const setGrade = (sizeId: string, axis: 'x' | 'y', value: number) => {
    const current = point.grading?.[sizeId] ?? { x: 0, y: 0 };
    useProjectStore.getState().executeCommand(
      new SetPointGradingCommand(point.id, sizeId, { ...current, [axis]: value }),
    );
  };

  const paste = (sizeId: string) => {
    if (!clipboard) return;
    const map = gradingPasteMap(project.pattern, sizeId, clipboard, idsOfKind(selection, 'point'), point.id);
    useProjectStore.getState().executeCommand(new SetPointsGradingCommand(map));
  };

  return (
    <>
      {sizes.map(size => {
        const delta = point.grading?.[size.id] ?? { x: 0, y: 0 };
        return (
          <div key={size.id} style={styles.gradeRow} title={`${size.label} 码相对基码的放缩量(cm)`}>
            <span style={styles.gradeLabel}>{`放码 ${size.label}`}</span>
            <Field>
              <NumberField value={delta.x} step={0.05} precision={2}
                onCommit={v => setGrade(size.id, 'x', v)} />
              <NumberField value={delta.y} step={0.05} precision={2}
                onCommit={v => setGrade(size.id, 'y', v)} />
            </Field>
            <IconButton title="复制这一码的放缩量" onClick={() => setClipboard({ ...delta })}>复</IconButton>
            <IconButton title="粘贴到所有选中点" disabled={!clipboard} onClick={() => paste(size.id)}>贴</IconButton>
          </div>
        );
      })}
    </>
  );
}
