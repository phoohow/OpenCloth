import { useProjectStore, useUIStore } from '@/store';
import type { Annotation, Dart, InternalLine, Notch, Project } from '@/model/types';
import {
  DeleteAnnotationCommand, DeleteNotchCommand, TransferDartCommand,
} from '@/commands';
import { idsOfKind } from '@/model';
import { patchValue } from '@/ui/sceneCommands';
import {
  ButtonRow, CheckRow, Hint, Row, Section, SelectRow, SliderRow, SmallButton, TextRow,
} from '@/ui/widgets/propertyRows';
import { reportActionError } from '@/ui/widgets/toast';
import { panelOffsetCm, pointHeightOffsetCm } from '@/ui/viewport2D/panelHeight';
import { useElement, useHeightOffsets } from '@/ui/panels/properties/elementData';
import { EDGE_TYPE_LABELS } from '@/ui/panels/properties/edgeSections';

export function InternalLineData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const line = el?.kind === 'internal' ? project.pattern.internalLines[el.id] : null;
  if (!line) return <Hint>内部线已删除。</Hint>;

  const setLine = (label: string, patch: Partial<InternalLine>) => patchValue(
    label,
    p => p.pattern.internalLines[line.id],
    (ctx, value) => { ctx.project.pattern.internalLines[line.id] = { ...value }; },
    { ...line, ...patch },
  );

  return (
    <Section title="内部线">
      <SelectRow label="用途" value={line.kind}
        options={[{ value: 'split', label: '分割线' }, { value: 'fold', label: '折痕' }, { value: 'decor', label: '装饰线' }]}
        onChange={v => setLine('修改内部线用途', { kind: v as 'split' | 'fold' | 'decor' })} />
      <Row label="点数">{line.points.length}</Row>
    </Section>
  );
}

export function DartData({ project, nodeId }: { project: Project; nodeId: string }) {
  const offsets = useHeightOffsets(project);
  const el = useElement(project, nodeId);
  const dart = el?.kind === 'dart' ? project.pattern.darts[el.id] : null;
  if (!dart) return <Hint>省道已删除。</Hint>;

  const setDart = (label: string, patch: Partial<Dart>) => patchValue(
    label,
    p => p.pattern.darts[dart.id],
    (ctx, value) => { ctx.project.pattern.darts[dart.id] = { ...value }; },
    { ...dart, ...patch },
  );

  return (
    <Section title="省道">
      <SliderRow label="省量" min={0.5} max={6} step={0.1} unit="cm" value={dart.intakeCm} commitOnRelease
        onChange={v => setDart('修改省量', { intakeCm: v })} />
      <CheckRow label="收省（模拟时缝合省边）" checked={!!dart.closing}
        onChange={v => setDart(v ? '闭合省道' : '打开省道', { closing: v })} />
      <Row label="省尖(cm)">{(() => {
        const tip = project.pattern.points[dart.tipId];
        if (!tip) return '—';
        const y = tip.pos.y + pointHeightOffsetCm(project.pattern, tip.id, offsets);
        return `${tip.pos.x.toFixed(1)}, ${y.toFixed(1)}`;
      })()}</Row>
      <ButtonRow>
        <SmallButton
          title="先选中一条轮廓边，再把省道转移到该边"
          onClick={() => {
            const target = idsOfKind(useUIStore.getState().selection, 'edge')[0];
            if (!target || !project.pattern.edges[target]) {
              reportActionError(new Error('请先选中一条轮廓边'));
              return;
            }
            useProjectStore.getState().executeCommand(new TransferDartCommand(dart.id, target, 0.5));
          }}
        >转移到选中边</SmallButton>
      </ButtonRow>
    </Section>
  );
}

/** Edge-relative production mark: position, width and glyph style. */
export function NotchData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const notch = el?.kind === 'notch' ? project.pattern.notches?.[el.id] : null;
  if (!notch) return <Hint>刀口已删除。</Hint>;
  const edge = project.pattern.edges[notch.edgeId];

  const setNotch = (label: string, patch: Partial<Notch>) => patchValue(
    label,
    p => p.pattern.notches?.[notch.id],
    (ctx, value) => {
      const map = ctx.project.pattern.notches;
      if (map && value) map[notch.id] = value;
    },
    { ...notch, ...patch },
  );

  return (
    <Section title="刀口">
      <Row label="所在边">{edge ? `${EDGE_TYPE_LABELS[edge.type]} ${notch.edgeId}` : '边已删除'}</Row>
      <SliderRow label="位置" min={0} max={1} step={0.01} value={notch.t} commitOnRelease
        onChange={v => setNotch('移动刀口', { t: v })} />
      <SliderRow label="宽度" min={1} max={10} step={0.5} unit="mm" value={notch.widthMm ?? 3} commitOnRelease
        onChange={v => setNotch('修改刀口宽度', { widthMm: v })} />
      <SelectRow label="样式" value={notch.style ?? 'v'}
        options={[{ value: 'v', label: 'V 形' }, { value: 't', label: 'T 形' }, { value: 'drill', label: '钻孔' }]}
        onChange={v => setNotch('修改刀口样式', { style: v as Notch['style'] })} />
      <ButtonRow>
        <SmallButton onClick={() => useProjectStore.getState().executeCommand(new DeleteNotchCommand(notch.id))}>删除刀口</SmallButton>
      </ButtonRow>
    </Section>
  );
}

/** Free text note carried on a panel. */
export function AnnotationData({ project, nodeId }: { project: Project; nodeId: string }) {
  const offsets = useHeightOffsets(project);
  const el = useElement(project, nodeId);
  const note = el?.kind === 'annotation' ? project.pattern.annotations?.[el.id] : null;
  if (!note) return <Hint>注释已删除。</Hint>;

  const setNote = (label: string, patch: Partial<Annotation>) => patchValue(
    label,
    p => p.pattern.annotations?.[note.id],
    (ctx, value) => {
      const map = ctx.project.pattern.annotations;
      if (map && value) map[note.id] = value;
    },
    { ...note, ...patch },
  );

  return (
    <Section title="注释">
      <TextRow label="文字" value={note.text} onChange={v => setNote('修改注释文字', { text: v })} />
      <SliderRow label="角度" min={-180} max={180} step={1} unit="°" value={note.angleDeg ?? 0} commitOnRelease
        onChange={v => setNote('修改注释角度', { angleDeg: v })} />
      <SliderRow label="字号" min={2} max={12} step={0.5} unit="mm" value={note.sizeMm ?? 4} commitOnRelease
        onChange={v => setNote('修改注释字号', { sizeMm: v })} />
      <Row label="坐标(cm)">{`${note.pos.x.toFixed(2)}, ${(note.pos.y + panelOffsetCm(offsets, note.panelId)).toFixed(2)}`}</Row>
      <ButtonRow>
        <SmallButton onClick={() => useProjectStore.getState().executeCommand(new DeleteAnnotationCommand(note.id))}>删除注释</SmallButton>
      </ButtonRow>
    </Section>
  );
}
