import { describe, expect, it } from 'vitest';
import { createDefaultProject, createFabric, FABRIC_PHYSICS_PRESETS } from '../../../src/core/model/defaults';
import { DEFAULT_TSHIRT_PARAMS, generateTShirt } from '../../../src/pattern/template/tShirtTemplate';
import type { PanelMesh } from '../../../src/pattern/panel/panelBuilder';
import type { ClothSimInput } from '../../../src/sim/clothSimulator';
import type { ClothMeshManager as ClothMeshHandle } from '../../../src/render/material/fabricMaterial';
import type { Material, MeshPhysicalMaterial } from 'three/webgpu';
import type { FabricPhysics, Project } from '../../../src/core/model/types';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const { GarmentEngine } = await import('../../../src/core/engine/garmentEngine');
const { buildPanelMesh } = await import('../../../src/pattern/panel/panelBuilder');
const { ClothMeshManager } = await import('../../../src/render/material/fabricMaterial');
const THREE = await import('three/webgpu');

/** Engine internals reached without a renderer, for merge and material binding. */
interface ClothInternals {
  panelMeshes: Map<string, PanelMesh>;
  mergedInput: ClothSimInput | null;
  clothMeshes: Map<string, ClothMeshHandle>;
  simulator: unknown;
  mergePanelMeshes: (project: Project) => ClothSimInput;
  bindClothMaterials: (project: Project, mode: 'shaded') => void;
  applyFabrics: (project: Project, mode?: 'shaded') => void;
  applyPanelVisibility: (project: Project) => void;
}

/** A T-shirt whose panels alternate between two material records. */
function twoFabricProject(): { project: Project; panelIds: string[]; first: string; second: string } {
  const project = createDefaultProject();
  const cotton = Object.values(project.fabrics)[0];
  project.pattern = generateTShirt(DEFAULT_TSHIRT_PARAMS, cotton.id);
  const panelIds = Object.keys(project.pattern.panels);
  const denim = createFabric('denim', '牛仔布');
  project.fabrics[denim.id] = denim;
  panelIds.forEach((id, i) => {
    if (i % 2 === 1) project.pattern.panels[id].fabricId = denim.id;
  });
  return { project, panelIds, first: cotton.id, second: denim.id };
}

/** Merges every panel mesh of the project into one simulation input. */
function merge(project: Project): ClothInternals {
  const engine = new GarmentEngine({} as never);
  const internals = engine as unknown as ClothInternals;
  const resolutionCm = project.scene.simulation.meshResolutionCm ?? 2;
  for (const panelId of Object.keys(project.pattern.panels)) {
    const mesh = buildPanelMesh(project.pattern, panelId, resolutionCm);
    if (mesh) internals.panelMeshes.set(panelId, mesh);
  }
  internals.mergedInput = internals.mergePanelMeshes(project);
  return internals;
}

/** The merged cloth plus its materials, as the viewport leaves it after a build. */
function clothFor(project: Project): { internals: ClothInternals; manager: ClothMeshHandle } {
  const internals = merge(project);
  const input = internals.mergedInput!;
  const manager = new ClothMeshManager(
    input.positions, input.indices, new Float32Array(input.particleCount * 2),
    new THREE.MeshBasicMaterial(),
  );
  internals.clothMeshes.set('__merged__', manager);
  internals.applyFabrics(project, 'shaded');
  return { internals, manager };
}

function materialsOf(manager: ClothMeshHandle): Material[] {
  const current = manager.mesh.material;
  return Array.isArray(current) ? current : [current];
}

describe('per-panel cloth materials', () => {
  it('carries each panel material physics into the simulation input', () => {
    const { project, panelIds, first, second } = twoFabricProject();
    const internals = merge(project);
    const panels = internals.mergedInput!.panels;
    expect(panels.map(p => p.panelId)).toEqual(panelIds);
    panels.forEach((panel, i) => {
      const expected = i % 2 === 0 ? FABRIC_PHYSICS_PRESETS.cotton : FABRIC_PHYSICS_PRESETS.denim;
      expect(panel.physics).toEqual(expected);
    });
    expect(panels[0].physics).not.toBe(panels[1].physics);
    expect(first).not.toBe(second);
  });

  it('binds one material per distinct record and one group per panel', () => {
    const { project, panelIds } = twoFabricProject();
    const internals = merge(project);
    const input = internals.mergedInput!;
    const manager = new ClothMeshManager(
      input.positions, input.indices, new Float32Array(input.particleCount * 2),
      new THREE.MeshBasicMaterial(),
    );
    internals.clothMeshes.set('__merged__', manager);
    internals.bindClothMaterials(project, 'shaded');

    // Two material records behind the panels, so two materials on the mesh.
    expect(manager.mesh.material).toHaveLength(2);
    expect(manager.geometry.groups).toHaveLength(panelIds.length);

    // Groups tile the whole merged index buffer, each pointing at its panel's material.
    let covered = 0;
    manager.geometry.groups.forEach((group, i) => {
      expect(group.start).toBe(covered);
      covered += group.count;
      expect(group.materialIndex).toBe(i % 2 === 0 ? 0 : 1);
    });
    expect(covered).toBe(input.indices.length);
  });

  it('drops the geometry group of a hidden panel', () => {
    const { project, panelIds } = twoFabricProject();
    const { internals, manager } = clothFor(project);
    const counts = internals.mergedInput!.panels.map(panel => panel.mesh.indices.length);

    project.pattern.panels[panelIds[1]].visible = false;
    internals.applyPanelVisibility(project);

    const kept = [0, 2, 3];
    expect(manager.geometry.groups.map(group => group.count)).toEqual(kept.map(i => counts[i]));
    expect(manager.geometry.groups.map(group => group.start))
      .toEqual([0, counts[0] + counts[1], counts[0] + counts[1] + counts[2]]);
    expect(manager.geometry.groups.map(group => group.materialIndex)).toEqual([0, 0, 1]);

    // Material slots stay put, so showing the panel again restores its own fabric.
    expect(materialsOf(manager)).toHaveLength(2);
    project.pattern.panels[panelIds[1]].visible = true;
    internals.applyPanelVisibility(project);
    expect(manager.geometry.groups).toHaveLength(panelIds.length);
  });
});

describe('live material refresh', () => {
  it('edits a shared material in place, keeping the bound instances', () => {
    const { project, second } = twoFabricProject();
    const cotton = Object.values(project.fabrics)[0];
    const { internals, manager } = clothFor(project);
    const before = materialsOf(manager);
    expect(before).toHaveLength(2);

    cotton.appearance = { ...cotton.appearance, baseColor: '#ff0000' };
    internals.applyFabrics(project);

    const after = materialsOf(manager);
    after.forEach((material, i) => expect(material).toBe(before[i]));
    expect((after[0] as MeshPhysicalMaterial).color.getHexString()).toBe('ff0000');
    expect((after[1] as MeshPhysicalMaterial).color.getHexString())
      .not.toBe('ff0000');
    expect(second).not.toBe(cotton.id);
  });

  it('rebinds the cloth when a panel takes another material record', () => {
    const { project, first } = twoFabricProject();
    const { internals, manager } = clothFor(project);
    expect(materialsOf(manager)).toHaveLength(2);

    Object.values(project.pattern.panels).forEach(panel => { panel.fabricId = first; });
    internals.applyFabrics(project);

    expect(materialsOf(manager)).toHaveLength(1);
  });

  it('pushes every panel physics into the live solver, once per change', () => {
    const { project } = twoFabricProject();
    const cotton = Object.values(project.fabrics)[0];
    const { internals } = clothFor(project);

    const calls: FabricPhysics[][] = [];
    internals.simulator = {
      updateMaterialPhysics: (byPanel: FabricPhysics[]) => { calls.push(byPanel); return true; },
    };

    cotton.physics = { ...cotton.physics, stretchStiffness: cotton.physics.stretchStiffness + 0.2 };
    internals.applyFabrics(project);

    expect(calls).toHaveLength(1);
    const expected = internals.mergedInput!.panels.map(
      (_, i) => i % 2 === 0 ? cotton.physics : FABRIC_PHYSICS_PRESETS.denim,
    );
    expect(calls[0]).toEqual(expected);
    expect(internals.mergedInput!.panels.map(p => p.physics)).toEqual(expected);

    // The solver now matches the project, so an identical call is skipped.
    internals.applyFabrics(project);
    expect(calls).toHaveLength(1);
  });
});
