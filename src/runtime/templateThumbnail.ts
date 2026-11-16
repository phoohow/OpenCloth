/**
 * Settles a garment template offscreen so the catalogue can show the real thing instead of a glyph:
 * the same pattern → mesh → drape → GPU solver path the viewport runs, stopped once the cloth has
 * come to rest, then handed to the preview pipeline as plain mesh data.
 */

import type { AvatarParams, Pattern, SimulationConfig } from '@/model/types';
import { createDefaultProject } from '@/model';
import { computeVertexNormals } from '@/base/geom';
import type { AssetMesh, MaterialData } from '@/render/common';
import { buildMeshCollider, type AvatarCollider } from '@/avatar/collider';
import { makehumanBody } from '@/avatar';
import { buildPanelMesh, type PanelMesh } from '@/pattern/panel';
import type { GarmentTemplate } from '@/pattern/template';
import { ClothSimulator } from '@/sim';
import { FALLBACK_PHYSICS } from '@/runtime/clothConstants';
import { ClothAssembly } from '@/runtime/clothAssembly';
import { DressingController } from '@/runtime/dressingController';
import { BodyLandmarkCache } from '@/runtime/initialPose';

/** Density the preview mesh is built at, in centimetres; the icon is 128 px, so it stays coarse. */
const PREVIEW_RESOLUTION_CM = 3;

/** Frames a settle runs in total: the sixty dressing frames plus sixty of free relaxation. */
const SETTLE_FRAMES = 120;

/** One read-back every few free frames keeps self-collision current without stalling the GPU. */
const READBACK_STRIDE = 5;

/** Fabric surface of a settled garment. */
const GARMENT_MATERIAL: MaterialData = {
  kind: 'surface',
  name: 'preview-garment',
  color: '#9aa1ad',
  roughness: 0.74,
  metalness: 0,
  sheen: 0.35,
  side: 'double',
};

/** Resting garment geometry in meters, ready to be drawn as one mesh. */
export interface SettledGarment {
  /** Merged particle positions of every panel. */
  readonly positions: Float32Array;
  /** Merged triangle indices into `positions`. */
  readonly indices: Uint32Array;
}

/** One settle at a time: five catalogue rows must not each build their own solver at once. */
let tail: Promise<unknown> = Promise.resolve();

/** Settles one template and returns its resting geometry, or null when it cannot be simulated. */
export function settleTemplate(
  template: GarmentTemplate,
  device: GPUDevice,
): Promise<SettledGarment | null> {
  const run = tail.then(() => settle(template, device), () => settle(template, device));
  tail = run.then(() => undefined, () => undefined);
  return run;
}

/** Mesh data of a settled garment, drawn on its own against the preview backdrop. */
export function thumbnailMeshes(settled: SettledGarment): AssetMesh[] {
  return [{
    name: 'garment',
    mesh: {
      topology: 'triangle',
      streams: {
        position: settled.positions,
        normal: computeVertexNormals(settled.positions, settled.indices),
      },
      index: settled.indices,
    },
    material: GARMENT_MATERIAL,
  }];
}

/** Builds the cloth on the template's own body, dresses it and lets it hang. */
async function settle(template: GarmentTemplate, device: GPUDevice): Promise<SettledGarment | null> {
  const project = createDefaultProject('template-preview');
  const fabricId = Object.keys(project.fabrics)[0];
  if (!fabricId) return null;
  project.pattern = template.generate(fabricId);

  const meshes = buildMeshes(project.pattern);
  if (meshes.size === 0) return null;
  const assembly = new ClothAssembly();
  const input = assembly.build(project, meshes, new BodyLandmarkCache());
  if (!input) return null;

  const simulator = new ClothSimulator(device);
  try {
    await simulator.setup(input, bodyCollider(project.avatar.params), project.scene.simulation);
    const controller = dressingController(simulator, assembly, input.positions);
    if (!(await controller.beginDress(project))) return null;

    let frames = 0;
    for (;;) {
      frames += 1;
      if (!(await controller.stepDressingFrame())) break;
    }
    // Free physics carries the garment the rest of the way; read back now and then so
    // self-collision keeps up, then once more for the frame that becomes the thumbnail.
    for (let frame = frames; frame < SETTLE_FRAMES; frame++) {
      simulator.step(project.scene.simulation, FALLBACK_PHYSICS);
      if ((frame + 1) % READBACK_STRIDE === 0) await simulator.readback();
    }

    const { positions } = await simulator.readback();
    const resting = new Float32Array(input.particleCount * 3);
    resting.set(positions.subarray(0, resting.length));
    if (!hasFinitePositions(resting)) return null;
    return { positions: resting, indices: input.indices };
  } catch (error) {
    console.warn(`Template ${template.key} could not be simulated:`, error);
    return null;
  } finally {
    simulator.destroy();
  }
}

/** Wires the dressing animation to a solver it does not own. */
function dressingController(
  simulator: ClothSimulator,
  assembly: ClothAssembly,
  initial: Float32Array,
): DressingController {
  let positions: Float32Array = initial.slice();
  return new DressingController({
    simulator: () => simulator,
    simReady: () => true,
    ensureSimulator: async () => undefined,
    step: async (config: SimulationConfig, fabric) => {
      simulator.step(config, fabric);
      positions = (await simulator.readback()).positions;
    },
    resetPositions: () => {
      simulator.reset(initial);
      positions = initial.slice();
    },
    currentPositions: () => positions,
    dressTargets: () => assembly.dressPositions,
  });
}

/** One panel mesh per pattern piece, skipping pieces that cannot be meshed. */
function buildMeshes(pattern: Pattern): Map<string, PanelMesh> {
  const out = new Map<string, PanelMesh>();
  for (const panelId of Object.keys(pattern.panels)) {
    const mesh = buildPanelMesh(pattern, panelId, PREVIEW_RESOLUTION_CM);
    if (mesh) out.set(panelId, mesh);
  }
  return out;
}

/** Body surface the cloth collides with, as the triangle soup the collider grid indexes. */
function bodyCollider(params: AvatarParams): AvatarCollider | null {
  const body = makehumanBody(params);
  const triangles = new Float32Array(body.bodyIndices.length * 3);
  for (let i = 0; i < body.bodyIndices.length; i++) {
    const source = body.bodyIndices[i]! * 3;
    triangles[i * 3] = body.positions[source]!;
    triangles[i * 3 + 1] = body.positions[source + 1]!;
    triangles[i * 3 + 2] = body.positions[source + 2]!;
  }
  const mesh = buildMeshCollider(triangles);
  return mesh ? { mesh } : null;
}

/** Whether every settled position is a real number; a blown-up solve has no thumbnail. */
function hasFinitePositions(positions: Float32Array): boolean {
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) return false;
  }
  return positions.length > 0;
}
