import type { Viewport } from '@/runtime';
import type { GarmentEngine } from '@/runtime';
import {
  noteDrawnFrame, noteRayTraceState, noteRayTracingSamples, noteRayTracingUnsupported, noteSimSteps,
  useProjectStore, useSimStore, useUIStore,
} from '@/store';
import { ChangeSet } from '@/runtime/change';
import { frameProfiler } from '@/base/perf';
import { AVATAR_NODE_ID } from '@/model';
import { rayTraceFailureLabel } from '@/ui/optionTables';
import type { CameraConfig, Pattern, Project, Vec3 } from '@/model/types';

/** Applies the UI store's selection to the panel and avatar highlights. */
export function syncSelectionOverlay(engine: GarmentEngine, pattern: Pattern, selection: string[]): void {
  const shown = selection.filter(id => !!pattern.panels[id] && pattern.panels[id].visible !== false);
  engine.setSelectedPanels(shown);
  engine.setAvatarHighlighted(selection.includes(AVATAR_NODE_ID));
}

/** Switches the pane back to raster after the one-time probe rejects this device. */
export function fallBackToRaster(
  capability: { failure: 'gpu-error' | 'setup-failed'; detail: string },
  report: (message: string) => void,
): void {
  if (useUIStore.getState().backend === 'pathtrace') useUIStore.getState().setBackend('raster');
  noteRayTracingUnsupported({ ok: false, ...capability });
  report(`本机 WebGPU 跑不了光线追踪（${rayTraceFailureLabel(capability.failure)}）：${capability.detail}。已切回光栅化模式。`);
}

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

  private readonly engine: Viewport['engine'];
  private readonly viewport: Viewport;

  constructor(
    viewport: Viewport,
    _report: (message: string) => void,
    /** Project the engine was built from before this controller took over. */
    builtFrom: Project,
  ) {
    this.viewport = viewport;
    this.engine = viewport.engine;
    const state = useProjectStore.getState();
    this.lastLoadToken = state.loadToken;

    const handleProjectState = (next: ReturnType<typeof useProjectStore.getState>) => {
      const project = next.project;
      if (next.loadToken !== this.lastLoadToken) {
        this.lastLoadToken = next.loadToken;
        this.applyProjectCamera(project);
      }
      this.applyChange(project, next.changes);
    };
    this.unsubscribes.push(useProjectStore.subscribe(handleProjectState));

    this.unsubscribes.push(viewport.camera.onChange(() => this.scheduleCameraPersist()));

    this.unsubscribes.push(useUIStore.subscribe((state, previous) => {
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

  /** Applies one project revision to the runtime, touching only the concerns it changed. */
  private applyChange(project: Project, change: ChangeSet): void {
    if (change.has('cloth.geometry') || change.has('cloth.constraints')) {
      // The committed pattern supersedes any drag preview still queued.
      this.previewQueued = false;
      this.previewApplied = false;
      this.pendingPreviewPattern = null;
      this.rebuildCloth(project);
    }
    if (change.has('scene.simulation')) this.engine.applyTimeStep(project);
    if (change.has('scene.camera')) this.engine.setCameraAnimation(project.scene.cameraAnimation);
    if (change.has('avatar.look')) this.engine.applyAvatarDisplay(project.avatar.display);
    if (change.has('scene.environment') || change.has('scene.light')) void this.viewport.applyEnvironment(project);
    if (change.has('scene.references')) {
      void this.engine.reconcileReferences(project).then(() => {
        if (!this.cancelled) useUIStore.getState().bumpRefObjects();
      });
    }
    this.applyDrawState(project, change);
  }

  /** Re-reads materials, visibility and overlays for the concerns the revision touched. */
  private applyDrawState(project: Project, change: ChangeSet): void {
    if (change.has('cloth.fabric') || change.has('cloth.geometry')) {
      this.engine.applyFabrics(project);
    }
    if (change.has('avatar.look')) {
      this.engine.applyAvatarAppearance(project.avatar.appearance);
      this.engine.applyAvatarSoftness(project);
    }
    if (change.has('cloth.layer')) this.engine.applyLayerThickness(project);
    if (change.has('cloth.visibility') || change.has('cloth.geometry') || change.has('cloth.fabric')) {
      this.engine.applyPanelVisibility(project);
    }
    if (change.has('cloth.constraints') || change.has('cloth.geometry') || change.has('cloth.marking')) {
      this.engine.applySeamStitchVisibility(project);
    }
    if (change.has('cloth.marking') || change.has('cloth.geometry')) {
      this.engine.applyTopstitchThreads(project);
      this.engine.applyTrimInstances(project);
    }
    syncSelectionOverlay(this.engine, project.pattern, useUIStore.getState().selection);
  }

  /** Restores the camera saved with a freshly loaded project. */
  private applyProjectCamera(project: Project): void {
    const camera = project.scene.camera;
    if (!camera) return;
    this.applyingCamera = true;
    try {
      if (camera.projection !== this.viewport.camera.projection()) {
        useUIStore.getState().setCameraProjection(camera.projection);
      }
      this.engine.setCameraState(camera);
      this.engine.setCameraAnimation(project.scene.cameraAnimation);
    } finally {
      this.applyingCamera = false;
    }
  }

  /** Queues one camera write after the view settles, so orbiting does not write every frame. */
  private scheduleCameraPersist(): void {
    if (this.applyingCamera || this.engine.isCameraAnimating()) return;
    window.clearTimeout(this.cameraTimer);
    this.cameraTimer = window.setTimeout(() => this.persistCamera(), 300);
  }

  /** Stores the settled camera in the project unless it already matches. */
  private persistCamera(): void {
    if (this.engine.isCameraAnimating()) return;
    const camera = this.engine.getCameraState();
    if (sameCamera(useProjectStore.getState().project.scene.camera, camera)) return;
    useProjectStore.getState().setCamera(camera);
  }

  /** One animation frame: play steps, mirror engine state into the sim store, draw. */
  private loop = async (): Promise<void> => {
    if (this.cancelled) return;
    frameProfiler.beginFrame();

    const simState = useSimStore.getState();
    const projState = useProjectStore.getState().project;

    // Playback wall-clock: consecutive playing ticks only, so paused gaps are not counted.
    const tickStart = performance.now();
    const interval = this.lastFrameMs > 0 ? tickStart - this.lastFrameMs : 0;
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

    try {
      if (frameDelta > 0) {
        frameProfiler.span('loop.animation', () => this.engine.advanceAvatarAnimation(frameDelta));
        frameProfiler.span('loop.camera', () => this.engine.advanceCameraAnimation(frameDelta));
      }
      frameProfiler.span('loop.sync', () => this.syncAvatarAnimation(simState));
      frameProfiler.span('loop.preview', () => this.applyEditPreview());
      if (simState.isPlaying) {
        // The auto-pause frame ends playback instead of stepping past it.
        const remaining = simState.stopFrame === null ? Infinity : simState.stopFrame - simState.currentFrame;
        if (remaining <= 0) {
          simState.pause();
        } else {
          await frameProfiler.spanAsync('sim.step', async () => {
            await this.engine.stepFrame(projState);
            simState.incrementFrame();
            noteSimSteps(1);
          });
        }
      }
      // The engine owns the dressing stages, so the UI mirrors its state.
      if (simState.isDressing !== this.engine.isDressing) simState.setDressing(this.engine.isDressing);
      if (simState.isDressed !== this.engine.isDressed) simState.setDressed(this.engine.isDressed);
      if (useUIStore.getState().fitCheck) {
        const fit = useUIStore.getState();
        const stats = frameProfiler.span('analysis.fit',
          () => this.engine.refreshFit(fit.fitTightCm, fit.fitLooseCm));
        if (stats) simState.setFitStats(stats);
      }
      if (useUIStore.getState().strainCheck) {
        const strain = useUIStore.getState();
        const stats = frameProfiler.span('analysis.strain',
          () => this.engine.refreshStrain(strain.strainMin, strain.strainMax, strain.strainByFabric));
        if (stats) simState.setStrainStats(stats);
      }
      if (useUIStore.getState().pressureCheck) {
        const pressure = useUIStore.getState();
        const stats = frameProfiler.span('analysis.pressure',
          () => this.engine.refreshPressure(pressure.pressureMaxKpa));
        if (stats) simState.setPressureStats(stats);
      }

      // Physics keeps running while the pane is hidden; only the draw is skipped.
      const size = this.viewport.size();
      const drawn = size.width > 0 && size.height > 0;
      if (drawn) {
        const ui = useUIStore.getState();
        this.viewport.applyProject(projState);
        this.viewport.applyView({ fill: ui.fill, wire: ui.wire, mode: ui.backend });
        const stats = frameProfiler.span('render.frame', () => this.viewport.render());
        noteDrawnFrame('3d', performance.now());
        noteRayTraceState(this.viewport.traceStatus());
        noteRayTracingSamples(stats.trace.samples, stats.trace.accumulating, performance.now());
      } else {
        noteRayTracingSamples(0, false, performance.now());
      }
    } finally {
      frameProfiler.endFrame(interval);
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
