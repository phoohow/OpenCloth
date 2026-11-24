import type { ObjectTransform, Project } from '@/model/types';

import { IDENTITY_TRANSFORM, parseSceneRef, readNodeTransform } from '@/model';

export interface GizmoTarget {
  row: string;
  kind: 'panel' | 'object';
  translateOnly: boolean;
  transform: ObjectTransform;
}

export function gizmoTargets(project: Project, selection: readonly string[]): GizmoTarget[] {
  const panels: GizmoTarget[] = [];
  for (const row of selection) {
    const ref = parseSceneRef(row);
    if (ref.kind !== 'panel') continue;
    const panel = project.pattern.panels[ref.id];
    if (!panel || panel.visible === false) continue;
    panels.push({
      row, kind: 'panel', translateOnly: false, transform: panel.transform ?? IDENTITY_TRANSFORM,
    });
  }

  if (panels.length > 0) return panels;

  const objects: GizmoTarget[] = [];
  for (const row of selection) {
    const ref = parseSceneRef(row);
    if (ref.kind !== 'avatar' && ref.kind !== 'floor' && ref.kind !== 'reference' && ref.kind !== 'light') continue;
    const transform = readNodeTransform(project, row);
    if (transform) {
      objects.push({ row, kind: 'object', translateOnly: ref.kind === 'light', transform });
    }
  }

  return objects.length === 1 ? objects : [];
}
