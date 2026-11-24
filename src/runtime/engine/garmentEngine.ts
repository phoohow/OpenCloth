import type { FitStats, StrainStats, PressureStats, DynamicPressureFrame } from '@/analysis';
import type { CachedFrame } from '@/io';
import type {
  Project, SimulationConfig, FabricPhysics, ObjectTransform, Vec3, CameraProjection,
  CameraAnimationConfig, ReferenceObjectRef, EditPreviewTier, SkinAppearance, SceneLight,
} from '@/model/types';
import type { Bounds, DevicePort } from '@/render/common';
import type { ChangeSet } from '@/runtime/common';
import type { AvatarMotionInfo } from '@/runtime/engine/avatarMotion';
import type { CameraPreset } from '@/runtime/view/cameraFit';
import type { ClothSurfacePoint, MeasureReading } from '@/runtime/world/interactionView';
import type { PresenterHost } from '@/runtime/world/presenters/host';
import type { ParticlePickHit } from '@/sim/common';

import { computeVertexNormals } from '@/base/geom';
import { add3, degToRad, distance3, scale3 } from '@/base/math';
import { frameProfiler } from '@/base/perf';
import {
  fabricForPanel, floorVisible, particleCollisionLayers, particleThicknessMeters, readFloorConfig,
} from '@/model';
import { BuildPipeline } from '@/runtime/engine/buildPipeline';
import { ClothAssembly } from '@/runtime/engine/clothAssembly';
import { FALLBACK_PHYSICS } from '@/runtime/engine/clothConstants';
import { DressingController } from '@/runtime/engine/dressingController';
import { timeAsync } from '@/runtime/engine/engineTiming';
import { SolverHost } from '@/runtime/engine/solverHost';
import { CameraRig, type CameraState } from '@/runtime/view/cameraRig';
import { AvatarView } from '@/runtime/world/avatarView';
import { EnvironmentStage } from '@/runtime/world/environmentStage';
import {
  identityDelta, isIdentityDelta, transformPositions, type GizmoDelta, type GizmoFrame,
} from '@/runtime/world/gizmoMath';
import { InteractionView } from '@/runtime/world/interactionView';
import { OverlayKit } from '@/runtime/world/overlayKit';
import { AnalysisPresenter } from '@/runtime/world/presenters/analysisPresenter';
import { ClothPresenter } from '@/runtime/world/presenters/clothPresenter';
import { StagePresenter } from '@/runtime/world/presenters/stagePresenter';
import { ReferenceStage, type ReferenceObject } from '@/runtime/world/referenceStage';
import { THREAD_FALLBACK_WIDTH_M, threadWidthMeters } from '@/runtime/world/threadRibbon';

export {
  DRESS_FRAMES, DRESS_GLIDE, RELAX_FRAMES, SEW_FRAMES,
} from '@/runtime/engine/dressingStages';
export type { CameraPreset } from '@/runtime/view/cameraFit';
export type { CameraState } from '@/runtime/view/cameraRig';
export type { ClothSurfacePoint, MeasureReading } from '@/runtime/world/interactionView';
export { applyObjectTransform } from '@/runtime/world/objectTransforms';
export type { ReferenceObject } from '@/runtime/world/referenceStage';

export interface MeshStats {
  avatar: { vertices: number; triangles: number } | null;
  panels: { vertices: number; triangles: number };
  threadVertices: number;
}

export class GarmentEngine {
  private readonly assembly = new ClothAssembly();
  private readonly build: BuildPipeline;
  private readonly solver: SolverHost;
  private references = new ReferenceStage();
  private environment: EnvironmentStage;
  private readonly overlays: OverlayKit;
  private dressing!: DressingController;

  private readonly avatarView: AvatarView;
  private readonly analysis: AnalysisPresenter;
  private readonly clothView: ClothPresenter;
  private readonly stage: StagePresenter;
  private readonly interactionView: InteractionView;
  private readonly camera: CameraRig;
  private transformPreview: {
    ranges: { start: number; end: number }[];
    centers: Vec3[];
    delta: GizmoDelta;
  } | null = null;
  private lastPresented: Float32Array | null = null;
  private lastNormals: Float32Array | null = null;
  private restNormalsCache: { positions: Float32Array; indices: Uint32Array; normals: Float32Array } | null = null;

  constructor(
    private readonly host: PresenterHost,
    private readonly sceneBounds: () => Bounds,
    private readonly gpuDevice: DevicePort,
    private readonly viewportSize: () => { width: number; height: number },
  ) {
    this.stage = new StagePresenter(host);
    this.stage.create();
    this.build = new BuildPipeline(this.assembly, {
      clear: () => this.clearCloth(),
      prepare: async project => {
        await this.avatarView.build(project);
        await this.references.ensure(host, project.scene.referenceObjects ?? []);
      },
      unrepaint: () => this.removeClothSurface(),
      repaint: project => this.createRenderMesh(project),
      livePositions: () => this.solver.positions,
      layoutStale: () => this.solver.markStale(),
      constraintsChanged: (input, project) => {
        this.solver.setConstraints(input);
        this.applySeamStitchVisibility(project);
      },
      previewMerged: (drawn, input, live) => this.solver.adoptPreview(drawn, input, live),
    });
    this.solver = new SolverHost({
      device: () => this.gpuDevice,
      build: this.build,
      collider: () => this.avatarView.collider,
      carriedPins: count => this.interactionView.carriedPinIndices(count),
      beforeInit: () => this.endClothDrag(),
      afterInit: project => this.applyConstructionLayers(project),
      present: (positions, normals, contact) => this.presentFrame(positions, normals, contact),
      presentRest: positions => this.presentRest(positions),
    });
    this.avatarView = new AvatarView({
      host,
      contact: () => this.solver.contact,
      clothInput: () => this.build.input,
      updateCollider: vertices => this.solver.updateColliderVertices(vertices),
      installCollider: mesh => this.solver.refreshCollider(mesh),
    });
    this.clothView = new ClothPresenter({
      host,
      input: () => this.build.input,
      panelMeshes: () => this.build.panelMeshes,
      refreshPhysics: project => this.refreshClothPhysics(project),
    });
    this.analysis = new AnalysisPresenter({
      cloth: () => this.clothView,
      lastGoodPositions: () => this.solver.positions,
      initialPositions: () => this.build.positions,
      restPositions: () => this.build.restPositions,
      clothInput: () => this.build.input,
      collider: () => this.avatarView.collider,
      contact: () => this.solver.contact,
      revealCloth: visible => this.revealCloth(visible),
    });
    this.overlays = new OverlayKit(host);
    this.environment = new EnvironmentStage();
    this.dressing = new DressingController({
      simulator: () => this.solver.simulator,
      simReady: () => this.solver.isReady,
      ensureSimulator: project => this.initSimulator(project),
      step: (config, fabric) => this.stepSimulation(config, fabric),
      resetPositions: () => this.resetSimulation(),
      currentPositions: () => this.solver.positions,
      dressTargets: () => this.build.dressingTargets,
    });
    this.interactionView = new InteractionView({
      host,
      camera: host.camera,
      overlays: this.overlays,
      avatarVisible: () => this.avatarView.objectVisible(),
      collider: () => this.avatarView.collider,
      input: () => this.build.input,
      trianglePanelIds: () => this.assembly.trianglePanelIds,
      simulator: () => this.solver.simulator,
      simReady: () => this.solver.isReady,
      positions: () => this.clothParticlePositions(),
      surface: () => this.clothView.surfaceData(),
      overlayTriangles: ids => this.assembly.overlayTriangles(ids),
      hasTriangles: id => (this.assembly.panelTriangles.get(id)?.length ?? 0) > 0,
      bounds: this.sceneBounds,
      viewport: this.viewportSize,
    });
    this.camera = new CameraRig({ host: host.camera, bounds: this.sceneBounds });
  }

  private clothParticlePositions(): Float32Array | null {
    const input = this.build.input;
    if (!input) return null;
    const cached = this.solver.simulator?.positions;
    return cached?.length === input.particleCount * 3 ? cached : this.build.positions;
  }

  async buildFromProject(project: Project): Promise<void> {
    await timeAsync(`buildFromProject (${Object.keys(project.pattern.panels).length} panels)`, () => this.build.build(project));
  }

  async syncFromProject(project: Project): Promise<void> {
    await this.build.sync(project);
  }

  previewEditPattern(project: Project, tier: EditPreviewTier): void {
    this.build.preview(project, tier);
  }

  needsSimulatorRebuild(): boolean {
    return this.solver.needsRebuild();
  }

  refreshConstraintSets(project: Project): void {
    this.build.refreshConstraints(project);
  }

  applyAvatarSoftness(project: Project): void {
    this.avatarView.applySoftness(project);
  }

  avatarAnimationInfo(): AvatarMotionInfo {
    return this.avatarView.animationInfo();
  }

  playAvatarAnimation(index: number): boolean {
    return this.avatarView.playAnimation(index);
  }

  selectAvatarClip(index: number): boolean {
    return this.avatarView.selectAnimation(index);
  }

  pauseAvatarAnimation(): void {
    this.avatarView.pauseAnimation();
  }

  stopAvatarAnimation(): void {
    this.avatarView.stopAnimation();
  }

  seekAvatarAnimation(ms: number): void {
    this.avatarView.seekAnimation(ms);
  }

  stepAvatarAnimation(frameMs: number): void {
    this.avatarView.stepAnimation(frameMs);
  }

  rewindAvatarAnimation(): void {
    this.avatarView.rewindAnimation();
  }

  settleAvatarSeek(): void {
    this.avatarView.settleAnimationSeek();
  }

  advanceAvatarAnimation(dtMs: number): boolean {
    return this.avatarView.advanceAnimation(dtMs);
  }

  setDynamicFitSampling(enabled: boolean): void {
    this.avatarView.setDynamicSampling(enabled);
  }

  clearDynamicFitSamples(): void {
    this.avatarView.clearDynamicSamples();
  }

  getDynamicFitSamples(): readonly DynamicPressureFrame[] {
    return this.avatarView.dynamicSamples;
  }

  get dynamicSampleCount(): number {
    return this.avatarView.dynamicSampleCount;
  }

  applyConstructionLayers(project: Project): void {
    const input = this.build.input;
    if (!input || !this.solver.simulator) return;
    const panels = input.panels.map(panel => ({
      panelId: panel.panelId,
      vertexOffset: panel.vertexOffset,
      vertexCount: panel.mesh.vertexCount,
    }));
    this.solver.setCollisionFields(
      particleThicknessMeters(project, panels, input.particleCount),
      particleCollisionLayers(project, panels, input.particleCount),
    );
  }

  private createRenderMesh(project: Project): void {
    this.clothView.create(project);
    this.analysis.resetTimers();
    this.overlays.reset();
    this.applySeamStitchVisibility(project);
    this.applyThreadOverlays(project);
    this.applyTrimInstances(project);
  }

  private removeClothSurface(): void {
    this.clothView.remove();
    this.analysis.resetFlags();
  }

  analysisOverride() {
    return this.analysis.override();
  }

  applyPanelVisibility(project: Project): void {
    this.clothView.applyPanelVisibility(project);
  }

  setFitCheck(enabled: boolean, tightCm: number, looseCm: number): FitStats | null {
    return this.analysis.setFit(enabled, tightCm, looseCm);
  }

  refreshFit(tightCm: number, looseCm: number, force = false): FitStats | null {
    return this.analysis.refreshFit(tightCm, looseCm, force);
  }

  setStrainCheck(enabled: boolean, min: number, max: number, byFabric = false): StrainStats | null {
    return this.analysis.setStrain(enabled, min, max, byFabric);
  }

  refreshStrain(min: number, max: number, byFabric = false, force = false): StrainStats | null {
    return this.analysis.refreshStrain(min, max, byFabric, force);
  }

  setPressureCheck(enabled: boolean, maxKpa: number): PressureStats | null {
    return this.analysis.setPressure(enabled, maxKpa);
  }

  refreshPressure(maxKpa: number, force = false): PressureStats | null {
    return this.analysis.refreshPressure(maxKpa, force);
  }

  revealCloth(visible: boolean): void {
    this.overlays.setVisible(visible);
  }

  applySeamStitchVisibility(project: Project): void {
    if (!this.build.input) {
      this.overlays.reset();
      return;
    }

    this.overlays.applySeams(project, this.assembly.seamPairs, this.overlayPositions());
  }

  applyThreadOverlays(project: Project): void {
    const input = this.build.input;
    if (!input) return;
    const positions = this.overlayPositions();
    this.overlays.applyThreads(
      project, input, positions, this.overlayNormals(positions), this.threadWidth(),
    );
  }

  applyTrimInstances(project: Project): void {
    const input = this.build.input;
    if (!input) return;
    const positions = this.overlayPositions();
    this.overlays.applyTrims(project, input, positions, this.overlayNormals(positions));
  }

  private overlayPositions(): Float32Array {
    const live = this.solver.positions;
    const initial = this.build.positions;
    return live.length === initial.length && initial.length > 0 ? live : initial;
  }

  private threadWidth(): number {
    const { height } = this.viewportSize();
    if (!(height > 0)) return THREAD_FALLBACK_WIDTH_M;
    const camera = this.host.camera.snapshot();
    const metersPerPixel = camera.projection === 'orthographic'
      ? camera.viewHeightMeters / height
      : (2 * Math.tan(degToRad(camera.fovDeg) / 2) * distance3(camera.position, camera.target)) / height;
    return threadWidthMeters(metersPerPixel);
  }

  private overlayNormals(positions: Float32Array): Float32Array | undefined {
    if (positions === this.solver.positions) {
      const normals = this.solver.normals;
      if (normals.length === positions.length && hasNormalData(normals)) return normals;
    }

    return this.restNormals(positions);
  }

  private restNormals(positions: Float32Array): Float32Array | undefined {
    const surface = this.clothView.surfaceData();
    if (surface?.positions === positions && surface.normals.length === positions.length) {
      return surface.normals;
    }

    const input = this.build.input;
    if (!input || input.positions.length !== positions.length) return undefined;
    const cached = this.restNormalsCache;
    if (cached?.positions === positions && cached.indices === input.indices) return cached.normals;
    const normals = computeVertexNormals(positions, input.indices);
    this.restNormalsCache = { positions, indices: input.indices, normals };
    return normals;
  }

  applyFabrics(project: Project): void {
    this.clothView.applyFabrics(project);
  }

  private refreshClothPhysics(project: Project): void {
    const input = this.build.input;
    if (!this.solver.simulator || !input) return;
    const byPanel = input.panels.map(
      panel => fabricForPanel(project, panel.panelId)?.physics ?? FALLBACK_PHYSICS,
    );
    const live = this.solver.positions;
    const initial = this.build.positions;
    const positions = live.length === initial.length ? live : initial;
    input.panels.forEach((panel, i) => { panel.physics = byPanel[i]; });
    if (byPanel[0]) this.dressing.updatePhysics(byPanel[0]);
    if (!this.solver.updateMaterialPhysics(byPanel, positions)) void this.initSimulator(project);
  }

  async initSimulator(project: Project): Promise<void> {
    await this.solver.init(project);
  }

  async stepSimulation(config: SimulationConfig, fabric: FabricPhysics): Promise<void> {
    await this.solver.step(config, fabric);
  }

  private presentFrame(positions: Float32Array, normals: Float32Array, contact: Float32Array | null): void {
    frameProfiler.begin('sim.present');
    this.restNormalsCache = null;
    try {
      this.lastPresented = positions;
      this.lastNormals = normals;
      const shown = this.displayedPositions(positions);
      frameProfiler.span('present.cloth', () => this.clothView.updateFromSim(shown, normals));
      frameProfiler.span(
        'present.overlays',
        () => this.overlays.follow(this.assembly.seamPairs, shown, normals, this.threadWidth()),
      );
      frameProfiler.span('present.avatar', () => this.avatarView.updateSoftBody(positions, contact));
      frameProfiler.span('present.pressure', () => this.avatarView.sampleDynamicFit());
      frameProfiler.span('present.markers', () => this.interactionView.followPositions(
        this.solver.simulator?.positions ?? positions, shown,
      ));
    } finally {
      frameProfiler.end();
    }
  }

  private presentRest(positions: Float32Array): void {
    this.lastPresented = positions;
    this.lastNormals = null;
    this.restNormalsCache = null;
    const shown = this.displayedPositions(positions);
    this.clothView.resetTo(shown);
    this.overlays.follow(this.assembly.seamPairs, shown, this.restNormals(shown), this.threadWidth());
    this.interactionView.followPositions(this.solver.simulator?.positions ?? positions, shown);
  }

  private displayedPositions(positions: Float32Array): Float32Array {
    const preview = this.transformPreview;
    if (!preview || isIdentityDelta(preview.delta)) return positions;
    return transformPositions(positions, preview.ranges, preview.centers, preview.delta);
  }

  private repaintFromLast(): void {
    const source = this.lastPresented ?? this.build.positions;
    if (!source || source.length === 0) return;
    const shown = this.displayedPositions(source);
    if (this.lastNormals && this.lastNormals.length === shown.length) {
      this.clothView.updateFromSim(shown, this.lastNormals);
      this.overlays.follow(this.assembly.seamPairs, shown, this.lastNormals, this.threadWidth());
    } else {
      this.clothView.resetTo(shown);
      this.overlays.follow(this.assembly.seamPairs, shown, this.restNormals(shown), this.threadWidth());
    }

    this.interactionView.followPositions(source, shown);
  }

  resetSimulation(): void {
    this.dressing.reset();
    if (!this.solver.simulator || this.build.positions.length === 0) return;
    this.solver.reset();
    this.avatarView.restoreSoftBody();
  }

  get isDressing(): boolean { return this.dressing.isDressing; }

  get isDressed(): boolean { return this.dressing.isDressed; }

  async beginDress(project: Project): Promise<boolean> {
    return this.dressing.beginDress(project);
  }

  async stepDressingFrame(): Promise<boolean> {
    return this.dressing.stepDressingFrame();
  }

  async stepFrame(project: Project): Promise<void> {
    return this.dressing.stepFrame(project);
  }

  applyTimeStep(project: Project): void {
    this.solver.setTimeStep(project.scene.simulation.dt);
  }

  async setPin(particleIndex: number, pinned: boolean): Promise<boolean> {
    return this.interactionView.setPin(particleIndex, pinned);
  }

  getPinMarkers(): readonly number[] {
    return this.interactionView.getPinMarkers();
  }

  async clearPins(): Promise<boolean> {
    return this.interactionView.clearPins();
  }

  pickClothParticleAtScreen(ndcX: number, ndcY: number, radiusFactor = 0.03): ParticlePickHit | null {
    return this.interactionView.pickParticle(ndcX, ndcY, radiusFactor);
  }

  isSimReady(): boolean {
    return this.solver.isReady;
  }

  hoverClothAtScreen(ndcX: number, ndcY: number): boolean {
    return this.interactionView.hoverCloth(ndcX, ndcY);
  }

  hoverPinAtScreen(ndcX: number, ndcY: number, radiusPx?: number): number | null {
    return this.interactionView.hoverPin(ndcX, ndcY, radiusPx);
  }

  setHoveredPin(particleIndex: number | null): void {
    this.interactionView.setHoveredPin(particleIndex);
  }

  pickPanelAtScreen(ndcX: number, ndcY: number): string | null {
    return this.interactionView.pickPanel(ndcX, ndcY);
  }

  pickClothSurface2D(ndcX: number, ndcY: number): ClothSurfacePoint | null {
    return this.interactionView.pickSurface2D(ndcX, ndcY);
  }

  beginSketchStroke(ndcX: number, ndcY: number): ClothSurfacePoint | null {
    return this.interactionView.beginSketch(ndcX, ndcY);
  }

  extendSketchStroke(ndcX: number, ndcY: number): ClothSurfacePoint | null {
    return this.interactionView.extendSketch(ndcX, ndcY);
  }

  endSketchStroke(): void {
    this.interactionView.endSketch();
  }

  measureAtScreen(ndcX: number, ndcY: number): MeasureReading | null {
    return this.interactionView.measure(ndcX, ndcY);
  }

  clearMeasurement(): void {
    this.interactionView.clearMeasurement();
  }

  simulationFrames(): readonly CachedFrame[] {
    return this.solver.capturedFrames;
  }

  clothIndices(): Uint32Array | null {
    return this.build.input?.indices ?? null;
  }

  meshStats(): MeshStats {
    const input = this.build.input;
    return {
      avatar: this.avatarView.stage.bodyStats,
      panels: {
        vertices: input ? input.positions.length / 3 : 0,
        triangles: input ? input.indices.length / 3 : 0,
      },
      threadVertices: this.assembly.seamPairs.length * 2
        + this.overlays.threadVertices,
    };
  }

  beginClothDrag(ndcX: number, ndcY: number): boolean {
    return this.interactionView.beginDrag(ndcX, ndcY);
  }

  moveClothDrag(ndcX: number, ndcY: number): void {
    this.interactionView.moveDrag(ndcX, ndcY);
  }

  clothDragForce(): number | null {
    return this.interactionView.dragForceN();
  }

  isClothDragging(): boolean {
    return this.interactionView.dragging;
  }

  clothDragArrowHeadNdc(): { x: number; y: number } | null {
    return this.interactionView.dragArrowHeadNdc();
  }

  endClothDrag(): void {
    this.interactionView.endDrag();
  }

  panelGizmoFrame(panelIds: string[]): GizmoFrame | null {
    const positions = this.lastPresented ?? this.build.positions;
    if (!positions || positions.length < 3) return null;
    const centers: Record<string, Vec3> = {};
    const ranges: { start: number; end: number }[] = [];
    for (const id of panelIds) {
      const range = this.assembly.layout.rangeOf(id);
      if (!range) continue;
      const center = rangeCenter(positions, range);
      if (!center) continue;
      centers[id] = center;
      ranges.push(range);
    }

    const ids = Object.keys(centers);
    if (ids.length === 0) return null;
    const center = ids.reduce(
      (sum, id) => add3(sum, scale3(centers[id]!, 1 / ids.length)),
      { x: 0, y: 0, z: 0 },
    );
    let radius = 0;
    for (const range of ranges) {
      const stride = Math.max(1, Math.floor((range.end - range.start) / 64));
      for (let i = range.start; i < range.end; i += stride) {
        const offset = i * 3;
        radius = Math.max(radius, Math.hypot(
          positions[offset]! - center.x,
          positions[offset + 1]! - center.y,
          positions[offset + 2]! - center.z,
        ));
      }
    }

    return { center, radius: Math.max(0.03, radius), centers };
  }

  beginPanelTransformPreview(panelIds: string[]): GizmoFrame | null {
    const frame = this.panelGizmoFrame(panelIds);
    if (!frame) return null;
    const ranges: { start: number; end: number }[] = [];
    const centers: Vec3[] = [];
    for (const id of panelIds) {
      const range = this.assembly.layout.rangeOf(id);
      const panelCenter = frame.centers[id];
      if (!range || !panelCenter) continue;
      ranges.push(range);
      centers.push(panelCenter);
    }

    if (ranges.length === 0) return null;
    this.transformPreview = { ranges, centers, delta: identityDelta() };
    return frame;
  }

  updatePanelTransformPreview(delta: GizmoDelta | null): void {
    const preview = this.transformPreview;
    if (!preview) return;
    preview.delta = delta ?? identityDelta();
    this.repaintFromLast();
  }

  endPanelTransformPreview(): void {
    if (!this.transformPreview) return;
    this.transformPreview = null;
    this.repaintFromLast();
  }

  setSelectedPanels(panelIds: string[]): void {
    this.interactionView.setSelectedPanels(panelIds);
  }

  getSelectedPanelIds(): string[] {
    return this.interactionView.getSelectedPanelIds();
  }

  setAvatarHighlighted(on: boolean): void {
    this.avatarView.setHighlighted(on);
  }

  setCameraPreset(preset: CameraPreset): void {
    this.camera.setPreset(preset);
  }

  frameScene(): void {
    this.camera.frameScene();
  }

  getProjection(): CameraProjection {
    return this.camera.projection;
  }

  setProjection(projection: CameraProjection): void {
    this.camera.setProjection(projection);
  }

  getCameraState(): CameraState {
    return this.camera.getState();
  }

  setCameraState(state: {
    position?: Vec3; target?: Vec3; fovDeg?: number; viewHeightMeters?: number;
  }): void {
    this.camera.setState(state);
  }

  setCameraAnimation(config: CameraAnimationConfig | null | undefined): void {
    this.camera.setAnimation(config);
  }

  isCameraAnimating(): boolean {
    return this.camera.isAnimating();
  }

  advanceCameraAnimation(dtMs: number): boolean {
    return this.camera.advanceAnimation(dtMs);
  }

  applyAvatarTransform(avatar: { transform?: ObjectTransform }, refitCollider = true): void {
    this.avatarView.applyTransform(avatar, refitCollider);
  }

  applyAvatarDisplay(display: 'visible' | 'hidden' | 'translucent'): void {
    this.avatarView.applyDisplay(display);
  }

  setAvatarSimplifiedBody(visible: boolean, avatar: Project['avatar']): void {
    this.avatarView.applySimplifiedBody(visible, avatar);
  }

  setAvatarGirthLines(visible: boolean, avatar: Project['avatar']): void {
    this.avatarView.applyGirthLines(visible, avatar);
  }

  setAvatarSkeleton(visible: boolean, avatar: Project['avatar']): void {
    this.avatarView.applySkeleton(visible, avatar);
  }

  applyAvatarAppearance(appearance?: SkinAppearance): void {
    this.avatarView.applyAppearance(appearance);
  }

  async reconcileReferences(project: Project): Promise<void> {
    await this.references.reconcile(this.host, project.scene.referenceObjects ?? []);
  }

  async importReferenceObject(file: File, id: string): Promise<ReferenceObjectRef> {
    return this.references.importFile(this.host, file, id);
  }

  listReferenceObjects(): ReferenceObject[] {
    return this.references.list();
  }

  setReferenceVisible(id: string, visible: boolean): void {
    this.references.setVisible(this.host, id, visible);
  }

  setReferenceOpacity(id: string, opacity: number): void {
    this.references.setOpacity(this.host, id, opacity);
  }

  setReferenceTransform(id: string, transform: ObjectTransform): void {
    this.references.place(id, transform);
  }

  setLightPosition(light: SceneLight): void {
    this.environment.moveLight(this.host, light);
  }

  setFloorTransform(transform: ObjectTransform): void {
    this.stage.setTransform(transform);
  }

  applyFloor(project: Project): void {
    this.stage.configure(readFloorConfig(project));
    this.stage.setVisible(floorVisible(project.scene));
  }

  async applyLighting(project: Project, change?: ChangeSet): Promise<void> {
    const lights = project.scene.lights;
    if (!change) {
      await this.environment.applyAll(this.host, lights);
      return;
    }

    if (change.has('scene.environment')) await this.environment.applyEnvironment(this.host, lights);
    if (change.has('scene.light')) {
      this.environment.applyLights(this.host, lights, {
        ids: change.lightIds, structure: change.lightStructure,
      });
    }
  }

  private clearCloth(): void {
    this.transformPreview = null;
    this.lastPresented = null;
    this.lastNormals = null;
    this.overlays.reset();
    this.overlays.endSketch();
    this.clearMeasurement();
    this.removeClothSurface();
    this.dressing.reset();
    this.solver.destroy();
    this.build.reset();
    this.analysis.resetFlags();
  }

  dispose(): void {
    this.camera.dispose();
    this.interactionView.dispose();
    this.avatarView.setHighlighted(false);
    this.clearCloth();
    this.references.clear(this.host);
    this.avatarView.detach();
    this.stage.dispose();
    this.environment.release(this.host);
  }
}

function hasNormalData(normals: Float32Array): boolean {
  for (let i = 0; i < normals.length; i++) {
    if (normals[i] !== 0) return true;
  }

  return false;
}

function rangeCenter(positions: Float32Array, range: { start: number; end: number }): Vec3 | null {
  const end = Math.min(range.end, Math.floor(positions.length / 3));
  if (end <= range.start) return null;
  let x = 0, y = 0, z = 0;
  for (let i = range.start; i < end; i++) {
    x += positions[i * 3]!;
    y += positions[i * 3 + 1]!;
    z += positions[i * 3 + 2]!;
  }

  const count = end - range.start;
  return { x: x / count, y: y / count, z: z / count };
}
