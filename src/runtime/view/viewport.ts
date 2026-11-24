import type { Project } from '@/model/types';
import type {
  AssetPort, Bounds, CameraHost, DevicePort, DisplayOverride, ExportFormat, ExportPort, FrameStats,
  RenderMode, TexturePort, TraceStatus, ViewSettings,
} from '@/render/common';
import type { Renderer } from '@/render/renderer';
import type { WorldPorts } from '@/render/world';
import type { ChangeSet } from '@/runtime/common';

import { GarmentEngine } from '@/runtime/engine/garmentEngine';
import { DomainBindings } from '@/runtime/view/domainBindings';
import { ExportService, type ExportOptions } from '@/runtime/view/exportService';
import { PickingService, type PickResult } from '@/runtime/view/picking';
import { resolveView } from '@/runtime/view/viewResolver';

export type { PickResult } from '@/runtime/view/picking';

export interface ViewportDeps {
  readonly renderer: Renderer;
  readonly world: WorldPorts;
  readonly textures: TexturePort;
  readonly assets: AssetPort;
  readonly export: ExportPort;
  readonly device: DevicePort;
  readonly canvas: HTMLCanvasElement;
}

export interface ViewPrefs {
  readonly fill: ViewSettings['fill'];
  readonly wire: ViewSettings['wire'];
  readonly mode: RenderMode;
  readonly hideModel: boolean;
}

export class Viewport {
  readonly camera: CameraHost;
  readonly engine: GarmentEngine;
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private readonly world: WorldPorts;
  private readonly picking: PickingService;
  private readonly exporter: ExportService;
  private readonly bindings = new DomainBindings();
  private project: Project | null = null;
  private prefs: ViewPrefs = { fill: 'material', wire: 'off', mode: 'raster', hideModel: false };
  private width = 1;
  private height = 1;
  private frame = 0;

  constructor(deps: ViewportDeps) {
    this.renderer = deps.renderer;
    this.world = deps.world;
    this.canvas = deps.canvas;
    this.camera = deps.renderer.camera;
    const bounds = (): Bounds => this.world.view.bounds({ layers: ['subject', 'overlay'] });
    this.engine = new GarmentEngine({
      writer: deps.world.writer,
      textures: deps.textures,
      assets: deps.assets,
      camera: this.camera,
      bind: (key, entity, objectAt) => this.bindings.bind(key, entity, objectAt),
      unbind: entity => this.bindings.unbind(entity),
    }, bounds, deps.device, () => ({ width: this.width, height: this.height }));
    this.picking = new PickingService(this.camera, deps.world.view, deps.assets, this.bindings);
    this.exporter = new ExportService(this.renderer, deps.world, deps.assets, deps.export);
  }

  applyProject(project: Project): void {
    this.project = project;
  }

  applyView(prefs: ViewPrefs): void {
    this.prefs = prefs;
  }

  applyFloor(project: Project): void {
    this.engine.applyFloor(project);
  }

  applyLighting(project: Project, change?: ChangeSet): Promise<void> {
    return this.engine.applyLighting(project, change);
  }

  render(): FrameStats {
    if (!this.project) {
      return { passes: [], trace: { samples: 0, accumulating: false }, denoiseCount: 0, cpuMs: 0 };
    }

    this.frame += 1;
    const view = resolveView({
      project: this.project,
      camera: this.camera.snapshot(this.width / Math.max(1, this.height)),
      width: this.width,
      height: this.height,
      fill: this.prefs.fill,
      wire: this.prefs.wire,
      mode: this.prefs.mode,
      hideModel: this.prefs.hideModel,
      overrides: this.overrides(),
      frame: this.frame,
    });
    return this.renderer.render(view, this.world.view, this.world.versions);
  }

  traceStatus(): TraceStatus {
    if (!this.project) return 'inactive';
    const view = resolveView({
      project: this.project,
      camera: this.camera.snapshot(this.width / Math.max(1, this.height)),
      width: this.width,
      height: this.height,
      fill: this.prefs.fill,
      wire: this.prefs.wire,
      mode: this.prefs.mode,
      hideModel: this.prefs.hideModel,
      overrides: [],
      frame: this.frame,
    });
    return this.renderer.traceStatus(view);
  }

  pick(ndcX: number, ndcY: number): PickResult | null {
    return this.picking.pick(ndcX, ndcY);
  }

  exportScene(format: ExportFormat, options: ExportOptions = {}): Promise<ArrayBuffer> {
    return this.exporter.export(format, options);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.resize({ width: this.width, height: this.height });
  }

  size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  dispose(): void {
    this.engine.dispose();
    this.bindings.clear();
  }

  private overrides(): DisplayOverride[] {
    const override = this.engine.analysisOverride();
    return override ? [override] : [];
  }
}

export function createViewport(deps: ViewportDeps): Viewport {
  return new Viewport(deps);
}
