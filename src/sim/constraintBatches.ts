import type { FabricPhysics } from '../core/model/types';
import {
  buildMeshConstraints, colorConstraints, creaseConstraintsForEdges, packConstraints,
  type Constraint,
} from './buffers/constraintBuilder';
import type { BatchedConstraints, ClothSimInput } from './simTypes';

/** Structural, shear, crease and bending constraints of every panel, each with its own material stiffness. */
export function buildPanelConstraints(
  input: ClothSimInput,
  physics: FabricPhysics[],
  dt: number,
): { structural: Constraint[]; shear: Constraint[]; bending: Constraint[]; crease: Constraint[] } {
  const structural: Constraint[] = [];
  const shear: Constraint[] = [];
  const bending: Constraint[] = [];
  const crease: Constraint[] = [];

  input.panels.forEach((panel, slot) => {
    // Rest lengths come from the 3D conformed positions.
    const meshConstraints = buildMeshConstraints(panel.positions3D, panel.mesh, physics[slot], dt);
    const offset = (arr: Constraint[]) => arr.map(c => ({
      ...c, p0: c.p0 + panel.vertexOffset, p1: c.p1 + panel.vertexOffset,
    }));
    structural.push(...offset(meshConstraints.structural));
    shear.push(...offset(meshConstraints.shear));
    bending.push(...offset(meshConstraints.bending));
    crease.push(...offset(creaseConstraintsForEdges(
      panel.positions3D, panel.mesh, panel.creaseEdges ?? [], physics[slot], dt,
    )));
  });
  return { structural, shear, bending, crease };
}

/** Fold crease constraints of every panel, offset into merged particle indices. */
export function buildCreaseConstraints(
  input: ClothSimInput,
  physics: FabricPhysics[],
  dt: number,
): Constraint[] {
  const crease: Constraint[] = [];
  input.panels.forEach((panel, slot) => {
    const local = creaseConstraintsForEdges(panel.positions3D, panel.mesh, panel.creaseEdges ?? [], physics[slot], dt);
    for (const c of local) crease.push({ ...c, p0: c.p0 + panel.vertexOffset, p1: c.p1 + panel.vertexOffset });
  });
  return crease;
}

/** Colors constraints into batches and writes each packed batch to its own storage buffer. */
export function createBatchedConstraints(
  device: GPUDevice,
  constraints: Constraint[],
  particleCount: number,
): BatchedConstraints {
  if (constraints.length === 0) return { batches: [], buffers: [], count: 0 };
  const batches = colorConstraints(constraints, particleCount);
  const buffers: GPUBuffer[] = [];
  for (const batch of batches) {
    const packed = packConstraints(batch);
    const buf = device.createBuffer({
      size: Math.max(packed.data.byteLength, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buf, 0, packed.data);
    buffers.push(buf);
  }
  return { batches, buffers, count: constraints.length };
}

/**
 * Recolors constraints and overwrites the existing batch buffers in place, so the solver keeps
 * its buffers and bind groups; false when the count or batch layout no longer matches.
 */
export function rewriteBatches(
  device: GPUDevice,
  set: BatchedConstraints,
  constraints: Constraint[],
  particleCount: number,
): boolean {
  if (constraints.length !== set.count) return false;
  const batches = colorConstraints(constraints, particleCount);
  if (batches.length !== set.batches.length) return false;
  for (let b = 0; b < batches.length; b++) {
    if (batches[b].length !== set.batches[b].length) return false;
    const packed = packConstraints(batches[b]);
    device.queue.writeBuffer(set.buffers[b], 0, packed.data);
    set.batches[b] = batches[b];
  }
  return true;
}
