/** One GPU distance constraint: a particle pair held near a rest length. */
export interface Constraint {
  p0: number;
  p1: number;
  restLength: number;
  compliance: number;
  /** Distance beyond which the constraint tears; absent constraints never tear. */
  tearLength?: number;
}
