import type { LightConfig, Project, SceneConfig } from '@/model/types';
import type { DiffAccumulator } from '@/runtime/diff/diffTypes';

import { floorVisible, normalizeFloor, normalizeLights } from '@/model';
import { sameJson } from '@/runtime/diff/sameJson';

function environmentOf(lights: LightConfig): unknown {
  return [lights.iblSource ?? null, lights.iblUrl ?? null, lights.iblObjectKey ?? null,
    lights.iblName ?? null, lights.iblEnabled, lights.iblIntensity];
}

function floorState(scene: SceneConfig): unknown {
  return { ...normalizeFloor(scene.floor), visible: floorVisible(scene) };
}

export function diffScene(prev: Project, next: Project, out: DiffAccumulator): void {
  const prevScene = prev.scene;
  const nextScene = next.scene;
  if (!sameJson(environmentOf(prevScene.lights), environmentOf(nextScene.lights))) {
    out.aspects.add('scene.environment');
  }

  collectLightChanges(prevScene.lights, nextScene.lights, out);
  if (!sameJson(prevScene.simulation, nextScene.simulation)) out.aspects.add('scene.simulation');
  if (prevScene.simulation.clothThicknessCm !== nextScene.simulation.clothThicknessCm) {
    out.aspects.add('cloth.layer');
  }

  if (!sameJson(prevScene.referenceObjects ?? [], nextScene.referenceObjects ?? [])) {
    out.aspects.add('scene.references');
  }

  if (!sameJson(floorState(prevScene), floorState(nextScene))) out.aspects.add('scene.floor');
  if (!sameJson(prevScene.cameraAnimation ?? null, nextScene.cameraAnimation ?? null)) {
    out.aspects.add('scene.camera');
  }
}

function collectLightChanges(prev: LightConfig, next: LightConfig, out: DiffAccumulator): void {
  const unvisited = new Map(normalizeLights(prev).map(light => [light.id, light]));
  for (const light of normalizeLights(next)) {
    const previous = unvisited.get(light.id);
    if (!previous) {
      out.lightStructure = true;
      out.lightIds.add(light.id);
      continue;
    }

    if (previous.type !== light.type) out.lightStructure = true;
    if (!sameJson(previous, light)) out.lightIds.add(light.id);
    unvisited.delete(light.id);
  }

  for (const id of unvisited.keys()) {
    out.lightStructure = true;
    out.lightIds.add(id);
  }

  if (out.lightIds.size > 0) out.aspects.add('scene.light');
}
