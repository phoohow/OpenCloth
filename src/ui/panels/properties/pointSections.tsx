import { useProjectStore, useUIStore } from '@/store';
import type { PatternPoint, Project } from '@/model/types';
import { MovePointsCommand, SetPointGradingCommand, SetPointsGradingCommand } from '@/commands';
import { gradingPasteMap, orderedSizes } from '@/pattern/grading';
import { idsOfKind } from '@/model';
import { patchValue } from '@/ui/sceneCommands';
import { Hint, Row, Section, SelectRow, SmallButton } from '@/ui/widgets/propertyRows';
import { NumberField } from '@/ui/widgets/numberField';
import { styles } from '@/ui/panels/properties/styles';
import { useElement, useHeightOffsets } from '@/ui/panels/properties/elementData';
import { pointHeightOffsetCm } from '@/ui/viewport2D/panelHeight';

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

  /** Rigid move of the point and everything hung on it. */
  const move = (delta: { x: number; y: number }) => useProjectStore.getState()
    .executeCommand(new MovePointsCommand(new Map([[point.id, delta]])));

  return (
    <Section title="点">
      <Row label="坐标(cm)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={point.pos.x} step={0.1} precision={2} title="X 坐标"
            onCommit={v => move({ x: v - point.pos.x, y: 0 })} />
          <NumberField value={point.pos.y + heightCm} step={0.1} precision={2} title="Y 坐标（离地高度）"
            onCommit={v => move({ x: 0, y: v - heightCm - point.pos.y })} />
        </span>
      </Row>
      <SelectRow label="点类型" value={point.kind ?? 'corner'}
        options={[{ value: 'corner', label: '角点' }, { value: 'smooth', label: '曲线点' }]}
        onChange={v => setPoint('修改点类型', { kind: v as 'corner' | 'smooth' })} />
      <Row label="手柄">{point.handleIn || point.handleOut ? '有' : '无'}</Row>
      <GradingRows project={project} point={point} />
    </Section>
  );
}

/** Per-size grading offsets of one point; blank when the project has no size chart. */
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

  /** Writes the copied delta onto every selected point, as one undo step. */
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
          <Row key={size.id} label={`放码 ${size.label}:cm`}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <NumberField value={delta.x} step={0.05} precision={2} title={`${size.label} X 放缩量`}
                onCommit={v => setGrade(size.id, 'x', v)} />
              <NumberField value={delta.y} step={0.05} precision={2} title={`${size.label} Y 放缩量`}
                onCommit={v => setGrade(size.id, 'y', v)} />
              <SmallButton onClick={() => setClipboard({ ...delta })} title="把这一码的放缩量放进剪贴板">复制</SmallButton>
              <SmallButton disabled={!clipboard} onClick={() => paste(size.id)}
                title="把剪贴板的放缩量写给所有选中点">粘贴</SmallButton>
            </span>
          </Row>
        );
      })}
      <div style={styles.note}>复制取的是这一行当前的 X/Y 放缩量；粘贴一次写给全部选中点，撤销一步全退。</div>
    </>
  );
}
