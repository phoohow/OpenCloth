/** Domain content, the view of one frame, picking and export. */

import type {
  AssetPort, Bounds, CameraHost, DevicePort, DisplayOverride, ExportFormat, ExportPort, FrameStats,
  RenderMode, TexturePort, TraceStatus, ViewSettings,
} from '@/render/common';
import type { Project } from '@/model/types';
import type { Renderer } from '@/render/renderer';
import type { WorldPorts } from '@/render/world';
import { GarmentEngine } from '@/runtime/garmentEngine';
import { DomainBindings } from '@/runtime/domainBindings';
import { ExportService, type ExportOptions } from '@/runtime/exportService';
import { PickingService, type PickResult } from '@/runtime/picking';
import { resolveView } from '@/runtime/viewResolver';

/** Inputs the application entry injects; the viewport never creates a GPU. */
export interface ViewportDeps {
  readonly renderer: Renderer;
  readonly world: WorldPorts;
  readonly textures: TexturePort;
  readonly assets: AssetPort;
  readonly export: ExportPort;
  readonly device: DevicePort;
  readonly canvas: HTMLCanvasElement;
}

/** Display axes the viewport buttons own. */
export interface ViewPrefs {
  readonly fill: ViewSettings['fill'];
  readonly wire: ViewSettings['wire'];
  readonly mode: RenderMode;
  /** Draws only the simplified body model. */
  readonly proxyOnly: boolean;
}

/** Owns the presenters, the frame view and the interaction services of one 3D pane. */
export class Viewport {
  readonly camera: CameraHost;
  /** Domain runtime the pane drives: simulation, dressing, pins, references and camera presets. */
  readonly engine: GarmentEngine;
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private readonly world: WorldPorts;
  private readonly picking: PickingService;
  private readonly exporter: ExportService;
  private readonly bindings = new DomainBindings();
  private project: Project | null = null;
  private prefs: ViewPrefs = { fill: 'physical', wire: 'off', mode: 'raster', proxyOnly: false };
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

  /** Stores the project the next frame is rendered from. */
  applyProject(project: Project): void {
    this.project = project;
  }

  /** Stores the display axes of the next frame. */
  applyView(prefs: ViewPrefs): void {
    this.prefs = prefs;
  }

  /** Applies the project's environment image and lights as one scene update. */
  applyEnvironment(project: Project): Promise<void> {
    return this.engine.applyEnvironment(project);
  }

  /** Renders one frame of the last applied project. */
  render(): FrameStats {
    if (!this.project) {
      return { passes: [], trace: { samples: 0, accumulating: false }, cpuMs: 0 };
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
      proxyOnly: this.prefs.proxyOnly,
      overrides: this.overrides(),
      frame: this.frame,
    });
    return this.renderer.render(view, this.world.view, this.world.versions);
  }

  /** Reading of the last frame's ray-tracing gate. */
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
      proxyOnly: this.prefs.proxyOnly,
      overrides: [],
      frame: this.frame,
    });
    return this.renderer.traceStatus(view);
  }

  /** Nearest pickable surface under a normalized device coordinate. */
  pick(ndcX: number, ndcY: number): PickResult | null {
    return this.picking.pick(ndcX, ndcY);
  }

  /** Exportable scene of the current world, written as one file. */
  exportScene(format: ExportFormat, options: ExportOptions = {}): Promise<ArrayBuffer> {
    return this.exporter.export(format, options);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.resize({ width: this.width, height: this.height });
  }

  /** Last size the pane reported, in CSS pixels. */
  size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  dispose(): void {
    this.engine.dispose();
    this.bindings.clear();
  }

  /** Display rules the active analysis channel contributes. */
  private overrides(): DisplayOverride[] {
    const override = this.engine.analysisOverride();
    return override ? [override] : [];
  }
}

export type { PickResult };

/** Builds the viewport over the ports the application entry assembles. */
export function createViewport(deps: ViewportDeps): Viewport {
  return new Viewport(deps);
}
