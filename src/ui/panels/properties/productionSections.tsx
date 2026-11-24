import type { Command } from '@/commands';
import type { Measurement, Print, Project, Topstitch, Trim, TrimKind } from '@/model/types';

import {
  UpdatePrintCommand, UpdateTopstitchCommand, UpdateTrimCommand, resolveSize,
} from '@/commands';
import {
  PRINT_REFERENCE_DPI, PRINT_SIDE_MAX_CM, PRINT_SIDE_MIN_CM, TRIM_KINDS, TRIM_KIND_LABELS,
  printAspectLocked, printResolutionDpi, printSizeFromSide, printSourceSize,
} from '@/model';
import { measurementValue } from '@/pattern/geom';
import { orderedSizes } from '@/pattern/grading';
import { panelOffsetCm } from '@/scene';
import { useProjectStore } from '@/store';
import { opacityOf, transparencyOf } from '@/ui/panels/properties/constants';
import { useElement, useHeightOffsets } from '@/ui/panels/properties/elementData';
import { patchValue } from '@/ui/sceneCommands';
import { edgeLabel } from '@/ui/sceneTree';
import { NumberField } from '@/ui/widgets/numberField';
import {
  CheckRow, ColorRow, Field, Hint, Row, Section, SelectRow, SliderRow,
} from '@/ui/widgets/propertyRows';
import { reportActionError } from '@/ui/widgets/toast';

const styles: Record<string, React.CSSProperties> = {
  coarse: { color: '#e0a040' },
};

function runCommand(cmd: Command): void {
  try {
    useProjectStore.getState().executeCommand(cmd);
  } catch (err) {
    reportActionError(err);
  }
}

function writePrint(print: Print, patch: Partial<Omit<Print, 'id' | 'panelId'>>): void {
  runCommand(new UpdatePrintCommand(print.id, patch));
}

function writeTopstitch(stitch: Topstitch, patch: Partial<Omit<Topstitch, 'id' | 'panelId' | 'edgeId'>>): void {
  runCommand(new UpdateTopstitchCommand(stitch.id, patch));
}

function writeTrim(trim: Trim, patch: Partial<Omit<Trim, 'id' | 'panelId'>>): void {
  runCommand(new UpdateTrimCommand(trim.id, patch));
}

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

  const perSize = orderedSizes(project).map(size => {
    const resolved = resolveSize(project.pattern, project.activeSizeId, size.id);
    const value = measurementValue(resolved, measurement);
    return { label: size.label, text: value === null ? '—' : `${value.toFixed(digits)}${suffix}` };
  });

  return (
    <Section title="尺寸标注">
      <SelectRow label="类型" value={measurement.kind}
        options={[{ value: 'distance', label: '两点距离' }, { value: 'edgeLength', label: '边长' }, { value: 'angle', label: '角度' }]}
        onChange={v => setKind(v as Measurement['kind'])} />
      <Row label="数值">{current === null ? '参照已删除' : `${current.toFixed(digits)}${suffix}`}</Row>
      {perSize.length > 1 && perSize.map(s => <Row key={s.label} label={`各码 ${s.label}`}>{s.text}</Row>)}
    </Section>
  );
}

export function PrintData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const print = el?.kind === 'print' ? project.pattern.prints?.[el.id] : null;
  if (!print) return <Hint>印花已删除。</Hint>;
  const panelName = project.pattern.panels[print.panelId]?.name ?? '—';
  const dpi = printResolutionDpi(print);
  const locked = printAspectLocked(print);
  const aspect = print.widthCm / Math.max(1e-6, print.heightCm);
  const source = printSourceSize(print);
  const stored = print.imageSize;
  const resampledTo = stored && source && (source.x !== stored.x || source.y !== stored.y) ? stored : null;

  const set = (patch: Partial<Omit<Print, 'id' | 'panelId'>>) => writePrint(print, patch);
  const setSize = (side: 'width' | 'height', value: number) => {
    set(printSizeFromSide(side, value, print, aspect, locked));
  };

  return (
    <Section title="印花">
      <Row label="版片">{panelName}</Row>
      <Row label="图片">{print.imageName ?? '已载入'}</Row>
      {source && (
        <Row
          label="原图"
          tip={resampledTo
            ? `源文件 ${source.x} × ${source.y} px，存入工程时缩为 ${resampledTo.x} × ${resampledTo.y} px`
            : '源图片的像素尺寸(px)，决定印花的最高精度'}
        >
          {`${source.x} × ${source.y}`}
        </Row>
      )}
      {dpi !== null && (
        <Row label="印刷精度" tip={`图案落在布面上的像素密度(dpi)，低于 ${PRINT_REFERENCE_DPI} 说明图案被放大了`}>
          <span style={dpi < PRINT_REFERENCE_DPI ? styles.coarse : undefined}>{Math.round(dpi)}</span>
        </Row>
      )}
      <Row label="宽 × 高" tip="印花图案的尺寸(cm)">
        <Field>
          <NumberField value={print.widthCm} step={0.5} precision={2}
            min={PRINT_SIDE_MIN_CM} max={PRINT_SIDE_MAX_CM} onCommit={v => setSize('width', v)} />
          <NumberField value={print.heightCm} step={0.5} precision={2}
            min={PRINT_SIDE_MIN_CM} max={PRINT_SIDE_MAX_CM} onCommit={v => setSize('height', v)} />
        </Field>
      </Row>
      <CheckRow label="固定比例" checked={locked} tip="调整尺寸时保持图案原本的宽高比；关闭后可单独改宽或高"
        onChange={v => set({ lockAspect: v })} />
      <SliderRow label="角度" tip="°" min={-180} max={180} step={1} value={print.angleDeg} commitOnRelease
        onChange={v => set({ angleDeg: v })} />
      <Row label="平铺" tip="横向 × 纵向的重复次数">
        <Field>
          <NumberField value={print.repeat.x} step={1} precision={0} min={1} max={50}
            onCommit={v => set({ repeat: { ...print.repeat, x: v } })} />
          <NumberField value={print.repeat.y} step={1} precision={0} min={1} max={50}
            onCommit={v => set({ repeat: { ...print.repeat, y: v } })} />
        </Field>
      </Row>
      <Row label="位置" tip="相对版片中心(cm)">
        <Field>
          <NumberField value={print.center.x} step={0.5} precision={2}
            onCommit={v => set({ center: { ...print.center, x: v } })} />
          <NumberField value={print.center.y} step={0.5} precision={2}
            onCommit={v => set({ center: { ...print.center, y: v } })} />
        </Field>
      </Row>
    </Section>
  );
}

export function PrintMaterialTab({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const print = el?.kind === 'print' ? project.pattern.prints?.[el.id] : null;
  if (!print) return <Hint>印花已删除。</Hint>;

  return (
    <Section title="材质">
      <SliderRow label="透明度" tip="越大越透明，0 完全不透明" min={0} max={1} step={0.01}
        value={transparencyOf(print.opacity)} commitOnRelease
        onChange={v => writePrint(print, { opacity: opacityOf(v) })} />
    </Section>
  );
}

export function TopstitchData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const stitch = el?.kind === 'topstitch' ? project.pattern.topstitches?.[el.id] : null;
  if (!stitch) return <Hint>明线已删除。</Hint>;
  const panelName = project.pattern.panels[stitch.panelId]?.name ?? '—';
  const edge = project.pattern.edges[stitch.edgeId];
  const edgeAlive = !!edge;

  const set = (patch: Partial<Omit<Topstitch, 'id' | 'panelId' | 'edgeId'>>) => writeTopstitch(stitch, patch);

  return (
    <Section title="明线">
      <Row label="版片">{panelName}</Row>
      <Row label="所在边">{edge ? edgeLabel(project.pattern, stitch.edgeId) : '边已删除'}</Row>
      <SliderRow label="起点" tip={edgeAlive ? '沿所在边的比例，0 在起点、1 在终点' : '所在边已删除，无法定位'} min={0} max={1} step={0.01} value={stitch.t0}
        commitOnRelease disabled={!edgeAlive}
        onChange={v => set({ t0: Math.min(v, stitch.t1 - 0.01) })} />
      <SliderRow label="终点" tip={edgeAlive ? '沿所在边的比例，0 在起点、1 在终点' : '所在边已删除，无法定位'} min={0} max={1} step={0.01} value={stitch.t1}
        commitOnRelease disabled={!edgeAlive}
        onChange={v => set({ t1: Math.max(v, stitch.t0 + 0.01) })} />
      <SliderRow label="偏移" tip="相对所在边向内偏移（mm）" min={0} max={20} step={0.5} value={stitch.offsetMm} commitOnRelease
        onChange={v => set({ offsetMm: v })} />
      <Row label="行数" tip="逐行向内递增">
        <Field>
          <NumberField value={stitch.rows} step={1} precision={0} min={1} max={5}
            onCommit={v => set({ rows: Math.round(v) })} />
        </Field>
      </Row>
      <SliderRow label="行距" tip="mm" min={0.5} max={20} step={0.5} value={stitch.spacingMm} commitOnRelease
        onChange={v => set({ spacingMm: v })} />
      <SliderRow label="针距" tip="mm" min={0.5} max={20} step={0.5} value={stitch.stitchMm} commitOnRelease
        onChange={v => set({ stitchMm: v })} />
      <SliderRow label="空距" tip="两针之间的空白（mm）" min={0.5} max={20} step={0.5} value={stitch.gapMm} commitOnRelease
        onChange={v => set({ gapMm: v })} />
    </Section>
  );
}

export function TopstitchMaterialTab({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const stitch = el?.kind === 'topstitch' ? project.pattern.topstitches?.[el.id] : null;
  if (!stitch) return <Hint>明线已删除。</Hint>;

  return (
    <Section title="材质">
      <ColorRow label="颜色" value={stitch.color} onChange={v => writeTopstitch(stitch, { color: v })} />
    </Section>
  );
}

export function TrimData({ project, nodeId }: { project: Project; nodeId: string }) {
  const offsets = useHeightOffsets(project);
  const el = useElement(project, nodeId);
  const trim = el?.kind === 'trim' ? project.pattern.trims?.[el.id] : null;
  if (!trim) return <Hint>辅料已删除。</Hint>;
  const panelName = project.pattern.panels[trim.panelId]?.name ?? '—';

  const set = (patch: Partial<Omit<Trim, 'id' | 'panelId'>>) => writeTrim(trim, patch);

  return (
    <Section title="辅料">
      <Row label="版片">{panelName}</Row>
      <SelectRow label="类型" value={trim.kind}
        options={TRIM_KINDS.map(kind => ({ value: kind, label: TRIM_KIND_LABELS[kind] }))}
        onChange={v => set({ kind: v as TrimKind })} />
      <Row label="直径" tip="mm">
        <Field>
          <NumberField value={trim.sizeMm} step={0.5} precision={1} min={0.5} max={200}
            onCommit={v => set({ sizeMm: v })} />
        </Field>
      </Row>
      <Row label="数量" tip="计入 BOM 的件数">
        <Field>
          <NumberField value={trim.qty} step={1} precision={0} min={1} max={9999}
            onCommit={v => set({ qty: Math.round(v) })} />
        </Field>
      </Row>
      <Row label="单价" tip="填 0 表示不计价">
        <Field>
          <NumberField value={trim.unitPrice ?? 0} step={0.1} precision={2} min={0}
            onCommit={v => set({ unitPrice: v > 0 ? v : undefined })} />
        </Field>
      </Row>
      <Row label="位置" tip="X 为水平位置，Y 为离地高度(cm)">
        <Field>
          <NumberField value={trim.pos.x} step={0.5} precision={2}
            onCommit={v => set({ pos: { ...trim.pos, x: v } })} />
          <NumberField value={trim.pos.y + panelOffsetCm(offsets, trim.panelId)} step={0.5} precision={2}
            onCommit={v => set({ pos: { ...trim.pos, y: v - panelOffsetCm(offsets, trim.panelId) } })} />
        </Field>
      </Row>
    </Section>
  );
}

export function TrimMaterialTab({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const trim = el?.kind === 'trim' ? project.pattern.trims?.[el.id] : null;
  if (!trim) return <Hint>辅料已删除。</Hint>;

  return (
    <Section title="材质">
      <ColorRow label="颜色" value={trim.color} onChange={v => writeTrim(trim, { color: v })} />
    </Section>
  );
}
