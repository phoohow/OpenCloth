export { buildAdjacency, type NormalAdjacency } from '@/sim/particles/adjacency';
export {
  buildCreaseConstraints, buildMeshConstraints, buildPanelConstraints, creaseConstraintsForEdges,
  creaseStiffnessOf, pairSeparation, tornSeamPairs, type ConstraintSet, type TearPair,
} from '@/sim/particles/constraints';
export {
  computeBaseInvMass, computeParticleDamping, computeParticleFriction, computeParticleLayers,
  computeParticleMass, computeParticleThickness,
} from '@/sim/particles/fields';
export {
  buildLayout, computeParticlePanelMap, layoutKey, NO_PANEL, type LayoutTables,
} from '@/sim/particles/layout';
export { ParticlePicker } from '@/sim/particles/picking';
