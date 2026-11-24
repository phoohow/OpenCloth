import type { SimulationConfig } from '@/model/types';

import { packCollideParams, workgroups, type ComputeCommands, type LayoutBuffers, type Programs } from '@/sim/device';

export const integratePass: SolverPass = {
  id: 'integrate',
  encode({ commands, programs, resources, particleCount }) {
    commands.dispatch(programs.integrate, resources.integrateBG, workgroups(particleCount));
  },
};

export const solvePass: SolverPass = {
  id: 'solve',
  encode({ commands, programs, resources }) {
    for (let b = 0; b < resources.solveBGs.length; b++) {
      const count = resources.solveCounts[b] ?? 0;
      if (count === 0) continue;
      commands.dispatch(programs.solve, resources.solveBGs[b]!, workgroups(count));
    }
  },
};

const FLOOR_Y = 0;

export const collidePass: SolverPass = {
  id: 'collide',
  encode({ commands, programs, resources, particleCount, config }) {
    commands.write(resources.collideParams, packCollideParams(
      config, particleCount, resources.collideBody, FLOOR_Y,
    ));
    commands.dispatch(programs.collide, resources.collideBG, workgroups(particleCount));
  },
};

export const updatePass: SolverPass = {
  id: 'update',
  encode({ commands, programs, resources, particleCount }) {
    commands.dispatch(programs.update, resources.updateBG, workgroups(particleCount));
  },
};

export const normalsPass: SolverPass = {
  id: 'normals',
  encode({ commands, programs, resources, particleCount }) {
    commands.write(resources.normalsParams, new Uint32Array([particleCount]));
    commands.dispatch(programs.normals, resources.normalsBG, workgroups(particleCount));
  },
};

export interface PassContext {
  readonly commands: ComputeCommands;
  readonly programs: Programs;
  readonly resources: LayoutBuffers;
  readonly particleCount: number;
  readonly config: SimulationConfig;
}

export interface SolverPass {
  readonly id: string;
  encode(context: PassContext): void;
  dispose?(): void;
}
