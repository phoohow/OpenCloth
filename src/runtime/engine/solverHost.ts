import type { AvatarCollider, MeshCollider } from '@/avatar/collider';
import type { FabricPhysics, Project, SimulationConfig } from '@/model/types';
import type { DevicePort } from '@/render/common';
import type { BuildPipeline } from '@/runtime/engine/buildPipeline';
import type { ClothSimInput } from '@/sim/common';

import { frameProfiler } from '@/base/perf';
import { FrameCache, type CachedFrame } from '@/io';
import { timeAsync } from '@/runtime/engine/engineTiming';
import { createClothSimulator, layoutKey, type ClothSimulator } from '@/sim/solver';

export interface SolverHostDeps {
  device: () => DevicePort;
  build: BuildPipeline;
  collider: () => AvatarCollider | null;
  carriedPins: (particleCount: number) => number[];
  beforeInit: () => void;
  afterInit: (project: Project) => void;
  present: (positions: Float32Array, normals: Float32Array, contact: Float32Array | null) => void;
  presentRest: (positions: Float32Array) => void;
}

export class SolverHost {
  private live: ClothSimulator | null = null;
  private readonly frames = new FrameCache();
  private ready = false;
  private stepping = false;
  private appliedLayout = '';
  private appliedAvatar = '';

  constructor(private readonly deps: SolverHostDeps) {}

  get simulator(): ClothSimulator | null { return this.live; }

  get isReady(): boolean { return this.ready && this.simulator !== null; }

  get positions(): Float32Array { return this.live?.positions ?? new Float32Array(0); }

  get normals(): Float32Array { return this.live?.normals ?? new Float32Array(0); }

  get contact(): Float32Array | null { return this.live ? this.live.contact : null; }

  get capturedFrames(): readonly CachedFrame[] { return this.frames.frames(); }

  needsRebuild(): boolean {
    const input = this.deps.build.input;
    if (!input) return false;
    return this.appliedAvatar !== this.deps.build.avatarSignature
      || this.appliedLayout !== this.fingerprint(input);
  }

  markStale(): void {
    this.appliedLayout = '';
  }

  adoptPreview(drawn: ClothSimInput, input: ClothSimInput, live: Float32Array): void {
    if (!this.live || !this.ready) return;
    if (this.fingerprint(drawn) !== this.fingerprint(input)) return;
    if (!this.live.apply({ kind: 'geometry', input, initial: this.deps.build.positions })) return;
    this.live.setPositions(live);
    this.appliedLayout = this.fingerprint(input);
  }

  async init(project: Project): Promise<void> {
    const merged = this.deps.build.input;
    if (!merged) return;
    await timeAsync(`initSimulator (${merged.particleCount} particles)`, async () => {
      this.deps.beforeInit();
      this.live?.destroy();
      const carried = this.deps.carriedPins(merged.particleCount);
      const input: ClothSimInput = carried.length > 0
        ? { ...merged, pinnedIndices: [...new Set([...(merged.pinnedIndices ?? []), ...carried])] }
        : merged;
      const simulator = createClothSimulator(this.deps.device());
      await simulator.setup(input, this.deps.collider()?.mesh ?? null, project.scene.simulation);
      this.live = simulator;
      this.ready = true;
      this.deps.afterInit(project);
      this.appliedLayout = this.fingerprint(merged);
      this.appliedAvatar = this.deps.build.avatarSignature;
    });
  }

  async step(config: SimulationConfig, fabric: FabricPhysics): Promise<void> {
    const simulator = this.simulator;
    if (!simulator || !this.ready || this.stepping) return;
    this.stepping = true;
    try {
      frameProfiler.span('sim.submit', () => simulator.step(config, fabric));
      const frame = await frameProfiler.spanAsync('sim.readback', () => simulator.readback());
      if (!frame) return;
      if (frame.positions.length !== this.deps.build.positions.length) return;
      const draw = simulator.frame;
      this.deps.present(draw.positions, draw.normals, simulator.contact);
      this.frames.push(draw.positions, simulator.stats.timeSeconds);
    } finally {
      this.stepping = false;
    }
  }

  reset(): void {
    const initial = this.deps.build.positions;
    if (!this.live || initial.length === 0) return;
    this.live.reset(initial);
    this.frames.clear();
    this.deps.presentRest(initial);
  }

  clearFrames(): void {
    this.frames.clear();
  }

  setTimeStep(dt: number): void {
    this.live?.setTimeStep(dt);
  }

  setCollisionFields(thickness: Float32Array, layers: Uint8Array): void {
    this.live?.setCollisionFields(thickness, layers);
  }

  updateMaterialPhysics(physicsByPanel: FabricPhysics[], positions: Float32Array): boolean {
    if (!this.live || !this.live.apply({ kind: 'materials', physics: physicsByPanel })) return false;
    this.live.setPositions(positions);
    return true;
  }

  setConstraints(input: ClothSimInput): void {
    if (!this.live || !this.ready) return;
    const creases = input.panels.map(panel => panel.creaseEdges ?? []);
    if (!this.live.apply({ kind: 'constraints', seams: input.seams, creases })) return;
    this.appliedLayout = this.fingerprint(input);
  }

  updateColliderVertices(vertices: Float32Array): void {
    this.live?.updateColliderVertices(vertices);
  }

  refreshCollider(mesh: MeshCollider): void {
    this.live?.refreshCollider(mesh);
  }

  destroy(): void {
    this.live?.destroy();
    this.frames.clear();
    this.live = null;
    this.ready = false;
    this.stepping = false;
    this.appliedLayout = '';
    this.appliedAvatar = '';
  }

  private fingerprint(input: ClothSimInput): string {
    return layoutKey(input, this.deps.build.assembly.seamPairs.length);
  }
}
