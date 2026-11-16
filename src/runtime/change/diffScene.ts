import type { LightConfig, Project } from '@/model/types';
import { normalizeLights } from '@/model';
import type { DiffAccumulator } from './diffTypes';
import { sameJson } from './sameJson';

/** Environment image, backdrop and strength: everything the IBL pass reads. */
function environmentOf(lights: LightConfig): unknown {
  return [lights.iblUrl ?? null, lights.iblObjectKey ?? null, lights.iblName ?? null,
    lights.iblEnabled, lights.iblIntensity];
}

/** Reports the scene concerns two revisions differ in, with per-light detail. */
export function diffScene(prev: Project, next: Project, out: DiffAccumulator): void {
  const prevScene = prev.scene;
  const nextScene = next.scene;
  if (!sameJson(environmentOf(prevScene.lights), environmentOf(nextScene.lights))) {
    out.aspects.add('scene.environment');
  }
  collectLightChanges(prevScene.lights, nextScene.lights, out);
  if (!sameJson(prevScene.simulation, nextScene.simulation)) out.aspects.add('scene.simulation');
  if (!sameJson(prevScene.referenceObjects ?? [], nextScene.referenceObjects ?? [])) {
    out.aspects.add('scene.references');
  }
  if (!sameJson(prevScene.cameraAnimation ?? null, nextScene.cameraAnimation ?? null)) {
    out.aspects.add('scene.camera');
  }
}

/** Lights whose own fields changed, and whether the set of lights itself changed. */
function collectLightChanges(prev: LightConfig, next: LightConfig, out: DiffAccumulator): void {
  const unvisited = new Map(normalizeLights(prev).map(light => [light.id, light]));
  for (const light of normalizeLights(next)) {
    const previous = unvisited.get(light.id);
    if (!previous) {
      out.lightStructure = true;
      out.lightIds.add(light.id);
      continue;
    }
    // Switching type reinterprets every field, so the slot is rebuilt rather than patched.
    if (previous.type !== light.type) out.lightStructure = true;
    if (!sameJson(previous, light)) out.lightIds.add(light.id);
    unvisited.delete(light.id);
  }
  // Whatever is left in the map was removed from the scene.
  for (const id of unvisited.keys()) {
    out.lightStructure = true;
    out.lightIds.add(id);
  }
  if (out.lightIds.size > 0) out.aspects.add('scene.light');
}
