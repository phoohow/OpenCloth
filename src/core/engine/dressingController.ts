import type { Project, SimulationConfig, Fabric, FabricPhysics } from '../model/types';
import type { ClothSimulator } from '../../sim/clothSimulator';
import {
  DRESS_FRAMES, GLIDE_ITERATIONS, RELAX_FRAMES, SEW_FRAMES, SEW_ITERATIONS, SETTLE_ITERATIONS,
  glideTowards, stageConfig,
} from './dressingStages';
import { FALLBACK_PHYSICS } from './clothConstants';

/** Solver and position hooks a dressing run drives. */
export interface DressingHost {
  /** The live simulator, null before the first setup. */
  simulator(): ClothSimulator | null;
  /** Whether a simulator is ready to step. */
  simReady(): boolean;
  /** Builds the simulator if missing. */
  ensureSimulator(project: Project): Promise<void>;
  /** One solver frame written to the render mesh. */
  step(config: SimulationConfig, fabric: FabricPhysics): Promise<void>;
  /** Restores the solver and render mesh to the initial positions. */
  resetPositions(): void;
  /** Positions the solver last reported on the CPU. */
  currentPositions(): Float32Array;
  /** Wrapped positions the dressing glide aims for. */
  dressTargets(): Float32Array;
}

/** One in-flight dressing animation. */
interface DressRun {
  /** Fabric physics used by every frame of the run. */
  physics: FabricPhysics;
  /** Project simulation config the stages run under. */
  base: SimulationConfig;
  /** Current stage of the run. */
  stage: 'sew' | 'glide' | 'settle';
  /** Frames already played in the current stage. */
  frame: number;
}

/** Global damping source: the first material record, or the cotton default. */
function primaryPhysics(project: Project): FabricPhysics {
  const ids = Object.keys(project.fabrics);
  const first: Fabric | undefined = ids.length > 0 ? project.fabrics[ids[0]] : undefined;
  return first?.physics ?? FALLBACK_PHYSICS;
}

/** Plays the staged sew → glide → settle dressing animation and the post-dress free steps. */
export class DressingController {
  private run: DressRun | null = null;
  private dressed = false;

  constructor(private host: DressingHost) { }

  /** True while a staged dressing animation is playing. */
  get isDressing(): boolean { return this.run !== null; }

  /** True when the seams are closed and the garment sits dressed on the body. */
  get isDressed(): boolean { return this.dressed; }

  /** Forgets any in-flight run and the dressed flag; used when the cloth is rebuilt or reset. */
  reset(): void {
    this.run = null;
    this.dressed = false;
  }

  /** Keeps a playing run on the latest global damping value. */
  updatePhysics(physics: FabricPhysics): void {
    if (this.run) this.run.physics = physics;
  }

  /** Starts the staged dressing animation from the unsewn layout; stepDressingFrame plays it. */
  async beginDress(project: Project): Promise<boolean> {
    if (!this.host.simulator() || !this.host.simReady()) await this.host.ensureSimulator(project);
    if (!this.host.simulator()) return false;
    this.host.resetPositions();
    this.run = { physics: primaryPhysics(project), base: project.scene.simulation, stage: 'sew', frame: 0 };
    return true;
  }

  /** Plays one frame of the dressing animation; false once the garment has settled. */
  async stepDressingFrame(): Promise<boolean> {
    const run = this.run;
    const simulator = this.host.simulator();
    if (!run || !simulator) return false;

    if (run.stage === 'sew') {
      // Seam rest lengths shrink from the open gap to zero, pulling the pieces together.
      simulator.setSeamProgress((run.frame + 1) / SEW_FRAMES);
      await this.host.step(stageConfig(run.base, SEW_ITERATIONS), run.physics);
      run.frame++;
      if (run.frame >= SEW_FRAMES) { run.stage = 'glide'; run.frame = 0; }
    } else if (run.stage === 'glide') {
      // The sewn piece slides toward its wrapped pose while collision presses it onto the body.
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
      // Zero-gravity relaxation converges the structural, shear and seam constraints.
      await this.host.step(stageConfig(run.base, SETTLE_ITERATIONS), run.physics);
      run.frame++;
      if (run.frame >= RELAX_FRAMES) {
        this.run = null;
        this.dressed = true;
      }
    }
    return this.run !== null;
  }

  /** Advances one animation frame: free physics once the garment is dressed, otherwise the dressing stages. */
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
