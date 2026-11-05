import type { ObjectTransform, Project } from '@/model/types';
import { IDENTITY_TRANSFORM } from '@/model/defaults';

/** Outliner id of the scene root row. */
export const SCENE_ROOT_ID = '@scene';

// Outliner rows with no project object behind them.
export const AVATAR_NODE_ID = '@avatar';
export const CAMERA_NODE_ID = '@camera';
export const ENVIRONMENT_NODE_ID = '@env';
export const GARMENT_COLLECTION_ID = '@collection:garment';
export const REFERENCE_COLLECTION_ID = '@collection:reference';
export const LIGHT_COLLECTION_ID = '@collection:light';
export const SEAM_COLLECTION_ID = '@collection:seam';
export const PRINT_COLLECTION_ID = '@collection:print';
export const TOPSTITCH_COLLECTION_ID = '@collection:topstitch';
export const TRIM_COLLECTION_ID = '@collection:trim';

/** Outliner id of an imported reference object. */
export function referenceNodeId(id: string): string {
  return `@ref:${id}`;
}

/** Project id behind a reference row's outliner id. */
export function referenceObjectId(nodeId: string): string {
  return nodeId.slice('@ref:'.length);
}

/** Outliner id of one project light. */
export function lightNodeId(id: string): string {
  return `@light:${id}`;
}

/** Project id behind a light row's outliner id. */
export function lightObjectId(nodeId: string): string {
  return nodeId.slice('@light:'.length);
}

/** Outliner id of one seam's stitch line. */
export function seamNodeId(id: string): string {
  return `@seam:${id}`;
}

/** Pattern id behind a seam row's outliner id. */
export function seamObjectId(nodeId: string): string {
  return nodeId.slice('@seam:'.length);
}

/** Whether an id belongs to a non-panel scene object rather than the pattern. */
export function isSceneNodeId(id: string): boolean {
  return id.startsWith('@');
}

/** Reads a node's stored transform; nodes without one report the identity. */
export function readTransform(project: Project, nodeId: string): ObjectTransform | null {
  if (nodeId === AVATAR_NODE_ID) return project.avatar.transform ?? IDENTITY_TRANSFORM;
  if (nodeId.startsWith('@ref:')) {
    const ref = (project.scene.referenceObjects ?? []).find(r => r.id === referenceObjectId(nodeId));
    return ref ? ref.transform ?? IDENTITY_TRANSFORM : null;
  }
  if (isSceneNodeId(nodeId)) return null;
  const panel = project.pattern.panels[nodeId];
  return panel ? panel.transform ?? IDENTITY_TRANSFORM : null;
}

/** Writes a node's transform in place. */
export function writeTransform(project: Project, nodeId: string, transform: ObjectTransform): void {
  const next: ObjectTransform = {
    position: { ...transform.position },
    rotationEuler: { ...transform.rotationEuler },
    scale: { ...transform.scale },
  };
  if (nodeId === AVATAR_NODE_ID) {
    project.avatar.transform = next;
    return;
  }
  if (nodeId.startsWith('@ref:')) {
    const ref = (project.scene.referenceObjects ?? []).find(r => r.id === referenceObjectId(nodeId));
    if (ref) ref.transform = next;
    return;
  }
  if (isSceneNodeId(nodeId)) return;
  const panel = project.pattern.panels[nodeId];
  if (panel) panel.transform = next;
}
