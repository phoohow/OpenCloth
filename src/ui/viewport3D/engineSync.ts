import {
  applyLightConfig, rayTraceState, renderScene, setRayTracingConfig, setRendererMode,
} from '../../render/renderer/rendererContext';
import { RayTracingUnsupportedError } from '../../render/renderer/rendererContext';
import type { RendererContext } from '../../render/renderer/rendererContext';
import type { GarmentEngine } from '../../core/engine/garmentEngine';
import {
  noteDrawnFrame, noteRayTraceState, noteRayTracingSamples, noteRayTracingUnsupported,
  useProjectStore, useSimStore, useUIStore,
} from '../../store/stores';
import { normalizeLights, normalizeRayTracing } from '../../core/model/defaults';
import { AVATAR_NODE_ID } from '../sceneTree';
import { rayTraceFailureLabel } from '../optionTables';
import type { Pattern, Project } from '../../core/model/types';

/** Applies the UI store's selection to the panel and avatar highlights. */
export function syncSelectionOverlay(engine: GarmentEngine, pattern: Pattern, selection: string[]): void {
  const shown = selection.filter(id => !!pattern.panels[id] && pattern.panels[id].visible !== false);
  engine.setSelectedPanels(shown);
  engine.setAvatarHighlighted(selection.includes(AVATAR_NODE_ID));
}

/** Falls back to rasterization when the ray tracing pipeline cannot run. */
export function recoverWithRaster(ctx: RendererContext, error: unknown, report: (message: string) => void): void {
  console.error('WebGPU ray tracing failed:', error);
  ctx.rayTracer?.dispose();
  ctx.rayTracer = null;
  // A kept creation promise would reinstall this disposed tracer on the next switch.
  ctx.rayTracerLoading = null;
  ctx.renderMode = 'shaded';
  if (useUIStore.getState().renderMode === 'raytraced') useUIStore.getState().setRenderMode('shaded');
  if (error instanceof RayTracingUnsupportedError) {
    const capability = { ok: false, failure: error.failure, detail: error.detail };
    noteRayTracingUnsupported(capability);
    report(`本机 WebGPU 跑不了光线追踪（${rayTraceFailureLabel(error.failure)}）：${error.detail}。已切回光栅化模式。`);
    return;
  }
  report('光线追踪运行失败，已切回光栅化模式。');
}

/** Comparable snapshot of the project fields that drive scene sync. */
function projectSignals(state: { project: Project; clothSignature: string }) {
  const project = state.project;
  const lights = project.scene.lights;
  const render = project.scene.render;
  return {
    cloth: state.clothSignature,
    env: `${lights.iblObjectKey ?? lights.iblUrl ?? 'bundled'}:${lights.iblName ?? ''}`,
    light: JSON.stringify([normalizeLights(lights), lights.iblEnabled, lights.iblIntensity, render.toneMapping]),
    ray: JSON.stringify(normalizeRayTracing(render.rayTracing)),
    references: JSON.stringify(project.scene.referenceObjects ?? []),
  };
}

type ProjectSignals = ReturnType<typeof projectSignals>;

/**
 * Keeps the garment engine and renderer in sync with the stores and runs the frame loop.
 * Every store change is compared against content signatures, so each subsystem updates
 * exactly when the data it consumes changed.
 */
export class EngineSync {
  private cancelled = false;
  private raf = 0;
  private rebuildSeq = 0;
  private last: ProjectSignals;
  private unsubscribes: (() => void)[] = [];
  /** Newest in-flight drag pattern; the frame loop applies it at most once per frame. */
  private pendingPreviewPattern: Pattern | null = null;
  /** Whether a queued drag pattern still needs applying. */
  private previewQueued = false;
  /** Whether the drawn cloth is a drag preview rather than the committed pattern. */
  private previewApplied = false;
  /** Geometry rebuilds awaiting the engine; a preview never lands in the middle of one. */
  private rebuildsInFlight = 0;
  /** Fractional physics steps carried across frames so slower speeds still slow playback. */
  private stepAccumulator = 0;

  constructor(private engine: GarmentEngine, private ctx: RendererContext, private report: (message: string) => void) {
    const state = useProjectStore.getState();
    this.last = projectSignals(state);

    this.unsubscribes.push(useProjectStore.subscribe(state => {
      const project = state.project;
      const signals = projectSignals(state);
      if (signals.cloth !== this.last.cloth) {
        this.last.cloth = signals.cloth;
        // The committed pattern supersedes any drag preview still queued.
        this.previewQueued = false;
        this.previewApplied = false;
        this.pendingPreviewPattern = null;
        this.rebuildCloth(project);
      }
      if (signals.env !== this.last.env) {
        this.last.env = signals.env;
        void this.engine.applyEnvironment(project);
      }
      if (signals.light !== this.last.light) {
        this.last.light = signals.light;
        applyLightConfig(this.ctx, project.scene.lights, project.scene.render);
      }
      if (signals.ray !== this.last.ray) {
        this.last.ray = signals.ray;
        this.ctx.rayConfig = normalizeRayTracing(project.scene.render.rayTracing);
        void setRayTracingConfig(this.ctx, this.ctx.rayConfig).catch(error => this.recover(error));
      }
      if (signals.references !== this.last.references) {
        this.last.references = signals.references;
        void this.engine.reconcileReferences(project).then(() => {
          if (!this.cancelled) useUIStore.getState().bumpRefObjects();
        });
      }
      // Materials, panel visibility and seam threads re-read the live project every commit.
      this.applyDrawState(project);
    }));

    this.unsubscribes.push(useUIStore.subscribe((state, previous) => {
      if (state.renderMode !== previous?.renderMode) {
        void setRendererMode(this.ctx, state.renderMode).catch(error => this.recover(error));
        // Cloth materials follow the display mode.
        this.applyDrawState(useProjectStore.getState().project);
      }
      if (state.cameraProjection !== previous?.cameraProjection) {
        this.engine.setProjection(state.cameraProjection);
      }
      if (state.selection !== previous?.selection) {
        syncSelectionOverlay(this.engine, useProjectStore.getState().project.pattern, state.selection);
      }
      if (state.editPreviewPattern !== previous?.editPreviewPattern) {
        this.pendingPreviewPattern = state.editPreviewPattern;
        // Ending a preview needs a redraw only when one was actually drawn.
        this.previewQueued = state.editPreviewPattern !== null || this.previewApplied;
      }
      if (state.editPreview !== previous?.editPreview && state.editPreviewPattern) {
        // A tier switch mid-drag rebuilds the preview at the new density.
        this.previewQueued = true;
      }
      if (state.fitCheck !== previous?.fitCheck
        || state.fitTightCm !== previous?.fitTightCm
        || state.fitLooseCm !== previous?.fitLooseCm) {
        const stats = this.engine.setFitCheck(state.fitCheck, state.fitTightCm, state.fitLooseCm);
        useSimStore.getState().setFitStats(stats);
      }
      if (state.strainCheck !== previous?.strainCheck
        || state.strainMin !== previous?.strainMin
        || state.strainMax !== previous?.strainMax) {
        const stats = this.engine.setStrainCheck(state.strainCheck, state.strainMin, state.strainMax);
        useSimStore.getState().setStrainStats(stats);
      }
    }));

    this.unsubscribes.push(useSimStore.subscribe((state, previous) => {
      if (state.stepToken !== previous?.stepToken) {
        const project = useProjectStore.getState().project;
        void this.engine.stepFrame(project).then(() => {
          const sim = useSimStore.getState();
          sim.setDraping(this.engine.isDraping);
          sim.setDraped(this.engine.isDressed);
          sim.incrementFrame();
        });
      }
      if (state.resetToken !== previous?.resetToken) {
        this.stepAccumulator = 0;
        this.engine.resetSimulation();
      }
    }));

    this.raf = requestAnimationFrame(this.loop);
  }

  /** A newer rebuild supersedes in-flight ones; stale results are dropped. */
  private rebuildCloth(project: Project): void {
    const seq = ++this.rebuildSeq;
    // Rebuilding clears the engine-side selection highlight.
    this.engine.setSelectedPanels([]);
    this.engine.setAvatarHighlighted(false);
    void (async () => {
      this.rebuildsInFlight++;
      try {
        await this.engine.syncFromProject(project);
        if (this.engine.needsSimulatorRebuild()) await this.engine.initSimulator(project);
      } finally {
        this.rebuildsInFlight--;
      }
      if (this.cancelled || seq !== this.rebuildSeq) return;
      syncSelectionOverlay(this.engine, project.pattern, useUIStore.getState().selection);
      useSimStore.getState().reset();
      useSimStore.getState().setDraped(false);
      useSimStore.getState().bumpPins();
      const fit = useUIStore.getState();
      if (fit.fitCheck) {
        const stats = this.engine.setFitCheck(true, fit.fitTightCm, fit.fitLooseCm);
        useSimStore.getState().setFitStats(stats);
      }
      if (fit.strainCheck) {
        const stats = this.engine.setStrainCheck(true, fit.strainMin, fit.strainMax);
        useSimStore.getState().setStrainStats(stats);
      }
    })();
  }

  /**
   * Rebuilds the cloth from the drag pattern queued since the last frame, so a fast pointer
   * produces one preview per frame instead of one per pointer event.
   */
  private applyEditPreview(): void {
    if (!this.previewQueued || this.rebuildsInFlight > 0) return;
    this.previewQueued = false;
    const project = useProjectStore.getState().project;
    const pattern = this.pendingPreviewPattern;
    const tier = useUIStore.getState().editPreview;
    if (!pattern) {
      // A drag that nets no geometry leaves the preview mesh drawn, so redraw the committed pattern.
      if (this.previewApplied) this.engine.previewEditPattern(project, 'full');
      this.previewApplied = false;
      return;
    }
    if (tier === 'off') return;
    this.previewApplied = true;
    this.engine.previewEditPattern({ ...project, pattern }, tier);
  }

  /** Re-reads materials, visibility and seam threads from the project; all paths are signature-guarded. */
  private applyDrawState(project: Project): void {
    const renderMode = useUIStore.getState().renderMode;
    this.engine.applyFabrics(project, renderMode);
    this.engine.applyPanelVisibility(project);
    this.engine.applySeamStitchVisibility(project);
    syncSelectionOverlay(this.engine, project.pattern, useUIStore.getState().selection);
  }

  private recover(error: unknown): void {
    if (!this.ctx.disposed) recoverWithRaster(this.ctx, error, this.report);
  }

  /** One animation frame: play steps, mirror engine state into the sim store, draw. */
  private loop = async (): Promise<void> => {
    if (this.cancelled) return;

    const simState = useSimStore.getState();
    const projState = useProjectStore.getState().project;

    try {
      this.applyEditPreview();
      if (simState.isPlaying) {
        this.stepAccumulator += simState.speed;
        const steps = Math.floor(this.stepAccumulator);
        this.stepAccumulator -= steps;
        for (let i = 0; i < steps; i++) {
          await this.engine.stepFrame(projState);
          simState.incrementFrame();
        }
      }
      // The engine owns the dressing stages, so the UI mirrors its state.
      if (simState.isDraping !== this.engine.isDraping) simState.setDraping(this.engine.isDraping);
      if (simState.isDraped !== this.engine.isDressed) simState.setDraped(this.engine.isDressed);
      if (useUIStore.getState().fitCheck) {
        const fit = useUIStore.getState();
        const stats = this.engine.refreshFit(fit.fitTightCm, fit.fitLooseCm);
        if (stats) simState.setFitStats(stats);
      }
      if (useUIStore.getState().strainCheck) {
        const strain = useUIStore.getState();
        const stats = this.engine.refreshStrain(strain.strainMin, strain.strainMax);
        if (stats) simState.setStrainStats(stats);
      }

      this.ctx.controls.update();
      // Physics keeps running while the pane is hidden; only the draw is skipped.
      const drawn = this.ctx.canvas.clientWidth > 0 && this.ctx.canvas.clientHeight > 0;
      if (drawn) {
        try {
          renderScene(this.ctx);
        } catch (error) {
          if (this.ctx.renderMode !== 'raytraced') throw error;
          this.recover(error);
          renderScene(this.ctx);
        }
        noteDrawnFrame('3d', performance.now());
      }
      const samples = drawn && this.ctx.renderMode === 'raytraced' ? this.ctx.rayTracer?.sampleCount ?? 0 : 0;
      noteRayTracingSamples(samples, this.ctx.rayTracer?.isAccumulating ?? false, performance.now());
      noteRayTraceState(rayTraceState(this.ctx));
    } finally {
      // Queued after the awaited work so one frame never overlaps the next.
      if (!this.cancelled) this.raf = requestAnimationFrame(this.loop);
    }
  };

  /** Stops the frame loop and every store subscription. */
  dispose(): void {
    this.cancelled = true;
    cancelAnimationFrame(this.raf);
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }
}
