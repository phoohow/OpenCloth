/** Rows the transform gizmo can move, resolved once for both the overlay and the drag. */

import type { ObjectTransform, Project } from '@/model/types';
import { IDENTITY_TRANSFORM, parseSceneRef, readNodeTransform } from '@/model';

/** One row the gizmo can move. */
export interface GizmoTarget {
  /** Selection row the target was picked from, spelled as the selection spells it. */
  row: string;
  /** Panels drag through the cloth engine; scene objects move on their own. */
  kind: 'panel' | 'object';
  /** Lights only translate: their placement carries no orientation of its own. */
  translateOnly: boolean;
  transform: ObjectTransform;
}

/**
 * Rows the gizmo can move out of a selection. Panel picks win when the selection mixes kinds,
 * and a scene-object drag handles one row at a time.
 */
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
    if (ref.kind !== 'avatar' && ref.kind !== 'reference' && ref.kind !== 'light') continue;
    const transform = readNodeTransform(project, row);
    // A light has no orientation of its own, so only its position can be dragged.
    if (transform) {
      objects.push({ row, kind: 'object', translateOnly: ref.kind === 'light', transform });
    }
  }
  return objects.length === 1 ? objects : [];
}
