import {
  applyLightConfig, rayTraceState, renderScene, setRayTracingConfig, setRendererMode,
} from '../../render/renderer/rendererContext';
import { RayTracingUnsupportedError } from '../../render/renderer/rendererContext';
import type { RendererContext } from '../../render/renderer/rendererContext';
import type { GarmentEngine } from '../../core/engine/garmentEngine';
import {
  noteDrawnFrame, noteRayTraceState, noteRayTracingSamples, noteRayTracingUnsupported, noteSimSteps,
  useProjectStore, useSimStore, useUIStore,
} from '../../store/stores';
import { normalizeLights, normalizeRayTracing } from '../../core/model/defaults';
import { computeClothSignature } from '../../store/projectStore';
import { AVATAR_NODE_ID } from '../sceneTree';
import { rayTraceFailureLabel } from '../optionTables';
import type { CameraConfig, Pattern, Project, Vec3 } from '../../core/model/types';

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
    dt: project.scene.simulation.dt,
    avatar: project.avatar.display,
    env: `${lights.iblObjectKey ?? lights.iblUrl ?? 'bundled'}:${lights.iblName ?? ''}`,
    light: JSON.stringify([normalizeLights(lights), lights.iblEnabled, lights.iblIntensity, render.toneMapping]),
    ray: JSON.stringify(normalizeRayTracing(render.rayTracing)),
    references: JSON.stringify(project.scene.referenceObjects ?? []),
  };
}

type ProjectSignals = ReturnType<typeof projectSignals>;

/** Playback time is published to the store at this interval instead of every tick. */
const PLAYED_PUBLISH_MS = 100;
/** Frame delta is capped so a backgrounded tab does not jump the body animation. */
const MAX_ANIMATION_DELTA_MS = 100;

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
  /** Start of the previous playing tick, 0 while paused; feeds the timeline's elapsed time. */
  private lastTickMs = 0;
  /** Playback time not yet published to the sim store, flushed every PLAYED_PUBLISH_MS. */
  private playedPending = 0;
  /** Start of the previous frame, 0 before the first one; feeds the body animation delta. */
  private lastFrameMs = 0;
  /** Last time the animation state was published to the store. */
  private animationPublishMs = 0;
  /** Dynamic sampling switch the engine was last told about. */
  private dynamicSamplingApplied = false;
  /** Load counter of the project the camera was last applied from. */
  private lastLoadToken = 0;
  /** Pending camera write; orbiting restarts it so only the settled view is stored. */
  private cameraTimer = 0;
  /** True while a loaded camera is being applied, which must not write itself back. */
  private applyingCamera = false;

  constructor(
    private engine: GarmentEngine,
    private ctx: RendererContext,
    private report: (message: string) => void,
    /** Project the engine was built from before this controller took over. */
    builtFrom: Project,
  ) {
    const state = useProjectStore.getState();
    this.last = projectSignals({ project: builtFrom, clothSignature: computeClothSignature(builtFrom) });
    this.lastLoadToken = state.loadToken;

    const handleProjectState = (next: ReturnType<typeof useProjectStore.getState>) => {
      const project = next.project;
      if (next.loadToken !== this.lastLoadToken) {
        this.lastLoadToken = next.loadToken;
        this.applyProjectCamera(project);
      }
      const signals = projectSignals(next);
      if (signals.cloth !== this.last.cloth) {
        this.last.cloth = signals.cloth;
        // The committed pattern supersedes any drag preview still queued.
        this.previewQueued = false;
        this.previewApplied = false;
        this.pendingPreviewPattern = null;
        this.rebuildCloth(project);
      }
      if (signals.dt !== this.last.dt) {
        this.last.dt = signals.dt;
        this.engine.applyTimeStep(project);
      }
      if (signals.avatar !== this.last.avatar) {
        this.last.avatar = signals.avatar;
        this.engine.applyAvatarDisplay(project.avatar.display);
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
    };
    this.unsubscribes.push(useProjectStore.subscribe(handleProjectState));

    const onCameraChange = () => this.scheduleCameraPersist();
    this.ctx.controls.addEventListener('change', onCameraChange);
    this.unsubscribes.push(() => this.ctx.controls.removeEventListener('change', onCameraChange));

    this.unsubscribes.push(useUIStore.subscribe((state, previous) => {
      if (state.renderMode !== previous?.renderMode) {
        void setRendererMode(this.ctx, state.renderMode).catch(error => this.recover(error));
        // Cloth materials follow the display mode.
        this.applyDrawState(useProjectStore.getState().project);
      }
      if (state.cameraProjection !== previous?.cameraProjection) {
        this.engine.setProjection(state.cameraProjection);
        this.scheduleCameraPersist();
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
        || state.strainMax !== previous?.strainMax
        || state.strainByFabric !== previous?.strainByFabric) {
        const stats = this.engine.setStrainCheck(
          state.strainCheck, state.strainMin, state.strainMax, state.strainByFabric,
        );
        useSimStore.getState().setStrainStats(stats);
      }
      if (state.pressureCheck !== previous?.pressureCheck
        || state.pressureMaxKpa !== previous?.pressureMaxKpa) {
        const stats = this.engine.setPressureCheck(state.pressureCheck, state.pressureMaxKpa);
        useSimStore.getState().setPressureStats(stats);
      }
    }));

    this.unsubscribes.push(useSimStore.subscribe((state, previous) => {
      if (state.stepToken !== previous?.stepToken && !reachedStopFrame(state)) {
        const project = useProjectStore.getState().project;
        void this.engine.stepFrame(project).then(() => {
          const sim = useSimStore.getState();
          sim.setDressing(this.engine.isDressing);
          sim.setDressed(this.engine.isDressed);
          sim.incrementFrame();
        });
      }
      if (state.resetToken !== previous?.resetToken) {
        this.engine.resetSimulation();
      }
    }));

    this.raf = requestAnimationFrame(this.loop);
    // A startup restore can land while the renderer initializes; fold it into the built scene.
    if (state.project !== builtFrom) {
      const alreadyApplied = state.loadToken === this.lastLoadToken;
      handleProjectState(state);
      if (alreadyApplied) this.applyProjectCamera(state.project);
    }
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
      useSimStore.getState().setDressed(false);
      useSimStore.getState().bumpPins();
      const fit = useUIStore.getState();
      if (fit.fitCheck) {
        const stats = this.engine.setFitCheck(true, fit.fitTightCm, fit.fitLooseCm);
        useSimStore.getState().setFitStats(stats);
      }
      if (fit.strainCheck) {
        const stats = this.engine.setStrainCheck(true, fit.strainMin, fit.strainMax, fit.strainByFabric);
        useSimStore.getState().setStrainStats(stats);
      }
      if (fit.pressureCheck) {
        const stats = this.engine.setPressureCheck(true, fit.pressureMaxKpa);
        useSimStore.getState().setPressureStats(stats);
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

  /** Re-reads materials, visibility and thread overlays from the project; all paths are signature-guarded. */
  private applyDrawState(project: Project): void {
    const renderMode = useUIStore.getState().renderMode;
    this.engine.applyFabrics(project, renderMode);
    this.engine.applyAvatarAppearance(project.avatar.appearance);
    this.engine.applyAvatarSoftness(project);
    this.engine.applyLayerThickness(project);
    this.engine.applyPanelVisibility(project);
    this.engine.applySeamStitchVisibility(project);
    this.engine.applyTopstitchThreads(project);
    this.engine.applyTrimInstances(project);
    syncSelectionOverlay(this.engine, project.pattern, useUIStore.getState().selection);
  }

  private recover(error: unknown): void {
    if (!this.ctx.disposed) recoverWithRaster(this.ctx, error, this.report);
  }

  /** Restores the camera saved with a freshly loaded project. */
  private applyProjectCamera(project: Project): void {
    const camera = project.scene.camera;
    if (!camera) return;
    this.applyingCamera = true;
    try {
      if (camera.projection !== this.ctx.projection) {
        useUIStore.getState().setCameraProjection(camera.projection);
      }
      this.engine.setCameraState(camera);
    } finally {
      this.applyingCamera = false;
    }
  }

  /** Queues one camera write after the view settles, so orbiting does not write every frame. */
  private scheduleCameraPersist(): void {
    if (this.applyingCamera) return;
    window.clearTimeout(this.cameraTimer);
    this.cameraTimer = window.setTimeout(() => this.persistCamera(), 300);
  }

  /** Stores the settled camera in the project unless it already matches. */
  private persistCamera(): void {
    const camera = this.engine.getCameraState();
    if (sameCamera(useProjectStore.getState().project.scene.camera, camera)) return;
    useProjectStore.getState().setCamera(camera);
  }

  /** One animation frame: play steps, mirror engine state into the sim store, draw. */
  private loop = async (): Promise<void> => {
    if (this.cancelled) return;

    const simState = useSimStore.getState();
    const projState = useProjectStore.getState().project;

    // Playback wall-clock: consecutive playing ticks only, so paused gaps are not counted.
    const tickStart = performance.now();
    if (simState.isPlaying) {
      if (this.lastTickMs > 0) this.playedPending += tickStart - this.lastTickMs;
      this.lastTickMs = tickStart;
      if (this.playedPending >= PLAYED_PUBLISH_MS) {
        simState.addPlayedMs(this.playedPending);
        this.playedPending = 0;
      }
    } else {
      this.lastTickMs = 0;
      if (this.playedPending > 0) {
        simState.addPlayedMs(this.playedPending);
        this.playedPending = 0;
      }
    }

    const frameDelta = this.lastFrameMs > 0 ? Math.min(tickStart - this.lastFrameMs, MAX_ANIMATION_DELTA_MS) : 0;
    this.lastFrameMs = tickStart;
    if (frameDelta > 0) this.engine.advanceAvatarAnimation(frameDelta);
    this.syncAvatarAnimation(simState);

    try {
      this.applyEditPreview();
      if (simState.isPlaying) {
        // The auto-pause frame ends playback instead of stepping past it.
        const remaining = simState.stopFrame === null ? Infinity : simState.stopFrame - simState.currentFrame;
        if (remaining <= 0) {
          simState.pause();
        } else {
          await this.engine.stepFrame(projState);
          simState.incrementFrame();
          noteSimSteps(1);
        }
      }
      // The engine owns the dressing stages, so the UI mirrors its state.
      if (simState.isDressing !== this.engine.isDressing) simState.setDressing(this.engine.isDressing);
      if (simState.isDressed !== this.engine.isDressed) simState.setDressed(this.engine.isDressed);
      if (useUIStore.getState().fitCheck) {
        const fit = useUIStore.getState();
        const stats = this.engine.refreshFit(fit.fitTightCm, fit.fitLooseCm);
        if (stats) simState.setFitStats(stats);
      }
      if (useUIStore.getState().strainCheck) {
        const strain = useUIStore.getState();
        const stats = this.engine.refreshStrain(strain.strainMin, strain.strainMax, strain.strainByFabric);
        if (stats) simState.setStrainStats(stats);
      }
      if (useUIStore.getState().pressureCheck) {
        const stats = this.engine.refreshPressure(useUIStore.getState().pressureMaxKpa);
        if (stats) simState.setPressureStats(stats);
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

  /** Mirrors the body animation into the store and applies the dynamic sampling switch. */
  private syncAvatarAnimation(simState: ReturnType<typeof useSimStore.getState>): void {
    const info = this.engine.avatarAnimationInfo();
    const current = simState.animation;
    const changed = info.clipIndex !== current.clipIndex
      || info.playing !== current.playing
      || Math.abs(info.durationMs - current.durationMs) > 0.5
      || info.clips.length !== current.clips.length
      || info.clips.some((name, i) => name !== current.clips[i]);
    const now = performance.now();
    const due = info.playing && now - this.animationPublishMs >= PLAYED_PUBLISH_MS;
    if (changed || due) {
      this.animationPublishMs = now;
      simState.setAnimationInfo(info);
    }
    if (this.engine.dynamicSampleCount !== simState.dynamicSamples) {
      simState.setDynamicSamples(this.engine.dynamicSampleCount);
    }
    const sampling = useUIStore.getState().dynamicSampling;
    if (sampling !== this.dynamicSamplingApplied) {
      this.dynamicSamplingApplied = sampling;
      this.engine.setDynamicFitSampling(sampling);
    }
  }

  /** Stops the frame loop and every store subscription. */
  dispose(): void {
    this.cancelled = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.cameraTimer);
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }
}

/** Whether the sim has reached its auto-pause frame. */
function reachedStopFrame(sim: { currentFrame: number; stopFrame: number | null }): boolean {
  return sim.stopFrame !== null && sim.currentFrame >= sim.stopFrame;
}

/** Whether a stored camera equals the live placement. */
function sameCamera(stored: CameraConfig | undefined, live: CameraConfig): boolean {
  if (!stored) return false;
  return stored.projection === live.projection
    && stored.fovDeg === live.fovDeg
    && stored.viewHeightMeters === live.viewHeightMeters
    && sameVec(stored.position, live.position)
    && sameVec(stored.target, live.target);
}

function sameVec(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
