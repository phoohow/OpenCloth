import * as THREE from 'three/webgpu';
import type { Project, SimulationConfig, FabricPhysics, ObjectTransform, RenderMode, Vec3, CameraProjection, ReferenceObjectRef, EditPreviewTier, SkinAppearance } from '../model/types';
import { fabricForPanel } from '../model/fabric';
import { particleThicknessMeters } from '../model/layers';
import type { ParticlePickHit } from '../../sim/picking';
import type { RendererContext } from '../../render/renderer/rendererContext';
import { rendererDevice } from '../../render/renderer/rendererContext';
import type { CachedFrame } from '../../sim/frameCache';
import type { CameraPreset } from './clothPicker';
import { ClothAssembly } from './clothAssembly';
import { BuildPipeline } from './buildPipeline';
import { SolverHost } from './solverHost';
import { ClothView } from './clothView';
import { AvatarView } from './avatarView';
import { CameraRig, type CameraState } from './cameraRig';
import { InteractionView } from './interactionView';
import type { ClothSurfacePoint, MeasureReading } from './interactionView';
export type { ClothSurfacePoint, MeasureReading } from './interactionView';
export type { CameraState } from './cameraRig';
import { EnvironmentStage } from './environmentStage';
import { ReferenceStage, type ReferenceObject } from './referenceStage';
import { OverlayKit } from './overlayKit';
import { DressingController } from './dressingController';
import { AnalysisController } from './analysisController';
import type { AvatarMotionInfo } from './avatarMotion';
import { timeAsync } from './engineTiming';
import { FALLBACK_PHYSICS } from './clothConstants';
import type { FitStats } from '../../render/analysis/fit';
import type { StrainStats } from '../../render/analysis/strain';
import type { PressureStats } from '../../render/analysis/pressure';
import type { DynamicPressureFrame } from '../../render/analysis/dynamicPressure';

export type { CameraPreset, ReferenceObject };
export { applyObjectTransform } from './objectTransforms';
export { DRESS_FRAMES, DRESS_GLIDE, RELAX_FRAMES, SEW_FRAMES } from './dressingStages';

/** Orchestrates the garment pipeline: pattern → mesh → drape placement → GPU simulation → render meshes. */
export class GarmentEngine {
  /** Merged particle space, triangle ownership and the constraints that stitch panels together. */
  private readonly assembly = new ClothAssembly();
  /** Pattern → merged input; announces layout changes instead of driving the solver. */
  private readonly build: BuildPipeline;
  /** The GPU solver, the frames it produced and the body it collides with. */
  private readonly solver: SolverHost;
  private references = new ReferenceStage();
  private environment: EnvironmentStage;
  /** Seam threads, topstitch rows, trim instances and the two gesture overlays. */
  private readonly overlays: OverlayKit;
  /** Staged dressing animation state; null once the garment is unsewn or already dressed. */
  private dressing!: DressingController;

  /** Body, its motion clips and soft deformation. */
  private readonly avatarView: AvatarView;
  /** Fit, strain and pressure channels, sharing one heatmap overlay. */
  private readonly analysis: AnalysisController;
  /** Drawn garment: mesh, materials, visibility groups and print textures. */
  private readonly clothView: ClothView;
  /** Picking, dragging, sketching, measuring, pins and the panel highlight. */
  private readonly interactionView: InteractionView;
  /** Viewport camera: presets, projection and the saved placement. */
  private readonly camera: CameraRig;

  constructor(private rendererCtx: RendererContext) {
    this.build = new BuildPipeline(this.assembly, {
      clear: () => this.clearCloth(),
      prepare: async project => {
        await this.avatarView.build(project);
        await this.references.ensure(project.scene.referenceObjects ?? [], this.rendererCtx.surface.scene);
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
      device: () => rendererDevice(this.rendererCtx),
      build: this.build,
      collider: () => this.avatarView.collider,
      carriedPins: count => this.interactionView.carriedPinIndices(count),
      beforeInit: () => this.endClothDrag(),
      afterInit: project => this.applyLayerThickness(project),
      present: (positions, normals, contact) => this.presentFrame(positions, normals, contact),
      presentRest: positions => this.presentRest(positions),
    });
    this.avatarView = new AvatarView({
      scene: rendererCtx.surface.scene,
      contact: () => this.solver.contact,
      clothInput: () => this.build.input,
      updateCollider: vertices => this.solver.updateColliderVertices(vertices),
      installCollider: mesh => this.solver.refreshCollider(mesh),
    });
    this.analysis = new AnalysisController({
      lastGoodPositions: () => this.solver.positions,
      initialPositions: () => this.build.positions,
      restPositions: () => this.build.restPositions,
      clothInput: () => this.build.input,
      collider: () => this.avatarView.collider,
      contact: () => this.solver.contact,
      revealCloth: visible => this.revealCloth(visible),
    });
    this.clothView = new ClothView({
      scene: rendererCtx.surface.scene,
      input: () => this.build.input,
      panelMeshes: () => this.build.panelMeshes,
      refreshPhysics: project => this.refreshClothPhysics(project),
    });
    this.overlays = new OverlayKit(rendererCtx.surface.scene);
    this.environment = new EnvironmentStage(rendererCtx);
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
      scene: rendererCtx.surface.scene,
      renderer: rendererCtx,
      overlays: this.overlays,
      avatar: this.avatarView.stage,
      input: () => this.build.input,
      mesh: () => this.clothView.mesh,
      trianglePanelIds: () => this.assembly.trianglePanelIds,
      simReady: () => this.solver.isReady,
      simulator: () => this.solver.simulator,
      positions: () => this.clothParticlePositions(),
      geometry: () => this.clothView.geometry,
      overlayTriangles: ids => this.assembly.overlayTriangles(ids),
      hasTriangles: id => (this.assembly.panelTriangles.get(id)?.length ?? 0) > 0,
      frameObjects: () => this.frameObjects(),
    });
    this.camera = new CameraRig(rendererCtx, {
      applyPreset: preset => this.interactionView.targets.applyPreset(preset),
      frameScene: () => this.interactionView.targets.frameScene(),
    });
  }

  /** Positions the solver last reported on the CPU, falling back to the initial layout. */
  private clothParticlePositions(): Float32Array | null {
    const input = this.build.input;
    if (!input) return null;
    const cached = this.solver.simulator?.getReadbackPositions();
    return cached?.length === input.particleCount * 3 ? cached : this.build.positions;
  }

  /** Builds or rebuilds the cloth meshes from the project pattern; dev builds log the cost. */
  async buildFromProject(project: Project): Promise<void> {
    await timeAsync(`buildFromProject (${Object.keys(project.pattern.panels).length} panels)`, () => this.build.build(project));
  }

  /**
   * Rebuilds only the panels whose geometry changed. Unchanged panels keep their mesh and,
   * when particle layout is stable, their live simulated positions.
   */
  async syncFromProject(project: Project): Promise<void> {
    await this.build.sync(project);
  }

  /**
   * Rebuilds the cloth from an in-flight 2D edit and redraws it at the preview tier's mesh
   * density, or redraws the committed pattern when the edit ends.
   */
  previewEditPattern(project: Project, tier: EditPreviewTier): void {
    this.build.preview(project, tier);
  }

  /** Whether the live solver still matches the merged layout; false after an incremental sync. */
  needsSimulatorRebuild(): boolean {
    return this.solver.needsRebuild();
  }

  /**
   * Re-reads the panel fold lines and the darts whose legs are being closed onto the live solver.
   * Panel meshes, particle layout and pins stay untouched; when the meshes no longer match the
   * merged layout the input is rebuilt and the viewport re-inits the simulator.
   */
  refreshConstraintSets(project: Project): void {
    this.build.refreshConstraints(project);
  }

  /** Enables or restores the compressible chest and abdomen for the current avatar. */
  applyAvatarSoftness(project: Project): void {
    this.avatarView.applySoftness(project);
  }

  /** Names of the motion clips the current body carries; empty for a static body. */
  avatarAnimationClips(): string[] {
    return this.avatarView.animationClips();
  }

  /** Playback state of the body animation, published to the panels. */
  avatarAnimationInfo(): AvatarMotionInfo {
    return this.avatarView.animationInfo();
  }

  /** Starts a motion clip on the current body. */
  playAvatarAnimation(index: number): boolean {
    return this.avatarView.playAnimation(index);
  }

  /** Holds the current body pose without advancing the clip. */
  pauseAvatarAnimation(): void {
    this.avatarView.pauseAnimation();
  }

  /** Drops the active clip and leaves the body at its last pose. */
  stopAvatarAnimation(): void {
    this.avatarView.stopAnimation();
  }

  /** Seeks the active clip to a time in milliseconds. */
  seekAvatarAnimation(ms: number): void {
    this.avatarView.seekAnimation(ms);
  }

  /**
   * Advances the body animation and refreshes the collision grid every few frames.
   * Returns true when the body pose moved.
   */
  advanceAvatarAnimation(dtMs: number): boolean {
    return this.avatarView.advanceAnimation(dtMs);
  }

  /** Turns per-frame pressure sampling on or off; turning it on keeps earlier samples. */
  setDynamicFitSampling(enabled: boolean): void {
    this.avatarView.setDynamicSampling(enabled);
  }

  /** Drops every recorded dynamic-fit sample. */
  clearDynamicFitSamples(): void {
    this.avatarView.clearDynamicSamples();
  }

  /** Samples recorded so far, oldest first. */
  getDynamicFitSamples(): readonly DynamicPressureFrame[] {
    return this.avatarView.dynamicSamples;
  }

  /** Number of recorded dynamic-fit samples. */
  get dynamicSampleCount(): number {
    return this.avatarView.dynamicSampleCount;
  }

  /** Writes the per-particle clearance of the construction layers into the running solver. */
  applyLayerThickness(project: Project): void {
    const input = this.build.input;
    if (!input || !this.solver.simulator) return;
    this.solver.setLayerThickness(particleThicknessMeters(
      project,
      input.panels.map(panel => ({
        panelId: panel.panelId,
        vertexOffset: panel.vertexOffset,
        vertexCount: panel.mesh.vertexCount,
      })),
      input.particleCount,
    ));
  }

  /** Builds the merged cloth render mesh, then the overlays that ride on it. */
  private createRenderMesh(project: Project): void {
    this.clothView.create(project);
    const surface = this.clothView.clothSurface;
    if (surface) {
      this.analysis.attach(surface);
      this.analysis.resetTimers();
    } else {
      this.analysis.detach();
    }
    this.overlays.reset();
    this.applySeamStitchVisibility(project);
    this.applyTopstitchThreads(project);
    this.applyTrimInstances(project);
  }

  /** Drops the shared cloth surface and lets go of its heatmap layer. */
  private removeClothSurface(): void {
    this.clothView.remove();
    this.analysis.detach();
  }

  /** Draws only the panels marked visible; hidden panels keep simulating. */
  applyPanelVisibility(project: Project): void {
    this.clothView.applyPanelVisibility(project);
  }

  /** Switches the cloth to the body-clearance heatmap; returns the first summary when on. */
  setFitCheck(enabled: boolean, tightCm: number, looseCm: number): FitStats | null {
    return this.analysis.setFit(enabled, tightCm, looseCm);
  }

  /** Recomputes body clearance when the throttle allows; null when off or skipped. */
  refreshFit(tightCm: number, looseCm: number, force = false): FitStats | null {
    return this.analysis.refreshFit(tightCm, looseCm, force);
  }

  /** Switches the cloth to the strain heatmap; returns the first summary when on. */
  setStrainCheck(enabled: boolean, min: number, max: number, byFabric = false): StrainStats | null {
    return this.analysis.setStrain(enabled, min, max, byFabric);
  }

  /** Recomputes per-vertex strain when the throttle allows; null when off or skipped. */
  refreshStrain(min: number, max: number, byFabric = false, force = false): StrainStats | null {
    return this.analysis.refreshStrain(min, max, byFabric, force);
  }

  /** Switches the cloth to the estimated contact-pressure heatmap. */
  setPressureCheck(enabled: boolean, maxKpa: number): PressureStats | null {
    return this.analysis.setPressure(enabled, maxKpa);
  }

  /** Converts the contact readback into an estimated pressure; null when off or skipped. */
  refreshPressure(maxKpa: number, force = false): PressureStats | null {
    return this.analysis.refreshPressure(maxKpa, force);
  }

  /** Hides the cloth, its threads and its trims while a heatmap stands in for them. */
  private revealCloth(visible: boolean): void {
    this.overlays.setVisible(visible);
    this.clothView.setVisible(visible);
  }

  /**
   * Re-reads each seam record onto the thread overlay: color and viewport visibility, drawn
   * over the positions the cloth currently holds.
   */
  applySeamStitchVisibility(project: Project): void {
    if (!this.build.input) {
      this.overlays.reset();
      return;
    }
    this.overlays.applySeams(project, this.assembly.seamPairs, this.overlayPositions());
  }

  /** Rebuilds the topstitch overlay when its records or the merged layout change. */
  applyTopstitchThreads(project: Project): void {
    const input = this.build.input;
    if (!input) return;
    const positions = this.overlayPositions();
    this.overlays.applyTopstitches(project, input, positions, this.overlayNormals(positions));
  }

  /** Rebuilds the 3D trim instances when their records or the merged layout change. */
  applyTrimInstances(project: Project): void {
    const input = this.build.input;
    if (!input) return;
    const positions = this.overlayPositions();
    this.overlays.applyTrims(project, input, positions, this.overlayNormals(positions));
  }

  /** Positions the cloth overlays should follow: the last finite frame, else the initial layout. */
  private overlayPositions(): Float32Array {
    const live = this.solver.positions;
    const initial = this.build.positions;
    return live.length === initial.length && initial.length > 0 ? live : initial;
  }

  /** Normals matching the given positions, or undefined when they are stale or absent. */
  private overlayNormals(positions: Float32Array): Float32Array | undefined {
    return this.solver.normals.length === positions.length ? this.solver.normals : undefined;
  }

  /** Re-applies the material records to the built cloth without rebuilding geometry. */
  applyFabrics(project: Project, mode?: RenderMode): void {
    this.clothView.applyFabrics(project, mode);
  }

  /** Pushes each panel's material physics into the live solver, rebuilding it when it cannot follow. */
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

  /** Initializes the GPU cloth simulator on the viewport device, keeping the PINs the markers show. */
  async initSimulator(project: Project): Promise<void> {
    await this.solver.init(project);
  }

  /** Runs one simulation step and writes the result to the render mesh. */
  async stepSimulation(config: SimulationConfig, fabric: FabricPhysics): Promise<void> {
    await this.solver.step(config, fabric);
  }

  /** Writes one finite solver frame to every view that follows the cloth. */
  private presentFrame(positions: Float32Array, normals: Float32Array, contact: Float32Array | null): void {
    this.clothView.updateFromSim(positions, normals);
    this.overlays.followSimulation(this.assembly.seamPairs, positions, normals);
    this.avatarView.updateSoftBody(positions, contact);
    this.avatarView.sampleDynamicFit();
    this.interactionView.followPositions(this.solver.simulator?.getReadbackPositions() ?? positions);
  }

  /** Puts every view back on the initial layout. */
  private presentRest(positions: Float32Array): void {
    this.clothView.resetTo(positions);
    this.overlays.followRest(this.assembly.seamPairs, positions);
    this.interactionView.followPositions(this.solver.simulator?.getReadbackPositions() ?? positions);
  }

  /** Restores the simulation to its initial positions. */
  resetSimulation(): void {
    this.dressing.reset();
    if (!this.solver.simulator || this.build.positions.length === 0) return;
    this.solver.reset();
    this.avatarView.restoreSoftBody();
  }

  /** True while a staged dressing animation is playing. */
  get isDressing(): boolean { return this.dressing.isDressing; }

  /** True when the seams are closed and the garment sits dressed on the body. */
  get isDressed(): boolean { return this.dressing.isDressed; }

  /** Starts the staged dressing animation from the unsewn layout; stepDressingFrame plays it. */
  async beginDress(project: Project): Promise<boolean> {
    return this.dressing.beginDress(project);
  }

  /** Plays one frame of the dressing animation; false once the garment has settled. */
  async stepDressingFrame(): Promise<boolean> {
    return this.dressing.stepDressingFrame();
  }

  /** Advances one animation frame: free physics once the garment is dressed, otherwise the dressing stages. */
  async stepFrame(project: Project): Promise<void> {
    return this.dressing.stepFrame(project);
  }

  /** Adopts a new simulation step length; constraint stiffness is rebuilt from it. */
  applyTimeStep(project: Project): void {
    this.solver.setTimeStep(project.scene.simulation.dt);
  }

  /** Pin or unpin a cloth particle and update its marker. */
  async setPin(particleIndex: number, pinned: boolean): Promise<boolean> {
    return this.interactionView.setPin(particleIndex, pinned);
  }

  /** Particle indices carrying a PIN marker, that is, the points pinned by hand. */
  getPinMarkers(): readonly number[] {
    return this.interactionView.getPinMarkers();
  }

  /** Releases every pinned particle in one solver pass and drops all markers. */
  async clearPins(): Promise<boolean> {
    return this.interactionView.clearPins();
  }

  /** Nearest cloth particle to the ray through a screen point. */
  pickClothParticleAtScreen(ndcX: number, ndcY: number, radiusFactor = 0.03): ParticlePickHit | null {
    return this.interactionView.pickParticle(ndcX, ndcY, radiusFactor);
  }

  /** True once a solver is built and stepping, so cloth interactions have something to act on. */
  isSimReady(): boolean {
    return this.solver.isReady;
  }

  /** True when the garment is the front-most surface under a screen point. */
  hoverClothAtScreen(ndcX: number, ndcY: number): boolean {
    return this.interactionView.hoverCloth(ndcX, ndcY);
  }

  /** Pinned particle whose marker sits within `radiusPx` of a screen point, or null. */
  hoverPinAtScreen(ndcX: number, ndcY: number, radiusPx?: number): number | null {
    return this.interactionView.hoverPin(ndcX, ndcY, radiusPx);
  }

  /** Highlights the pin a remove click would release; null restores every marker. */
  setHoveredPin(particleIndex: number | null): void {
    this.interactionView.setHoveredPin(particleIndex);
  }

  /** Raycasts the cloth surface and returns the owning panel of the hit triangle. */
  pickPanelAtScreen(ndcX: number, ndcY: number): string | null {
    return this.interactionView.pickPanel(ndcX, ndcY);
  }

  /** Cloth surface point under a screen position, in its panel's flat pattern coordinates. */
  pickClothSurface2D(ndcX: number, ndcY: number): ClothSurfacePoint | null {
    return this.interactionView.pickSurface2D(ndcX, ndcY);
  }

  /** Starts a 3D sketch stroke on the cloth; returns the pattern point the press landed on. */
  beginSketchStroke(ndcX: number, ndcY: number): ClothSurfacePoint | null {
    return this.interactionView.beginSketch(ndcX, ndcY);
  }

  /** Adds the cloth surface point under the pointer to the active sketch stroke. */
  extendSketchStroke(ndcX: number, ndcY: number): ClothSurfacePoint | null {
    return this.interactionView.extendSketch(ndcX, ndcY);
  }

  /** Drops the sketch stroke overlay. */
  endSketchStroke(): void {
    this.interactionView.endSketch();
  }

  /**
   * Places one measurement point on the cloth surface. The third call starts a new measurement;
   * the reading reports the distance once two points exist.
   */
  measureAtScreen(ndcX: number, ndcY: number): MeasureReading | null {
    return this.interactionView.measure(ndcX, ndcY);
  }

  /** Drops the measurement overlay and its placed points. */
  clearMeasurement(): void {
    this.interactionView.clearMeasurement();
  }

  /** Captured simulation frames, oldest first. */
  simulationFrames(): readonly CachedFrame[] {
    return this.solver.capturedFrames;
  }

  /** Triangle indices of the merged cloth, or null before a build. */
  clothIndices(): Uint32Array | null {
    return this.build.input?.indices ?? null;
  }

  /** Grabs the cloth under a screen point for a pointer drag; false when the point misses it. */
  beginClothDrag(ndcX: number, ndcY: number): boolean {
    return this.interactionView.beginDrag(ndcX, ndcY);
  }

  /** Moves the drag target to where the pointer ray crosses the plane it started on. */
  moveClothDrag(ndcX: number, ndcY: number): void {
    this.interactionView.moveDrag(ndcX, ndcY);
  }

  /** Releases the pointer drag; the cloth keeps the velocity the pull gave it. */
  endClothDrag(): void {
    this.interactionView.endDrag();
  }

  /** Highlights the listed panels; ids without cloth triangles are ignored. */
  setSelectedPanels(panelIds: string[]): void {
    this.interactionView.setSelectedPanels(panelIds);
  }

  /** Selected panel ids, in selection order. */
  getSelectedPanelIds(): string[] {
    return this.interactionView.getSelectedPanelIds();
  }

  /** Tints the avatar while it is the selected scene object. */
  setAvatarHighlighted(on: boolean): void {
    this.avatarView.setHighlighted(on);
  }

  /** Moves the camera to a named preset and focuses the orbit target on the garment. */
  setCameraPreset(preset: CameraPreset): void {
    this.camera.setPreset(preset);
  }

  /** Refits the scene box along the current view direction, leaving the camera angle alone. */
  frameScene(): void {
    this.camera.frameScene();
  }

  /** Projection the viewport camera renders with. */
  getProjection(): CameraProjection {
    return this.camera.projection;
  }

  /** Swaps the viewport camera and refits the scene box along the current view direction. */
  setProjection(projection: CameraProjection): void {
    this.camera.setProjection(projection);
  }

  getCameraState(): CameraState {
    return this.camera.getState();
  }

  /** Moves the viewport camera, its orbit target and the active projection's frame size. */
  setCameraState(state: {
    position?: Vec3; target?: Vec3; fovDeg?: number; viewHeightMeters?: number;
  }): void {
    this.camera.setState(state);
  }

  /** Objects the camera framing counts: the body and every loaded reference model. */
  private frameObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    const avatar = this.avatarView.object;
    if (avatar) objects.push(avatar);
    for (const reference of this.references.list()) objects.push(reference.group);
    return objects;
  }

  /** Places the avatar at its stored scene transform. */
  applyAvatarTransform(avatar: { transform?: ObjectTransform }): void {
    this.avatarView.applyTransform(avatar);
  }

  /** Shows, hides or fades the avatar body. */
  applyAvatarDisplay(display: 'visible' | 'hidden' | 'translucent'): void {
    this.avatarView.applyDisplay(display);
  }

  /** Rewrites the avatar's skin appearance; the body and the cloth keep their state. */
  applyAvatarAppearance(appearance?: SkinAppearance): void {
    this.avatarView.applyAppearance(appearance);
  }

  /** Keeps the scene's reference meshes in sync with the project's reference list. */
  async reconcileReferences(project: Project): Promise<void> {
    await this.references.reconcile(project.scene.referenceObjects ?? [], this.rendererCtx.surface.scene);
  }

  /** Stores a model file and adds it to the scene; the returned record belongs in the project list. */
  async importReferenceObject(file: File, id: string): Promise<ReferenceObjectRef> {
    return this.references.importFile(file, id, this.rendererCtx.surface.scene);
  }

  /** Reference objects currently in the scene. */
  listReferenceObjects(): ReferenceObject[] {
    return this.references.list();
  }

  setReferenceVisible(id: string, visible: boolean): void {
    this.references.setVisible(id, visible);
  }

  setReferenceOpacity(id: string, opacity: number): void {
    this.references.setOpacity(id, opacity);
  }

  /** Places a reference object at its stored scene transform. */
  setReferenceTransform(id: string, transform: ObjectTransform): void {
    this.references.place(id, transform);
  }

  /** Applies the project's environment image as the scene backdrop and lighting source. */
  async applyEnvironment(project: Project): Promise<void> {
    await this.environment.apply(project.scene.lights);
  }
  /** Removes and disposes the cloth meshes, seam threads, simulator and dressing run. */
  private clearCloth(): void {
    this.overlays.reset();
    this.overlays.endSketch();
    this.clearMeasurement();
    this.removeClothSurface();
    this.dressing.reset();
    this.solver.destroy();
    this.build.reset();
    this.analysis.resetFlags();
  }

  /** Takes the garment, body, references and environment out of the scene. */
  dispose(): void {
    const scene = this.rendererCtx.surface.scene;
    this.interactionView.dispose();
    this.avatarView.setHighlighted(false);
    this.clearCloth();
    this.references.clear(scene);
    this.avatarView.detach();
    this.environment.release();
  }
}
