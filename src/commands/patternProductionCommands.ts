import type { Command, ProjectContext } from '@/commands/command';
import type {
  Annotation, Measurement, MeasurementRefs, Notch, Pattern, Print, Project, SizeDef, Topstitch,
  Trim, TrimKind, Vec2,
} from '@/model/types';

import { genId } from '@/base/id';
import { SnapshotCommand } from '@/commands/patternSnapshot';
import { inferCollisionLayers } from '@/garment';
import { PRINT_SIDE_MAX_CM, PRINT_SIDE_MIN_CM } from '@/model';

export interface AnnotationOptions {
  angleDeg?: number;
  sizeMm?: number;
}

export interface PrintOptions {
  imageName?: string;
  imageSize?: Vec2;
  sourceSize?: Vec2;
  center?: Vec2;
  widthCm?: number;
  heightCm?: number;
  angleDeg?: number;
  opacity?: number;
  repeat?: Vec2;
}

export interface TopstitchOptions {
  t0?: number;
  t1?: number;
  offsetMm?: number;
  spacingMm?: number;
  rows?: number;
  color?: string;
  stitchMm?: number;
  gapMm?: number;
}

export interface TrimOptions {
  name?: string;
  sizeMm?: number;
  color?: string;
  qty?: number;
  unitPrice?: number;
}

export class AutoAssignCollisionLayersCommand extends SnapshotCommand {
  readonly label = '自动识别碰撞层';
  constructor() { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const layers = inferCollisionLayers(pattern);
    for (const panel of Object.values(pattern.panels)) {
      const layer = layers.get(panel.id);
      if (layer !== undefined && panel.collisionLayer !== layer) panel.collisionLayer = layer;
    }
  }
}

export class SetPanelGrainCommand extends SnapshotCommand {
  readonly label = '设置布纹方向';

  constructor(
    private panelId: string,
    private angleDeg: number,
    private offset?: Vec2,
    private lengthCm?: number,
  ) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    if (!(this.angleDeg >= -180) || !(this.angleDeg <= 180)) throw new Error('布纹角度需在 -180°~180° 之间');
    if (this.lengthCm !== undefined && this.lengthCm < 0) throw new Error('布纹线长度需为正数');
    panel.grainAngleDeg = this.angleDeg;
    if (this.offset) {
      if (this.offset.x === 0 && this.offset.y === 0) delete panel.grainOffset;
      else panel.grainOffset = { x: this.offset.x, y: this.offset.y };
    }

    if (this.lengthCm !== undefined) {
      if (this.lengthCm === 0) delete panel.grainLengthCm;
      else panel.grainLengthCm = this.lengthCm;
    }
  }
}

export class CreateNotchCommand extends SnapshotCommand {
  readonly label = '创建刀口';
  constructor(private edgeId: string, private t: number, private widthMm?: number, private style?: Notch['style']) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.edges[this.edgeId]) throw new Error('边不存在');
    if (!(this.t >= 0 && this.t <= 1)) throw new Error('刀口位置需在该边范围内');
    const id = genId('notch');
    const notch: Notch = { id, edgeId: this.edgeId, t: this.t, ...(this.widthMm !== undefined ? { widthMm: this.widthMm } : {}), ...(this.style ? { style: this.style } : {}) };
    (pattern.notches ??= {})[id] = notch;
  }
}

export class MoveNotchCommand extends SnapshotCommand {
  readonly label = '移动刀口';
  constructor(private notchId: string, private t: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const notch = pattern.notches?.[this.notchId];
    if (!notch) throw new Error('刀口不存在');
    if (!(this.t >= 0 && this.t <= 1)) throw new Error('刀口位置需在该边范围内');
    notch.t = this.t;
  }
}

export class CreateAnnotationCommand extends SnapshotCommand {
  readonly label = '创建标注';
  constructor(private panelId: string, private text: string, private pos: Vec2, private opts: AnnotationOptions = {}) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.panels[this.panelId]) throw new Error('版片不存在');
    const id = genId('note');
    const annotation: Annotation = {
      id, panelId: this.panelId, text: this.text, pos: { x: this.pos.x, y: this.pos.y },
      ...(this.opts.angleDeg !== undefined ? { angleDeg: this.opts.angleDeg } : {}),
      ...(this.opts.sizeMm !== undefined ? { sizeMm: this.opts.sizeMm } : {}),
    };
    (pattern.annotations ??= {})[id] = annotation;
  }
}

export class CreateMeasurementCommand extends SnapshotCommand {
  readonly label = '创建尺寸标注';
  constructor(private kind: Measurement['kind'], private refs: MeasurementRefs, private panelId?: string) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const id = genId('meas');
    pattern.measurements ??= {};
    pattern.measurements[id] = {
      id,
      panelId: this.panelId ?? panelForRefs(pattern, this.refs),
      kind: this.kind,
      refs: { ...this.refs },
    };
  }
}

function panelForRefs(pattern: Pattern, refs: MeasurementRefs): string {
  if (refs.edgeId) {
    const edge = pattern.edges[refs.edgeId];
    if (edge) {
      for (const panel of Object.values(pattern.panels)) {
        if (panel.outlineEdgeIds.includes(edge.id)) return panel.id;
      }
    }
  }

  for (const pointId of [refs.pointAId, refs.pointBId]) {
    if (!pointId) continue;
    for (const edge of Object.values(pattern.edges)) {
      if (edge.startPointId !== pointId && edge.endPointId !== pointId) continue;
      for (const panel of Object.values(pattern.panels)) {
        if (panel.outlineEdgeIds.includes(edge.id)) return panel.id;
      }
    }
  }

  return Object.keys(pattern.panels)[0] ?? '';
}

function panelOwnsEdge(pattern: Pattern, panelId: string, edgeId: string): boolean {
  const panel = pattern.panels[panelId];
  if (!panel) return false;
  return panel.outlineEdgeIds.includes(edgeId) || (panel.holes ?? []).some(loop => loop.includes(edgeId));
}

function checkRange(value: number, min: number, max: number, message: string): void {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(message);
}

export class AddPrintCommand extends SnapshotCommand {
  readonly label = '添加印花';
  constructor(private panelId: string, private imageUrl: string, private opts: PrintOptions = {}) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.panels[this.panelId]) throw new Error('版片不存在');
    if (!this.imageUrl) throw new Error('印花图片为空');
    const widthCm = this.opts.widthCm ?? 20;
    const heightCm = this.opts.heightCm ?? 20;
    checkRange(widthCm, PRINT_SIDE_MIN_CM, PRINT_SIDE_MAX_CM, '印花宽度需为正数');
    checkRange(heightCm, PRINT_SIDE_MIN_CM, PRINT_SIDE_MAX_CM, '印花高度需为正数');
    const repeat = this.opts.repeat ?? { x: 1, y: 1 };
    checkRange(repeat.x, 1, 50, '印花横向平铺次数需在 1~50 之间');
    checkRange(repeat.y, 1, 50, '印花纵向平铺次数需在 1~50 之间');
    const center = this.opts.center ?? { x: 0, y: 0 };
    const id = genId('print');
    (pattern.prints ??= {})[id] = {
      id,
      panelId: this.panelId,
      imageUrl: this.imageUrl,
      ...(this.opts.imageName ? { imageName: this.opts.imageName } : {}),
      ...(this.opts.imageSize ? { imageSize: { x: this.opts.imageSize.x, y: this.opts.imageSize.y } } : {}),
      ...(this.opts.sourceSize ? { sourceSize: { x: this.opts.sourceSize.x, y: this.opts.sourceSize.y } } : {}),
      center: { x: center.x, y: center.y },
      widthCm,
      heightCm,
      lockAspect: true,
      angleDeg: this.opts.angleDeg ?? 0,
      opacity: this.opts.opacity ?? 1,
      repeat: { x: repeat.x, y: repeat.y },
      visible: true,
    };
  }
}

export class UpdatePrintCommand extends SnapshotCommand {
  readonly label = '修改印花';
  constructor(private printId: string, private patch: Partial<Omit<Print, 'id' | 'panelId'>>) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const print = pattern.prints?.[this.printId];
    if (!print) throw new Error('印花不存在');
    const next = { ...print, ...this.patch, center: { ...print.center }, repeat: { ...print.repeat } };
    checkRange(next.widthCm, PRINT_SIDE_MIN_CM, PRINT_SIDE_MAX_CM, '印花宽度需为正数');
    checkRange(next.heightCm, PRINT_SIDE_MIN_CM, PRINT_SIDE_MAX_CM, '印花高度需为正数');
    checkRange(next.opacity, 0, 1, '印花透明度需在 0~1 之间');
    checkRange(next.repeat.x, 1, 50, '印花横向平铺次数需在 1~50 之间');
    checkRange(next.repeat.y, 1, 50, '印花纵向平铺次数需在 1~50 之间');
    if (this.patch.center) next.center = { ...this.patch.center };
    if (this.patch.repeat) next.repeat = { ...this.patch.repeat };
    Object.assign(print, next);
  }
}

export class AddTopstitchCommand extends SnapshotCommand {
  readonly label = '添加明线';
  constructor(private panelId: string, private edgeId: string, private opts: TopstitchOptions = {}) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.panels[this.panelId]) throw new Error('版片不存在');
    if (!pattern.edges[this.edgeId]) throw new Error('边不存在');
    if (!panelOwnsEdge(pattern, this.panelId, this.edgeId)) throw new Error('该边不属于所选版片');
    const t0 = this.opts.t0 ?? 0;
    const t1 = this.opts.t1 ?? 1;
    checkRange(t0, 0, 1, '明线起点需在边范围内');
    checkRange(t1, 0, 1, '明线终点需在边范围内');
    if (t1 - t0 < 1e-4) throw new Error('明线区间为空');
    const rows = this.opts.rows ?? 1;
    checkRange(rows, 1, 5, '明线行数需在 1~5 之间');
    checkRange(this.opts.offsetMm ?? 3, 0, 100, '明线偏移需在 0~100 mm 之间');
    checkRange(this.opts.spacingMm ?? 4, 0.5, 50, '明线行距需为正数');
    checkRange(this.opts.stitchMm ?? 3, 0.5, 20, '明线针距需为正数');
    checkRange(this.opts.gapMm ?? 2, 0.5, 20, '明线空距需为正数');
    const id = genId('topstitch');
    (pattern.topstitches ??= {})[id] = {
      id,
      panelId: this.panelId,
      edgeId: this.edgeId,
      t0,
      t1,
      offsetMm: this.opts.offsetMm ?? 3,
      spacingMm: this.opts.spacingMm ?? 4,
      rows: Math.round(rows),
      color: this.opts.color ?? '#d9a441',
      stitchMm: this.opts.stitchMm ?? 3,
      gapMm: this.opts.gapMm ?? 2,
      visible: true,
    };
  }
}

export class UpdateTopstitchCommand extends SnapshotCommand {
  readonly label = '修改明线';
  constructor(private topstitchId: string, private patch: Partial<Omit<Topstitch, 'id' | 'panelId' | 'edgeId'>>) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const stitch = pattern.topstitches?.[this.topstitchId];
    if (!stitch) throw new Error('明线不存在');
    const next = { ...stitch, ...this.patch };
    checkRange(next.t0, 0, 1, '明线起点需在边范围内');
    checkRange(next.t1, 0, 1, '明线终点需在边范围内');
    if (next.t1 - next.t0 < 1e-4) throw new Error('明线区间为空');
    checkRange(next.rows, 1, 5, '明线行数需在 1~5 之间');
    checkRange(next.offsetMm, 0, 100, '明线偏移需在 0~100 mm 之间');
    checkRange(next.spacingMm, 0.5, 50, '明线行距需为正数');
    checkRange(next.stitchMm, 0.5, 20, '明线针距需为正数');
    checkRange(next.gapMm, 0.5, 20, '明线空距需为正数');
    next.rows = Math.round(next.rows);
    Object.assign(stitch, next);
  }
}

export class AddTrimCommand extends SnapshotCommand {
  readonly label = '添加辅料';
  constructor(private panelId: string, private kind: TrimKind, private pos: Vec2, private opts: TrimOptions = {}) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.panels[this.panelId]) throw new Error('版片不存在');
    const sizeMm = this.opts.sizeMm ?? 12;
    checkRange(sizeMm, 0.5, 200, '辅料直径需为正数');
    const qty = this.opts.qty ?? 1;
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw new Error('辅料数量需为 1~9999 的整数');
    if (this.opts.unitPrice !== undefined) checkRange(this.opts.unitPrice, 0, 1e6, '辅料单价需为非负数');
    const id = genId('trim');
    (pattern.trims ??= {})[id] = {
      id,
      panelId: this.panelId,
      kind: this.kind,
      pos: { x: this.pos.x, y: this.pos.y },
      sizeMm,
      color: this.opts.color ?? '#b08d57',
      qty,
      ...(this.opts.unitPrice !== undefined ? { unitPrice: this.opts.unitPrice } : {}),
      ...(this.opts.name ? { name: this.opts.name } : {}),
      visible: true,
    };
  }
}

export class UpdateTrimCommand extends SnapshotCommand {
  readonly label = '修改辅料';
  constructor(private trimId: string, private patch: Partial<Omit<Trim, 'id' | 'panelId'>>) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const trim = pattern.trims?.[this.trimId];
    if (!trim) throw new Error('辅料不存在');
    const next = { ...trim, ...this.patch, pos: { ...trim.pos } };
    checkRange(next.sizeMm, 0.5, 200, '辅料直径需为正数');
    if (!Number.isInteger(next.qty) || next.qty < 1 || next.qty > 9999) throw new Error('辅料数量需为 1~9999 的整数');
    if (next.unitPrice !== undefined) checkRange(next.unitPrice, 0, 1e6, '辅料单价需为非负数');
    if (this.patch.pos) next.pos = { ...this.patch.pos };
    Object.assign(trim, next);
  }
}

abstract class SizeCommand implements Command {
  abstract readonly label: string;
  private snapshot: { sizes?: SizeDef[]; activeSizeId?: string } | null = null;
  protected abstract apply(project: Project): void;
  execute(ctx: ProjectContext): void {
    this.snapshot = {
      sizes: structuredClone(ctx.project.sizes ?? []),
      activeSizeId: ctx.project.activeSizeId,
    };
    this.apply(ctx.project);
  }

  undo(ctx: ProjectContext): void {
    if (!this.snapshot) return;
    ctx.project.sizes = this.snapshot.sizes;
    ctx.project.activeSizeId = this.snapshot.activeSizeId;
    this.snapshot = null;
  }
}

function ensureSizes(project: Project): SizeDef[] {
  return (project.sizes ??= []);
}

function nextSeq(sizes: SizeDef[]): number {
  return sizes.reduce((max, s) => Math.max(max, s.seq), 0) + 1;
}

export class AddSizeCommand extends SizeCommand {
  readonly label = '添加尺码';
  constructor(private labelName: string) { super(); }

  protected apply(project: Project): void {
    const sizes = ensureSizes(project);
    const size: SizeDef = { id: genId('size'), label: this.labelName, seq: nextSeq(sizes) };
    if (!sizes.some(s => s.isBase)) size.isBase = true;
    sizes.push(size);
    project.activeSizeId ??= size.id;
  }
}

export class RenameSizeCommand extends SizeCommand {
  readonly label = '重命名尺码';
  constructor(private sizeId: string, private labelName: string) { super(); }

  protected apply(project: Project): void {
    const size = project.sizes?.find(s => s.id === this.sizeId);
    if (!size) throw new Error('尺码不存在');
    size.label = this.labelName;
  }
}

export class RemoveSizeCommand extends SizeCommand {
  readonly label = '删除尺码';
  constructor(private sizeId: string) { super(); }

  protected apply(project: Project): void {
    const sizes = ensureSizes(project);
    const idx = sizes.findIndex(s => s.id === this.sizeId);
    if (idx < 0) throw new Error('尺码不存在');
    const wasBase = sizes[idx].isBase === true;
    sizes.splice(idx, 1);
    if (wasBase && sizes.length > 0 && !sizes.some(s => s.isBase)) {
      [...sizes].sort((a, b) => a.seq - b.seq)[0].isBase = true;
    }

    if (project.activeSizeId === this.sizeId) project.activeSizeId = sizes[0]?.id;
  }
}

export class SetBaseSizeCommand extends SizeCommand {
  readonly label = '设为基准尺码';
  constructor(private sizeId: string) { super(); }

  protected apply(project: Project): void {
    const sizes = ensureSizes(project);
    if (!sizes.some(s => s.id === this.sizeId)) throw new Error('尺码不存在');
    for (const s of sizes) s.isBase = s.id === this.sizeId;
  }
}

export class ReorderSizesCommand extends SizeCommand {
  readonly label = '调整尺码顺序';

  constructor(private sizeId: string, private delta: number) { super(); }

  protected apply(project: Project): void {
    const sizes = ensureSizes(project);
    const order = [...sizes].sort((a, b) => a.seq - b.seq);
    const from = order.findIndex(s => s.id === this.sizeId);
    const to = from + this.delta;
    if (from < 0 || to < 0 || to >= order.length) throw new Error('该尺码已在首尾，无法再移动');
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved!);
    order.forEach((s, i) => { s.seq = i; });
  }
}
