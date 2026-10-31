import type { Command, ProjectContext } from './command';
import type {
  Annotation, Measurement, MeasurementRefs, Notch, Pattern, Project, SeamAllowanceCorner, SimulationConfig, SizeDef, Vec2,
} from '../model/types';
import { genId } from '../model/defaults';
import { inferCollisionLayers } from '../../pattern/auto/autoLayer';
import { SnapshotCommand } from './patternSnapshot';

/** Sets a panel's default seam allowance, in cm. */
export class SetPanelSeamAllowanceCommand extends SnapshotCommand {
  readonly label = '设置版片缝份';
  constructor(private panelId: string, private cm: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    if (!(this.cm >= 0)) throw new Error('缝份需为非负数');
    panel.seamAllowanceCm = this.cm;
  }
}

/** Sets one panel's mesh edge length, in cm. */
export class SetPanelMeshResolutionCommand extends SnapshotCommand {
  readonly label = '设置网格密度';
  constructor(private panelId: string, private cm: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    if (!Number.isFinite(this.cm) || this.cm <= 0) throw new Error('网格密度需为正数');
    panel.meshResolutionCm = this.cm;
  }
}

/** Assigns every panel a collision layer inferred from seam connectivity. */
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

/** Applies one mesh edge length to every panel and records it as the project default. */
export class SetGlobalMeshResolutionCommand extends SnapshotCommand {
  readonly label = '修改全局网格边长';
  private beforeSimulation: SimulationConfig | null = null;
  constructor(private cm: number) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    if (!Number.isFinite(this.cm) || this.cm <= 0) throw new Error('网格边长需为正数');
    this.beforeSimulation = structuredClone(ctx.project.scene.simulation);
    for (const panel of Object.values(pattern.panels)) panel.meshResolutionCm = this.cm;
    ctx.project.scene = {
      ...ctx.project.scene,
      simulation: { ...ctx.project.scene.simulation, meshResolutionCm: this.cm },
    };
  }

  undo(ctx: ProjectContext): void {
    super.undo(ctx);
    if (this.beforeSimulation) {
      ctx.project.scene = { ...ctx.project.scene, simulation: this.beforeSimulation };
      this.beforeSimulation = null;
    }
  }
}

/** Overrides one edge's seam allowance, in cm. */
export class SetEdgeSeamAllowanceCommand extends SnapshotCommand {
  readonly label = '设置边缝份';
  constructor(private edgeId: string, private cm: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const edge = pattern.edges[this.edgeId];
    if (!edge) throw new Error('边不存在');
    if (!(this.cm >= 0)) throw new Error('缝份需为非负数');
    edge.seamAllowanceCm = this.cm;
  }
}

/** Sets how the seam allowance joins at an edge's end. */
export class SetEdgeCornerStyleCommand extends SnapshotCommand {
  readonly label = '设置边角样式';
  constructor(private edgeId: string, private style: SeamAllowanceCorner) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const edge = pattern.edges[this.edgeId];
    if (!edge) throw new Error('边不存在');
    edge.cornerStyle = this.style;
  }
}

/** Sets a panel's grain line: direction, position and length. */
export class SetPanelGrainCommand extends SnapshotCommand {
  readonly label = '设置布纹方向';

  /**
   * `offset` sits the line off the outline centre, `lengthCm` gives its total length. A zero offset
   * or a zero length clears the field, returning it to the centred or automatic value.
   */
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

/** Places a notch along an edge at arc-length fraction t. */
export class CreateNotchCommand extends SnapshotCommand {
  readonly label = '创建剪口';
  constructor(private edgeId: string, private t: number, private widthMm?: number, private style?: Notch['style']) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.edges[this.edgeId]) throw new Error('边不存在');
    if (!(this.t >= 0 && this.t <= 1)) throw new Error('剪口位置需在该边范围内');
    const id = genId('notch');
    const notch: Notch = { id, edgeId: this.edgeId, t: this.t, ...(this.widthMm !== undefined ? { widthMm: this.widthMm } : {}), ...(this.style ? { style: this.style } : {}) };
    (pattern.notches ??= {})[id] = notch;
  }
}

/** Moves a notch along its edge. */
export class MoveNotchCommand extends SnapshotCommand {
  readonly label = '移动剪口';
  constructor(private notchId: string, private t: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const notch = pattern.notches?.[this.notchId];
    if (!notch) throw new Error('剪口不存在');
    if (!(this.t >= 0 && this.t <= 1)) throw new Error('剪口位置需在该边范围内');
    notch.t = this.t;
  }
}

/** Removes a notch. */
export class DeleteNotchCommand extends SnapshotCommand {
  readonly label = '删除剪口';
  constructor(private notchId: string) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.notches?.[this.notchId]) throw new Error('剪口不存在');
    delete pattern.notches[this.notchId];
  }
}

/** Options for a text annotation. */
export interface AnnotationOptions {
  angleDeg?: number;
  sizeMm?: number;
}

/** Adds a text note on a panel. */
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

/** Updates a text annotation's fields. */
export class UpdateAnnotationCommand extends SnapshotCommand {
  readonly label = '更新标注';
  constructor(private annotationId: string, private patch: Partial<Omit<Annotation, 'id' | 'panelId'>>) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const annotation = pattern.annotations?.[this.annotationId];
    if (!annotation) throw new Error('标注不存在');
    Object.assign(annotation, this.patch);
  }
}

/** Removes a text annotation. */
export class DeleteAnnotationCommand extends SnapshotCommand {
  readonly label = '删除标注';
  constructor(private annotationId: string) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.annotations?.[this.annotationId]) throw new Error('标注不存在');
    delete pattern.annotations[this.annotationId];
  }
}

/** Adds a dimension line; the panel is taken from its references when not given. */
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

/** Removes a dimension line. */
export class DeleteMeasurementCommand extends SnapshotCommand {
  readonly label = '删除尺寸标注';
  constructor(private measurementId: string) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.measurements?.[this.measurementId]) throw new Error('尺寸标注不存在');
    delete pattern.measurements[this.measurementId];
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

// ============ Size chart ============

/** Project-level edit that captures `sizes` and `activeSizeId` for exact rollback. */
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

/** Appends a size to the chart; the first size becomes the base. */
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

/** Renames a size in the chart. */
export class RenameSizeCommand extends SizeCommand {
  readonly label = '重命名尺码';
  constructor(private sizeId: string, private labelName: string) { super(); }

  protected apply(project: Project): void {
    const size = project.sizes?.find(s => s.id === this.sizeId);
    if (!size) throw new Error('尺码不存在');
    size.label = this.labelName;
  }
}

/** Removes a size; the base flag transfers to the lowest-sequence size when needed. */
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

/** Marks one size as the base; the flag stays unique across the chart. */
export class SetBaseSizeCommand extends SizeCommand {
  readonly label = '设为基准尺码';
  constructor(private sizeId: string) { super(); }

  protected apply(project: Project): void {
    const sizes = ensureSizes(project);
    if (!sizes.some(s => s.id === this.sizeId)) throw new Error('尺码不存在');
    for (const s of sizes) s.isBase = s.id === this.sizeId;
  }
}

/**
 * Moves one size past its neighbour in the chart order. Sequence numbers are renumbered to
 * the new positions so the chart stays dense and `orderedSizes` reflects the visible order.
 */
export class ReorderSizesCommand extends SizeCommand {
  readonly label = '调整尺码顺序';

  /** @param delta -1 moves the size up one row, +1 moves it down */
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
