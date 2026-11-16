import type { Avatar, Project } from '@/model/types';
import { panelGeometrySignature } from '@/pattern/panel';

/**
 * Everything the visible body, its collision mesh and the drape wrap read: measurements, build
 * and source. Display, name and scene transform only affect drawing.
 */
export function avatarBodySignature(avatar: Avatar): string {
  return JSON.stringify({
    ...avatar, name: undefined, display: undefined, transform: undefined, appearance: undefined,
    softBody: undefined,
  });
}

/** panelId → geometry signature across the whole pattern. */
const geometryCache = new WeakMap<Project, Map<string, string>>();

/**
 * Signature map for one project revision. A revision object is immutable, so a cached map stays
 * valid while the revision is reachable: consecutive edits only pay for the new one.
 */
export function geometrySignatures(project: Project): Map<string, string> {
  const cached = geometryCache.get(project);
  if (cached) return cached;
  const map = new Map<string, string>();
  for (const panelId of Object.keys(project.pattern.panels)) {
    map.set(panelId, panelGeometrySignature(project.pattern, project.scene.simulation, panelId));
  }
  geometryCache.set(project, map);
  return map;
}

/** Panels whose geometry differs between two revisions, and the ones that disappeared. */
export function changedPanels(prev: Project, next: Project): { changed: string[]; removed: string[] } {
  const before = geometrySignatures(prev);
  const after = geometrySignatures(next);
  const changed: string[] = [];
  for (const [panelId, signature] of after) {
    if (before.get(panelId) !== signature) changed.push(panelId);
  }
  return { changed, removed: [...before.keys()].filter(panelId => !after.has(panelId)) };
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
