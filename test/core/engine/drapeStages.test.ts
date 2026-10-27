import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../../../src/core/model/defaults';
import type { SimulationConfig } from '../../../src/core/model/types';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const { GarmentEngine, DRESS_FRAMES, RELAX_FRAMES, SEW_FRAMES } = await import('../../../src/core/engine/garmentEngine');

const PARTICLE_COUNT = 4;
const project = createDefaultProject();
const fabricPhysics = Object.values(project.fabrics)[0].physics;

/** Simulator stand-in that records the calls a dressing run makes. */
class FakeSimulator {
  stepConfigs: SimulationConfig[] = [];
  seamProgress: number[] = [];
  writtenPositions: number = 0;
  resetCount = 0;
  /** Positions handed back by the following readbacks. */
  readbackData: Float32Array = new Float32Array(PARTICLE_COUNT * 3);

  step(config: SimulationConfig): void { this.stepConfigs.push(config); }
  async readback(): Promise<{ positions: Float32Array; normals: Float32Array }> {
    return { positions: this.readbackData, normals: new Float32Array(PARTICLE_COUNT * 3) };
  }
  reset(): void { this.resetCount++; }
  setSeamProgress(p: number): void { this.seamProgress.push(p); }
  setPositions(): void { this.writtenPositions++; }
  getReadbackPositions(): Float32Array { return this.readbackData; }
}

interface EngineInternals {
  simulator: unknown;
  simReady: boolean;
  mergedPositions: Float32Array;
  dressPositions: Float32Array;
  clothMeshes: Map<string, unknown>;
}

/** Engine wired to the fake simulator, counting the frames written to the render mesh. */
function engineWithFakeSim(): { engine: InstanceType<typeof GarmentEngine>; sim: FakeSimulator; drawn: () => number } {
  const sim = new FakeSimulator();
  const engine = new GarmentEngine({} as never);
  let drawnFrames = 0;
  const internals = engine as unknown as EngineInternals;
  internals.simulator = sim;
  internals.simReady = true;
  internals.mergedPositions = new Float32Array(PARTICLE_COUNT * 3);
  internals.dressPositions = new Float32Array(PARTICLE_COUNT * 3).fill(0.5);
  internals.clothMeshes = new Map([['__merged__', {
    updateFromSim: () => { drawnFrames++; },
    resetTo: () => {},
  }]]);
  return { engine, sim, drawn: () => drawnFrames };
}

describe('dressing stage sequencing', () => {
  it('plays sew, glide and settle frames in order', async () => {
    const { engine, sim } = engineWithFakeSim();
    expect(await engine.beginDrape(project)).toBe(true);
    expect(engine.isDraping).toBe(true);

    let frames = 0;
    while (await engine.stepDressingFrame()) frames++;
    // The closing frame reports the run as finished, so it is not counted.
    expect(frames + 1).toBe(SEW_FRAMES + DRESS_FRAMES + RELAX_FRAMES);

    expect(sim.seamProgress.length).toBe(SEW_FRAMES);
    expect(sim.seamProgress[0]).toBeCloseTo(1 / SEW_FRAMES, 6);
    expect(sim.seamProgress[SEW_FRAMES - 1]).toBeCloseTo(1, 6);
    expect(sim.writtenPositions).toBe(DRESS_FRAMES);
    expect(engine.isDressed).toBe(true);
    expect(engine.isDraping).toBe(false);
  });

  it('keeps dressing frames gravity-free and colliding with the body', async () => {
    const { engine, sim } = engineWithFakeSim();
    await engine.beginDrape(project);
    while (await engine.stepDressingFrame()) { /* advance */ }
    expect(sim.stepConfigs.length).toBe(SEW_FRAMES + DRESS_FRAMES + RELAX_FRAMES);
    for (const config of sim.stepConfigs) {
      expect(config.gravity.y).toBe(0);
      expect(config.avatarCollision).toBe(true);
    }
  });

  it('starts the run when a frame is requested on an unsewn garment', async () => {
    const { engine, sim } = engineWithFakeSim();
    await engine.stepFrame(project);
    expect(engine.isDraping).toBe(true);
    expect(sim.resetCount).toBe(1);
    await engine.stepFrame(project);
    expect(sim.seamProgress).toEqual([1 / SEW_FRAMES]);
  });

  it('runs free physics once the garment is dressed', async () => {
    const { engine, sim } = engineWithFakeSim();
    await engine.beginDrape(project);
    while (await engine.stepDressingFrame()) { /* advance */ }
    sim.stepConfigs.length = 0;
    await engine.stepFrame(project);
    expect(sim.stepConfigs.length).toBe(1);
    expect(sim.stepConfigs[0].gravity.y).toBe(project.scene.simulation.gravity.y);
  });

  it('resetting stops the run and undresses the garment', async () => {
    const { engine } = engineWithFakeSim();
    await engine.beginDrape(project);
    await engine.stepDressingFrame();
    engine.resetSimulation();
    expect(engine.isDraping).toBe(false);
    expect(engine.isDressed).toBe(false);
  });

  it('a non-finite readback leaves the drawn frame untouched', async () => {
    const { engine, sim, drawn } = engineWithFakeSim();
    await engine.beginDrape(project);
    await engine.stepDressingFrame();
    expect(drawn()).toBe(1);
    sim.readbackData = new Float32Array(PARTICLE_COUNT * 3).fill(NaN);
    await engine.stepSimulation(project.scene.simulation, fabricPhysics);
    expect(drawn()).toBe(1);
  });
});
