/** Compiles the draw list and world into the pure-data snapshot the backend applies. */

import type {
  EntityFilter, SceneItem, SceneMesh, SceneSnapshot, VersionStamp,
} from '@/render/common';
import type { DrawList, RenderView } from '@/render/renderer/view/types';
import type { MeshId, WorldView } from '@/render/world';

/** Identity of the snapshot inputs: world versions, the drawable view axes and the texture cache. */
export function snapshotSignature(
  view: RenderView, versions: Readonly<VersionStamp>, textureVersion: number,
): string {
  return [
    versions.topology, versions.geometry, versions.transform, versions.material,
    versions.visibility, versions.lights, versions.environment, textureVersion,
    view.channels, view.layers.join(','),
    view.settings.fill, view.settings.wire,
    JSON.stringify(view.settings.wireOptions),
    JSON.stringify(view.overrides),
  ].join('|');
}

/** The only place world records become backend-facing data. */
export class SceneBuilder {
  /** Snapshot of a frame, with each mesh record included once. */
  build(world: WorldView, drawList: DrawList, versions: Readonly<VersionStamp>): SceneSnapshot {
    const meshes = new Map<MeshId, SceneMesh>();
    const items: SceneItem[] = drawList.items.map(item => {
      this.collectMesh(world, item.mesh, meshes);
      return {
        key: item.entity,
        mesh: item.mesh,
        transform: item.transform,
        rasterStage: item.stage,
        bucket: item.bucket,
        rasterMaterials: item.materials,
        traceMaterials: item.traceMaterials,
        wire: item.wire,
      };
    });
    return {
      items,
      meshes: [...meshes.values()],
      lights: world.lights(),
      environment: world.environment(),
      versions,
    };
  }

  /** Snapshot of the exportable world entities, without any display override. */
  buildExport(world: WorldView, versions: Readonly<VersionStamp>, filter?: EntityFilter): SceneSnapshot {
    const entities = world.entities(filter);
    const meshes = new Map<MeshId, SceneMesh>();
    const items: SceneItem[] = [];
    for (const entity of entities) {
      this.collectMesh(world, entity.mesh, meshes);
      const rasterMaterials = entity.materials.flatMap(ref => {
        if (ref.kind !== 'material') return [];
        const material = world.material(ref.id);
        return material ? [{ technique: material.kind, data: material, source: ref }] : [];
      });
      items.push({
        key: entity.id,
        mesh: entity.mesh,
        transform: entity.transform,
        rasterStage: 'scene',
        bucket: 'opaque',
        rasterMaterials,
        traceMaterials: rasterMaterials.filter(variant => variant.technique === 'surface'),
        wire: null,
      });
    }
    return {
      items,
      meshes: [...meshes.values()],
      lights: world.lights(),
      environment: world.environment(),
      versions,
    };
  }

  /** Adds a mesh record once; repeated references to the same mesh share it. */
  private collectMesh(
    world: WorldView, ref: SceneItem['mesh'], meshes: Map<MeshId, SceneMesh>,
  ): void {
    if (ref.kind !== 'mesh' || meshes.has(ref.id)) return;
    const mesh = world.mesh(ref.id);
    if (!mesh) return;
    meshes.set(mesh.id, {
      id: mesh.id,
      revision: mesh.revision,
      topology: mesh.topology,
      streams: mesh.streams,
      index: mesh.index,
      groups: mesh.groups,
      instances: mesh.instances,
      bounds: mesh.bounds,
    });
  }
}
