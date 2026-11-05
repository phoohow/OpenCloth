import { useProjectStore } from '@/store';
import type { Measurement, Print, Project, Topstitch, Trim, TrimKind } from '@/model/types';
import {
  DeleteElementsCommand, DeleteMeasurementCommand, UpdatePrintCommand,
  UpdateTopstitchCommand, UpdateTrimCommand, resolveSize,
} from '@/commands';
import type { Command } from '@/commands';
import { measurementValue } from '@/pattern/geom';
import { orderedSizes } from '@/pattern/grading';
import { TRIM_KINDS, TRIM_KIND_LABELS } from '@/model';
import { elementNodeId } from '@/model';
import { edgeLabel } from '@/ui/sceneTree';
import { patchValue } from '@/ui/sceneCommands';
import {
  ButtonRow, ColorRow, Hint, Row, Section, SelectRow, SliderRow, SmallButton,
} from '@/ui/widgets/propertyRows';
import { NumberField } from '@/ui/widgets/numberField';
import { reportActionError } from '@/ui/widgets/toast';
import { styles } from '@/ui/panels/properties/styles';
import { panelOffsetCm } from '@/ui/viewport2D/panelHeight';
import { useElement, useHeightOffsets } from '@/ui/panels/properties/elementData';

/** Dimension line: the value is measured from the geometry, never stored. */
export function MeasurementData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const measurement = el?.kind === 'measurement' ? project.pattern.measurements?.[el.id] : null;
  if (!measurement) return <Hint>尺寸标注已删除。</Hint>;
  const suffix = measurement.kind === 'angle' ? '°' : ' cm';
  const digits = measurement.kind === 'angle' ? 1 : 2;
  const current = measurementValue(project.pattern, measurement);

  const setKind = (kind: Measurement['kind']) => patchValue(
    '修改标注类型',
    p => p.pattern.measurements?.[measurement.id],
    (ctx, val) => {
      const map = ctx.project.pattern.measurements;
      if (map && val) map[measurement.id] = val;
    },
    { ...measurement, kind },
  );

  /** Same reading resolved onto each chart size, for the multi-size table. */
  const perSize = orderedSizes(project).map(size => {
    const resolved = resolveSize(project.pattern, project.activeSizeId, size.id);
    const value = measurementValue(resolved, measurement);
    return { label: size.label, text: value === null ? '—' : `${value.toFixed(digits)}${suffix}` };
  });

  return (
    <Section title="尺寸标注">
      <SelectRow label="尺寸线类型" value={measurement.kind}
        options={[{ value: 'distance', label: '两点距离' }, { value: 'edgeLength', label: '边长' }, { value: 'angle', label: '角度' }]}
        onChange={v => setKind(v as Measurement['kind'])} />
      <Row label="数值">{current === null ? '参照已删除' : `${current.toFixed(digits)}${suffix}`}</Row>
      {perSize.length > 1 && perSize.map(s => <Row key={s.label} label={`各码 ${s.label}`}>{s.text}</Row>)}
      <ButtonRow>
        <SmallButton onClick={() => useProjectStore.getState().executeCommand(new DeleteMeasurementCommand(measurement.id))}>删除标注</SmallButton>
      </ButtonRow>
    </Section>
  );
}

/** Artwork print placed on a panel; the placement drives both the 2D rectangle and the 3D composite. */
export function PrintData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const print = el?.kind === 'print' ? project.pattern.prints?.[el.id] : null;
  if (!print) return <Hint>印花已删除。</Hint>;
  const panelName = project.pattern.panels[print.panelId]?.name ?? '—';

  const run = (cmd: Command) => {
    try {
      useProjectStore.getState().executeCommand(cmd);
    } catch (err) {
      reportActionError(err);
    }
  };
  const set = (patch: Partial<Omit<Print, 'id' | 'panelId'>>) => run(new UpdatePrintCommand(print.id, patch));

  return (
    <Section title="印花">
      <Row label="版片">{panelName}</Row>
      <Row label="图片">{print.imageName ?? '已载入'}</Row>
      <Row label="宽 × 高(cm)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={print.widthCm} step={0.5} precision={2} min={0.1} max={1000} title="印花宽度"
            onCommit={v => set({ widthCm: v })} />
          <NumberField value={print.heightCm} step={0.5} precision={2} min={0.1} max={1000} title="印花高度"
            onCommit={v => set({ heightCm: v })} />
        </span>
      </Row>
      <SliderRow label="角度" min={-180} max={180} step={1} unit="°" value={print.angleDeg} commitOnRelease
        onChange={v => set({ angleDeg: v })} />
      <SliderRow label="不透明度" min={0} max={1} step={0.01} value={print.opacity} commitOnRelease
        onChange={v => set({ opacity: v })} />
      <Row label="平铺(次)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={print.repeat.x} step={1} precision={0} min={1} max={50} title="横向平铺次数"
            onCommit={v => set({ repeat: { ...print.repeat, x: v } })} />
          <NumberField value={print.repeat.y} step={1} precision={0} min={1} max={50} title="纵向平铺次数"
            onCommit={v => set({ repeat: { ...print.repeat, y: v } })} />
        </span>
      </Row>
      <Row label="位置(cm)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={print.center.x} step={0.5} precision={2} title="相对版片外接框中心的横向偏移"
            onCommit={v => set({ center: { ...print.center, x: v } })} />
          <NumberField value={print.center.y} step={0.5} precision={2} title="相对版片外接框中心的纵向偏移"
            onCommit={v => set({ center: { ...print.center, y: v } })} />
        </span>
      </Row>
      <ButtonRow>
        <SmallButton onClick={() => run(new DeleteElementsCommand([elementNodeId('print', print.id)]))}>删除印花</SmallButton>
      </ButtonRow>
      <div style={styles.note}>位置相对版片外接框中心；角度逆时针为正。2D 虚线框标出印花范围，3D 按版片 UV 把图案裁进面料底色。</div>
    </Section>
  );
}

/** Decorative stitch line offset inward from one panel edge. */
export function TopstitchData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const stitch = el?.kind === 'topstitch' ? project.pattern.topstitches?.[el.id] : null;
  if (!stitch) return <Hint>明线已删除。</Hint>;
  const panelName = project.pattern.panels[stitch.panelId]?.name ?? '—';
  const edge = project.pattern.edges[stitch.edgeId];

  const run = (cmd: Command) => {
    try {
      useProjectStore.getState().executeCommand(cmd);
    } catch (err) {
      reportActionError(err);
    }
  };
  const set = (patch: Partial<Omit<Topstitch, 'id' | 'panelId' | 'edgeId'>>) =>
    run(new UpdateTopstitchCommand(stitch.id, patch));

  return (
    <Section title="明线">
      <Row label="版片">{panelName}</Row>
      <Row label="所在边">{edge ? edgeLabel(project.pattern, stitch.edgeId) : '边已删除'}</Row>
      <SliderRow label="起点" min={0} max={1} step={0.01} value={stitch.t0} commitOnRelease
        onChange={v => set({ t0: Math.min(v, stitch.t1 - 0.01) })} />
      <SliderRow label="终点" min={0} max={1} step={0.01} value={stitch.t1} commitOnRelease
        onChange={v => set({ t1: Math.max(v, stitch.t0 + 0.01) })} />
      <SliderRow label="偏移" min={0} max={20} step={0.5} unit="mm" value={stitch.offsetMm} commitOnRelease
        onChange={v => set({ offsetMm: v })} />
      <Row label="行数">
        <NumberField value={stitch.rows} step={1} precision={0} min={1} max={5} title="平行行数，逐行向版片内侧递增"
          onCommit={v => set({ rows: Math.round(v) })} />
      </Row>
      <SliderRow label="行距" min={0.5} max={20} step={0.5} unit="mm" value={stitch.spacingMm} commitOnRelease
        onChange={v => set({ spacingMm: v })} />
      <ColorRow label="线色" value={stitch.color} onChange={v => set({ color: v })} />
      <SliderRow label="针距" min={0.5} max={20} step={0.5} unit="mm" value={stitch.stitchMm} commitOnRelease
        onChange={v => set({ stitchMm: v })} />
      <SliderRow label="空距" min={0.5} max={20} step={0.5} unit="mm" value={stitch.gapMm} commitOnRelease
        onChange={v => set({ gapMm: v })} />
      <ButtonRow>
        <SmallButton onClick={() => run(new DeleteElementsCommand([elementNodeId('topstitch', stitch.id)]))}>删除明线</SmallButton>
      </ButtonRow>
      <div style={styles.note}>明线沿边向版片内侧偏移，2D 按针距与空距画虚线；同一条边可叠多行，线长按区间长度与行数计入物料清单。</div>
    </Section>
  );
}

/** Button, eyelet, rivet or snap mark recorded for the bill of materials. */
export function TrimData({ project, nodeId }: { project: Project; nodeId: string }) {
  const offsets = useHeightOffsets(project);
  const el = useElement(project, nodeId);
  const trim = el?.kind === 'trim' ? project.pattern.trims?.[el.id] : null;
  if (!trim) return <Hint>辅料已删除。</Hint>;
  const panelName = project.pattern.panels[trim.panelId]?.name ?? '—';

  const run = (cmd: Command) => {
    try {
      useProjectStore.getState().executeCommand(cmd);
    } catch (err) {
      reportActionError(err);
    }
  };
  const set = (patch: Partial<Omit<Trim, 'id' | 'panelId'>>) => run(new UpdateTrimCommand(trim.id, patch));

  return (
    <Section title="辅料">
      <Row label="版片">{panelName}</Row>
      <SelectRow label="类型" value={trim.kind}
        options={TRIM_KINDS.map(kind => ({ value: kind, label: TRIM_KIND_LABELS[kind] }))}
        onChange={v => set({ kind: v as TrimKind })} />
      <Row label="直径(mm)">
        <NumberField value={trim.sizeMm} step={0.5} precision={1} min={0.5} max={200} title="辅料直径"
          onCommit={v => set({ sizeMm: v })} />
      </Row>
      <ColorRow label="颜色" value={trim.color} onChange={v => set({ color: v })} />
      <Row label="数量">
        <NumberField value={trim.qty} step={1} precision={0} min={1} max={9999} title="这个标记代表的件数"
          onCommit={v => set({ qty: Math.round(v) })} />
      </Row>
      <Row label="单价(元)">
        <NumberField value={trim.unitPrice ?? 0} step={0.1} precision={2} min={0} title="填 0 表示不计价"
          onCommit={v => set({ unitPrice: v > 0 ? v : undefined })} />
      </Row>
      <Row label="位置(cm)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={trim.pos.x} step={0.5} precision={2} title="X 坐标"
            onCommit={v => set({ pos: { ...trim.pos, x: v } })} />
          <NumberField value={trim.pos.y + panelOffsetCm(offsets, trim.panelId)} step={0.5} precision={2}
            title="Y 坐标（离地高度）"
            onCommit={v => set({ pos: { ...trim.pos, y: v - panelOffsetCm(offsets, trim.panelId) } })} />
        </span>
      </Row>
      <ButtonRow>
        <SmallButton onClick={() => run(new DeleteElementsCommand([elementNodeId('trim', trim.id)]))}>删除辅料</SmallButton>
      </ButtonRow>
      <div style={styles.note}>辅料只在 2D 与物料清单中出现，不生成 3D 实体；数量按这个标记的件数计入，填了单价才计算金额。</div>
    </Section>
  );
}
