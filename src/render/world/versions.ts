import type { RenderVersions } from '@/render/world/types';

export function createVersions(): RenderVersions {
  return {
    topology: 0,
    geometry: 0,
    transform: 0,
    material: 0,
    visibility: 0,
    lights: 0,
    environment: 0,
  };
}

export function bump<K extends keyof RenderVersions>(versions: RenderVersions, key: K): void {
  versions[key] += 1;
}
