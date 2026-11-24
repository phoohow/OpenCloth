import type { Project, SimulationConfig, Fabric, FabricPhysics } from '@/model/types';
import type { ClothSimulator } from '@/sim/solver';

import { FALLBACK_PHYSICS } from '@/runtime/engine/clothConstants';
import {
  DRESS_FRAMES, GLIDE_ITERATIONS, RELAX_FRAMES, SEW_FRAMES, SEW_ITERATIONS, SETTLE_ITERATIONS,
  glideTowards, stageConfig,
} from '@/runtime/engine/dressingStages';

export interface DressingHost {
  simulator(): ClothSimulator | null;
  simReady(): boolean;
  ensureSimulator(project: Project): Promise<void>;
  step(config: SimulationConfig, fabric: FabricPhysics): Promise<void>;
  resetPositions(): void;
  currentPositions(): Float32Array;
  dressTargets(): Float32Array;
}

interface DressRun {
  physics: FabricPhysics;
  base: SimulationConfig;
  stage: 'sew' | 'glide' | 'settle';
  frame: number;
}

function primaryPhysics(project: Project): FabricPhysics {
  const ids = Object.keys(project.fabrics);
  const first: Fabric | undefined = ids.length > 0 ? project.fabrics[ids[0]] : undefined;
  return first?.physics ?? FALLBACK_PHYSICS;
}

export class DressingController {
  private run: DressRun | null = null;
  private dressed = false;

  constructor(private host: DressingHost) {}

  get isDressing(): boolean { return this.run !== null; }

  get isDressed(): boolean { return this.dressed; }

  reset(): void {
    this.run = null;
    this.dressed = false;
  }

  updatePhysics(physics: FabricPhysics): void {
    if (this.run) this.run.physics = physics;
  }

  async beginDress(project: Project): Promise<boolean> {
    if (!this.host.simulator() || !this.host.simReady()) await this.host.ensureSimulator(project);
    if (!this.host.simulator()) return false;
    this.host.resetPositions();
    this.run = { physics: primaryPhysics(project), base: project.scene.simulation, stage: 'sew', frame: 0 };
    return true;
  }

  async stepDressingFrame(): Promise<boolean> {
    const run = this.run;
    const simulator = this.host.simulator();
    if (!run || !simulator) return false;

    if (run.stage === 'sew') {
      simulator.setSeamProgress((run.frame + 1) / SEW_FRAMES);
      await this.host.step(stageConfig(run.base, SEW_ITERATIONS), run.physics);
      run.frame++;
      if (run.frame >= SEW_FRAMES) { run.stage = 'glide'; run.frame = 0; }
    } else if (run.stage === 'glide') {
      const current = this.host.currentPositions();
      const targets = this.host.dressTargets();
      if (current.length !== targets.length) {
        this.run = null;
        return false;
      }

      simulator.setPositions(glideTowards(current, targets));
      await this.host.step(stageConfig(run.base, GLIDE_ITERATIONS), run.physics);
      run.frame++;
      if (run.frame >= DRESS_FRAMES) { run.stage = 'settle'; run.frame = 0; }
    } else {
      await this.host.step(stageConfig(run.base, SETTLE_ITERATIONS), run.physics);
      run.frame++;
      if (run.frame >= RELAX_FRAMES) {
        this.run = null;
        this.dressed = true;
      }
    }

    return this.run !== null;
  }

  async stepFrame(project: Project): Promise<void> {
    if (this.run) {
      await this.stepDressingFrame();
      return;
    }

    if (!this.dressed) {
      await this.beginDress(project);
      return;
    }

    await this.host.step(project.scene.simulation, primaryPhysics(project));
  }
}
