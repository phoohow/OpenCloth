/** Change counters the world bumps; consumers compare their own snapshot. */

import type { RenderVersions } from '@/render/world/types';

/** Fresh counters for a new world. */
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

/** Bumps one counter. */
export function bump<K extends keyof RenderVersions>(versions: RenderVersions, key: K): void {
  versions[key] += 1;
}
