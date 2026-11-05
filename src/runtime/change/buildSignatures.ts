import type { Avatar, Project } from '@/model/types';
import { panelGeometrySignature } from '@/pattern/panel';

/**
 * Everything the visible body, its collision capsules and the drape wrap read: measurements,
 * pose and source. Display, name and scene transform only affect drawing.
 */
export function avatarBodySignature(avatar: Avatar): string {
  return JSON.stringify({
    ...avatar, name: undefined, display: undefined, transform: undefined, appearance: undefined,
    softBody: undefined,
  });
}

/** panelId → geometry signature across the whole pattern. */
export function geometrySignatures(project: Project): Map<string, string> {
  const map = new Map<string, string>();
  for (const panelId of Object.keys(project.pattern.panels)) {
    map.set(panelId, panelGeometrySignature(project.pattern, project.scene.simulation, panelId));
  }
  return map;
}

/** Identity of the merged particle/triangle/seam layout a live solver was built for. */
export function clothLayoutFingerprint(input: {
  particleCount: number;
  triangleCount: number;
  panels: Array<{ panelId: string; vertexOffset: number; mesh: { vertexCount: number } }>;
  seamConstraints?: unknown[];
}, seamPairCount = 0): string {
  return [
    input.particleCount, input.triangleCount, seamPairCount,
    input.panels.map(p => `${p.panelId}@${p.vertexOffset}x${p.mesh.vertexCount}`).join(','),
  ].join('|');
}
