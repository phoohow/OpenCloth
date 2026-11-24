import type { SimulationConfig } from '@/model/types';

import {
  collidePass, integratePass, normalsPass, solvePass, updatePass, type SolverPass,
} from '@/sim/solver/passes/substep';

export const WRITE_BACK: readonly SolverPass[] = [normalsPass];

export interface Phase {
  readonly pass: SolverPass;
  readonly repeat: number;
}

export interface StepPlan {
  readonly substeps: number;
  readonly phases: readonly Phase[];
}

export function resolvePlan(params: {
  config: SimulationConfig;
  densitySubsteps: number;
  selfCollision: SolverPass | null;
}): StepPlan {
  const baseSubsteps = Math.max(1, Math.round(params.config.substeps || 1));
  const substeps = Math.max(1, Math.round(baseSubsteps * params.densitySubsteps));
  const iterations = Math.max(1, params.config.constraintIterations);
  const phases: Phase[] = [
    { pass: integratePass, repeat: 1 },
    { pass: solvePass, repeat: iterations },
  ];
  if (params.selfCollision) phases.push({ pass: params.selfCollision, repeat: 1 });
  phases.push({ pass: collidePass, repeat: 1 }, { pass: updatePass, repeat: 1 });
  return { substeps, phases };
}
