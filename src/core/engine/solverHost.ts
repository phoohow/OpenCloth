import type { FabricPhysics, Project, SimulationConfig } from '../model/types';
import type { AvatarCollider } from '../../avatar/collider/avatarCollider';
import { ClothSimulator } from '../../sim/clothSimulator';
import type { ClothSimInput } from '../../sim/simTypes';
import { FrameCache, type CachedFrame } from '../../sim/frameCache';
import type { MeshCollider } from '../../avatar/collider/meshCollider';
import { timeAsync } from './engineTiming';
import { clothLayoutFingerprint } from './buildSignatures';
import type { BuildPipeline } from './buildPipeline';

/** What the solver announces to the rest of the runtime. */
export interface SolverHostDeps {
  /** Device the solver is built on; read lazily so the renderer may come up first. */
  device: () => GPUDevice;
  /** Merged input and layout identity the solver follows. */
  build: BuildPipeline;
  /** Body collision surface the solver collides the cloth with. */
  collider: () => AvatarCollider | null;
  /** PIN markers that survive a rebuild. */
  carriedPins: (particleCount: number) => number[];
  /** Drops gestures that hold the solver about to be replaced. */
  beforeInit: () => void;
  /** Called once a fresh solver exists, so per-build settings can be pushed in. */
  afterInit: (project: Project) => void;
  /** Writes one finite solver frame to the views. */
  present: (positions: Float32Array, normals: Float32Array, contact: Float32Array | null) => void;
  /** Puts the views back on the initial layout. */
  presentRest: (positions: Float32Array) => void;
}

/**
 * Owns the GPU solver and everything that is only meaningful next to one: the frames it
 * produced, the layout it was set up for and the body it collides with. It reads the merged
 * input from the build pipeline and tells the views what to draw; nothing calls back into it
 * except its owner.
 */
export class SolverHost {
  private live: ClothSimulator | null = null;
  private ready = false;
  private stepping = false;
  /** One non-finite warning per cloth build. */
  private nonFiniteReported = false;
  /** Most recent finite readback; the dressing glide starts from what is actually drawn. */
  private lastGood: Float32Array = new Float32Array(0);
  /** Normals read back with the last good frame, used to orient threads and trims. */
  private lastGoodNormals: Float32Array = new Float32Array(0);
  /** Recent frames kept for sequence export. */
  private readonly frames = new FrameCache(90);
  /** Simulation time of the last cached frame, in seconds. */
  private frameTimeSeconds = 0;
  /** Fingerprint of the merged layout the live solver was set up for. */
  private appliedLayout = '';
  /** Body signature the live solver's collision capsules were built for. */
  private appliedAvatar = '';

  constructor(private readonly deps: SolverHostDeps) { }

  /** The live simulator, null before the first setup. */
  get simulator(): ClothSimulator | null { return this.live; }

  /** Whether a simulator exists and can step. */
  get isReady(): boolean { return this.ready && this.simulator !== null; }

  /** Positions the solver last reported on the CPU; empty before the first frame. */
  get positions(): Float32Array { return this.lastGood; }

  /** Normals read back with the last good frame; empty before the first frame. */
  get normals(): Float32Array { return this.lastGoodNormals; }

  /** Captured simulation frames, oldest first. */
  get capturedFrames(): readonly CachedFrame[] { return this.frames.frames(); }

  /** Clearance array the live solver holds; empty when none was pushed. */
  get contact(): Float32Array | null { return this.live ? this.live.getReadbackContact() : null; }

  /** Whether the live solver still matches the merged layout and body. */
  needsRebuild(): boolean {
    const input = this.deps.build.input;
    if (!input) return false;
    return this.appliedAvatar !== this.deps.build.avatarSignature
      || this.appliedLayout !== this.fingerprint(input);
  }

  /** Marks the layout stale without touching the solver; the next check rebuilds it. */
  markStale(): void {
    this.appliedLayout = '';
  }

  /** Whether the solver can follow this preview layout in place, and does so when it can. */
  adoptPreview(drawn: ClothSimInput, input: ClothSimInput, live: Float32Array): void {
    if (!this.live || !this.ready) return;
    if (this.fingerprint(drawn) !== this.fingerprint(input)) return;
    this.live.rebaseGeometry(input, input.positions, live);
    this.appliedLayout = this.fingerprint(input);
  }

  /** Builds the solver for the current merged input, keeping the PINs the markers show. */
  async init(project: Project): Promise<void> {
    const merged = this.deps.build.input;
    if (!merged) return;
    await timeAsync(`initSimulator (${merged.particleCount} particles)`, async () => {
      // A rebuilt solver has no grabbed particle yet, so any in-flight drag ends with the old one.
      this.deps.beforeInit();
      this.live?.destroy();
      const carried = this.deps.carriedPins(merged.particleCount);
      const input = carried.length > 0
        ? { ...merged, pinnedIndices: [...new Set([...(merged.pinnedIndices ?? []), ...carried])] }
        : merged;
      const simulator = new ClothSimulator(this.deps.device());
      await simulator.setup(input, this.deps.collider(), project.scene.simulation);
      this.live = simulator;
      this.ready = true;
      this.nonFiniteReported = false;
      this.deps.afterInit(project);
      this.appliedLayout = this.fingerprint(merged);
      this.appliedAvatar = this.deps.build.avatarSignature;
    });
  }

  /** Runs one simulation step and hands the result to the views. */
  async step(config: SimulationConfig, fabric: FabricPhysics): Promise<void> {
    const simulator = this.simulator;
    if (!simulator || !this.ready || this.stepping) return;
    this.stepping = true;
    try {
      simulator.step(config, fabric);
      const { positions, normals } = await simulator.readback();
      const badParticle = firstNonFinite(positions);
      // A non-finite frame makes every triangle degenerate, so the last good frame stays drawn.
      if (badParticle >= 0) {
        if (!this.nonFiniteReported) {
          this.nonFiniteReported = true;
          console.warn(`Cloth simulation produced a non-finite position at particle ${badParticle}.`);
        }
        return;
      }
      // A preview mesh can hold fewer particles than the live solver; the readback would not fit it.
      const initial = this.deps.build.positions;
      if (positions.length !== initial.length) return;
      if (this.lastGood.length !== positions.length) this.lastGood = new Float32Array(positions.length);
      this.lastGood.set(positions);
      if (this.lastGoodNormals.length !== normals.length) this.lastGoodNormals = new Float32Array(normals.length);
      this.lastGoodNormals.set(normals);
      this.frameTimeSeconds += config.dt;
      this.frames.push(positions, this.frameTimeSeconds);
      this.deps.present(positions, normals, simulator.getReadbackContact());
    } finally {
      this.stepping = false;
    }
  }

  /** Puts the solver back on the initial layout and drops the captured frames. */
  reset(): void {
    const initial = this.deps.build.positions;
    if (!this.live || initial.length === 0) return;
    this.live.reset(initial);
    this.lastGood = initial.slice();
    this.lastGoodNormals = new Float32Array(0);
    this.frames.clear();
    this.frameTimeSeconds = 0;
    this.deps.presentRest(initial);
  }

  /** Forgets the captured frames without touching the solver positions. */
  clearFrames(): void {
    this.frames.clear();
    this.frameTimeSeconds = 0;
  }

  /** Adopts a new simulation step length; constraint stiffness is rebuilt from it. */
  setTimeStep(dt: number): void {
    this.live?.setTimeStep(dt);
  }

  /** Pushes the per-particle clearance of the construction layers. */
  setLayerThickness(values: Float32Array): void {
    this.live?.setParticleThickness(values);
  }

  /** Pushes each panel's material physics; false when the solver has to be rebuilt instead. */
  updateMaterialPhysics(physicsByPanel: FabricPhysics[], positions: Float32Array): boolean {
    return this.live ? this.live.updateMaterialPhysics(physicsByPanel, positions) : false;
  }

  /** Installs seam and fold-crease constraint groups without touching the particle layout. */
  setConstraints(input: ClothSimInput): void {
    if (!this.live || !this.ready) return;
    this.live.setSeamConstraints(input.seamConstraints);
    this.live.setCreaseEdges(input.panels.map(panel => panel.creaseEdges ?? []));
    this.appliedLayout = this.fingerprint(input);
  }

  /** Moves the collision surface with the animated body. */
  updateColliderVertices(vertices: Float32Array): void {
    this.live?.updateMeshColliderVertices(vertices);
  }

  /** Replaces the collision surface after the body mesh was rebuilt. */
  refreshCollider(mesh: MeshCollider): void {
    this.live?.refreshMeshCollider(mesh);
  }

  /** Frees the device resources and forgets every derived array. */
  destroy(): void {
    this.live?.destroy();
    this.live = null;
    this.ready = false;
    this.stepping = false;
    this.nonFiniteReported = false;
    this.lastGood = new Float32Array(0);
    this.lastGoodNormals = new Float32Array(0);
    this.appliedLayout = '';
    this.appliedAvatar = '';
    this.frames.clear();
    this.frameTimeSeconds = 0;
  }

  private fingerprint(input: ClothSimInput): string {
    return clothLayoutFingerprint(input, this.deps.build.assembly.seamPairs.length);
  }
}

/** Index of the first non-finite readback component, or -1 when every position is finite. */
function firstNonFinite(positions: Float32Array): number {
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) return Math.floor(i / 3);
  }
  return -1;
}
