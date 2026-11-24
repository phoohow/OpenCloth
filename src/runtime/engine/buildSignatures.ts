import type { Avatar, Project } from '@/model/types';

import { panelGeometrySignature } from '@/scene';

const geometryCache = new WeakMap<Project, Map<string, string>>();

export function avatarBodySignature(avatar: Avatar): string {
  return JSON.stringify({
    ...avatar, name: undefined, display: undefined, transform: undefined, appearance: undefined,
    softBody: undefined,
  });
}

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

export function changedPanels(prev: Project, next: Project): { changed: string[]; removed: string[] } {
  const before = geometrySignatures(prev);
  const after = geometrySignatures(next);
  const changed: string[] = [];
  for (const [panelId, signature] of after) {
    if (before.get(panelId) !== signature) changed.push(panelId);
  }

  return { changed, removed: [...before.keys()].filter(panelId => !after.has(panelId)) };
}
