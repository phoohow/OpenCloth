import type { CameraConfig, Pattern, Project, Vec3 } from '@/model/types';
import type { Viewport, GarmentEngine } from '@/runtime';

import { frameProfiler } from '@/base/perf';
import { AVATAR_NODE_ID } from '@/model';
import { ChangeSet } from '@/runtime/common';
import {
  noteDenoiseCount, noteDrawnFrame, noteRayTraceState, noteRayTracingSamples,
  noteRayTracingUnsupported, noteSimSteps, useProjectStore, useSimStore, useUIStore, auxHidesModel,
  auxShowsProxy, auxShowsGirthLines, auxShowsSkeleton, auxWire,
} from '@/store';
import { rayTraceFailureLabel } from '@/ui/optionTables';

const PLAYED_PUBLISH_MS = 100;

const MAX_ANIMATION_DELTA_MS = 100;

export function syncSelectionOverlay(engine: GarmentEngine, pattern: Pattern, selection: string[]): void {
  const shown = selection.filter(id => !!pattern.panels[id] && pattern.panels[id].visible !== false);
  engine.setSelectedPanels(shown);
  engine.setAvatarHighlighted(selection.includes(AVATAR_NODE_ID));
}

export function fallBackToRaster(
  capability: { failure: 'gpu-error' | 'setup-failed'; detail: string },
  report: (message: string) => void,
): void {
  if (useUIStore.getState().backend === 'pathtrace') useUIStore.getState().setBackend('raster');
  noteRayTracingUnsupported({ ok: false, ...capability });
  report(`本机 WebGPU 跑不了光线追踪（${rayTraceFailureLabel(capability.failure)}）：${capability.detail}。已切回光栅化模式。`);
}

export class EngineSync {
  private cancelled = false;
  private raf = 0;
  private rebuildSeq = 0;
  private unsubscribes: (() => void)[] = [];
  private pendingPreviewPattern: Pattern | null = null;
  private previewQueued = false;
  private previewApplied = false;
  private rebuildsInFlight = 0;
  private lastTickMs = 0;
  private playedPending = 0;
  private lastFrameMs = 0;
  private animationPublishMs = 0;
  private dynamicSamplingApplied = false;
  private lastLoadToken = 0;
  private cameraTimer = 0;
  private applyingCamera = false;

  private readonly engine: Viewport['engine'];
  private readonly viewport: Viewport;

  constructor(
    viewport: Viewport,
    _report: (message: string) => void,
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
        this.previewQueued = state.editPreviewPattern !== null || this.previewApplied;
      }

      if (state.editPreview !== previous?.editPreview && state.editPreviewPattern) {
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

      if (state.aux.proxy !== previous?.aux.proxy) {
        const project = useProjectStore.getState().project;
        this.engine.setAvatarSimplifiedBody(auxShowsProxy(state.aux), project.avatar);
      }

      if (state.aux.girthLines !== previous?.aux.girthLines) {
        const project = useProjectStore.getState().project;
        this.engine.setAvatarGirthLines(auxShowsGirthLines(state.aux), project.avatar);
      }

      if (state.aux.skeleton !== previous?.aux.skeleton) {
        const project = useProjectStore.getState().project;
        this.engine.setAvatarSkeleton(auxShowsSkeleton(state.aux), project.avatar);
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

    this.engine.setAvatarSimplifiedBody(
      auxShowsProxy(useUIStore.getState().aux), useProjectStore.getState().project.avatar,
    );
    this.engine.setAvatarGirthLines(
      auxShowsGirthLines(useUIStore.getState().aux), useProjectStore.getState().project.avatar,
    );
    this.engine.setAvatarSkeleton(
      auxShowsSkeleton(useUIStore.getState().aux), useProjectStore.getState().project.avatar,
    );
    this.raf = requestAnimationFrame(this.loop);
    if (state.project !== builtFrom) {
      const alreadyApplied = state.loadToken === this.lastLoadToken;
      handleProjectState(state);
      if (alreadyApplied) this.applyProjectCamera(state.project);
    }
  }

  private rebuildCloth(project: Project): void {
    const seq = ++this.rebuildSeq;
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

  private applyEditPreview(): void {
    if (!this.previewQueued || this.rebuildsInFlight > 0) return;
    this.previewQueued = false;
    const project = useProjectStore.getState().project;
    const pattern = this.pendingPreviewPattern;
    const tier = useUIStore.getState().editPreview;
    if (!pattern) {
      if (this.previewApplied) this.engine.previewEditPattern(project, 'full');
      this.previewApplied = false;
      return;
    }

    if (tier === 'off') return;
    this.previewApplied = true;
    this.engine.previewEditPattern({ ...project, pattern }, tier);
  }

  private applyChange(project: Project, change: ChangeSet): void {
    if (change.has('cloth.geometry') || change.has('cloth.constraints') || change.has('avatar.body')) {
      this.previewQueued = false;
      this.previewApplied = false;
      this.pendingPreviewPattern = null;
      this.rebuildCloth(project);
    }

    if (change.has('scene.simulation')) this.engine.applyTimeStep(project);
    if (change.has('scene.camera')) this.engine.setCameraAnimation(project.scene.cameraAnimation);
    if (change.has('avatar.look')) this.engine.applyAvatarDisplay(project.avatar.display);
    if (change.has('avatar.transform')) this.engine.applyAvatarTransform(project.avatar);
    if (change.has('scene.floor')) this.viewport.applyFloor(project);
    if (change.has('scene.environment') || change.has('scene.light')) {
      void this.viewport.applyLighting(project, change);
    }

    if (change.has('scene.references')) {
      void this.engine.reconcileReferences(project).then(() => {
        if (!this.cancelled) useUIStore.getState().bumpRefObjects();
      });
    }

    this.applyDrawState(project, change);
  }

  private applyDrawState(project: Project, change: ChangeSet): void {
    if (change.has('cloth.fabric') || change.has('cloth.geometry')) {
      this.engine.applyFabrics(project);
    }

    if (change.has('avatar.look')) {
      this.engine.applyAvatarAppearance(project.avatar.appearance);
      this.engine.applyAvatarSoftness(project);
    }

    if (change.has('cloth.layer')) this.engine.applyConstructionLayers(project);
    if (change.has('cloth.visibility') || change.has('cloth.geometry') || change.has('cloth.fabric')) {
      this.engine.applyPanelVisibility(project);
    }

    if (change.has('cloth.constraints') || change.has('cloth.geometry') || change.has('cloth.marking')) {
      this.engine.applySeamStitchVisibility(project);
    }

    if (change.has('cloth.marking') || change.has('cloth.geometry') || change.has('cloth.visibility')) {
      this.engine.applyThreadOverlays(project);
      this.engine.applyTrimInstances(project);
    }

    syncSelectionOverlay(this.engine, project.pattern, useUIStore.getState().selection);
  }

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

  private scheduleCameraPersist(): void {
    if (this.applyingCamera || this.engine.isCameraAnimating()) return;
    window.clearTimeout(this.cameraTimer);
    this.cameraTimer = window.setTimeout(() => this.persistCamera(), 300);
  }

  private persistCamera(): void {
    if (this.engine.isCameraAnimating()) return;
    const camera = this.engine.getCameraState();
    if (sameCamera(useProjectStore.getState().project.scene.camera, camera)) return;
    useProjectStore.getState().setCamera(camera);
  }

  private loop = async (): Promise<void> => {
    if (this.cancelled) return;
    frameProfiler.beginFrame();

    const simState = useSimStore.getState();
    const projState = useProjectStore.getState().project;

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

      if (simState.isDressing !== this.engine.isDressing) simState.setDressing(this.engine.isDressing);
      if (simState.isDressed !== this.engine.isDressed) simState.setDressed(this.engine.isDressed);
      this.publishDragForce();
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

      const size = this.viewport.size();
      const drawn = size.width > 0 && size.height > 0;
      if (drawn) {
        const ui = useUIStore.getState();
        this.viewport.applyProject(projState);
        this.viewport.applyView({
          fill: ui.fill,
          wire: auxWire(ui.aux),
          mode: ui.backend,
          hideModel: auxHidesModel(ui.aux, projState.avatar.source !== 'glb'),
        });
        const stats = frameProfiler.span('render.frame', () => this.viewport.render());
        noteDrawnFrame('3d', performance.now());
        noteRayTraceState(this.viewport.traceStatus());
        noteRayTracingSamples(stats.trace.samples, stats.trace.accumulating, performance.now());
        noteDenoiseCount(stats.denoiseCount);
      } else {
        noteRayTracingSamples(0, false, performance.now());
        noteDenoiseCount(0);
      }
    } finally {
      frameProfiler.endFrame(interval);
      if (!this.cancelled) this.raf = requestAnimationFrame(this.loop);
    }
  };

  private publishDragForce(): void {
    const ui = useUIStore.getState();
    const forceN = this.engine.isClothDragging() ? this.engine.clothDragForce() : null;
    const head = forceN === null ? null : this.engine.clothDragArrowHeadNdc();
    if (forceN === null || head === null) {
      if (ui.dragForce3d !== null) ui.setDragForce3d(null);
      return;
    }

    const { width, height } = this.viewport.size();
    const x = (head.x * 0.5 + 0.5) * width;
    const y = (-head.y * 0.5 + 0.5) * height;
    const previous = ui.dragForce3d;
    if (previous
      && Math.abs(previous.x - x) < 0.25
      && Math.abs(previous.y - y) < 0.25
      && Math.abs(previous.forceN - forceN) < 1e-6) return;
    ui.setDragForce3d({ x, y, forceN });
  }

  private syncAvatarAnimation(simState: ReturnType<typeof useSimStore.getState>): void {
    const info = this.engine.avatarAnimationInfo();
    const current = simState.animation;
    const changed = info.clipIndex !== current.clipIndex
      || info.playing !== current.playing
      || (!info.playing && Math.abs(info.timeMs - current.timeMs) > 0.5)
      || info.clips.length !== current.clips.length
      || info.clips.some((name, i) => name !== current.clips[i])
      || info.clipDurationsMs.length !== current.clipDurationsMs.length
      || info.clipDurationsMs.some((ms, i) => Math.abs(ms - current.clipDurationsMs[i]!) > 0.5);
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

  dispose(): void {
    this.cancelled = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.cameraTimer);
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }
}

function reachedStopFrame(sim: { currentFrame: number; stopFrame: number | null }): boolean {
  return sim.stopFrame !== null && sim.currentFrame >= sim.stopFrame;
}

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
