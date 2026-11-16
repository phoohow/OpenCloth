import type { LightConfig, ObjectTransform, Project, SceneLight, Vec3 } from '@/model/types';
import { IDENTITY_TRANSFORM, normalizeLights } from '@/model/defaults';
import { parseElementNodeId, type PatternElementKind } from './elementRef';

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

/** Prefix of the rows that address an object by kind; one place knows each spelling. */
const COLLECTION_PREFIX = '@collection:';
const REFERENCE_PREFIX = '@ref:';
const LIGHT_PREFIX = '@light:';
const SEAM_PREFIX = '@seam:';

/** Outliner id of an imported reference object. */
export function referenceNodeId(id: string): string {
  return `${REFERENCE_PREFIX}${id}`;
}

/** Project id behind a reference row's outliner id. */
function referenceObjectId(nodeId: string): string {
  return nodeId.slice(REFERENCE_PREFIX.length);
}

/** Outliner id of one project light. */
export function lightNodeId(id: string): string {
  return `${LIGHT_PREFIX}${id}`;
}

/** Project id behind a light row's outliner id. */
function lightObjectId(nodeId: string): string {
  return nodeId.slice(LIGHT_PREFIX.length);
}

/** Outliner id of one seam's stitch line, decoded by `parseElementNodeId`. */
export function seamNodeId(id: string): string {
  return `${SEAM_PREFIX}${id}`;
}

/**
 * A decoded node id: the object kind plus the project id behind it, or null for nodes that carry
 * no project object of their own.
 */
export type SceneRef =
  | { kind: PatternElementKind; id: string }
  | { kind: 'reference'; id: string }
  | { kind: 'light'; id: string }
  | { kind: 'avatar'; id: null }
  | { kind: 'environment'; id: null }
  | { kind: 'camera'; id: null }
  | { kind: 'scene'; id: null }
  | { kind: 'collection'; id: string }
  /** A prefixed id no reader claims; the row exists only as a string. */
  | { kind: 'unknown'; id: string };

/** Decodes any node id; ids no reader claims resolve to `unknown`, never to a panel. */
export function parseSceneRef(nodeId: string): SceneRef {
  const element = parseElementNodeId(nodeId);
  if (element) return element;
  if (nodeId === AVATAR_NODE_ID) return { kind: 'avatar', id: null };
  if (nodeId === ENVIRONMENT_NODE_ID) return { kind: 'environment', id: null };
  if (nodeId === CAMERA_NODE_ID) return { kind: 'camera', id: null };
  if (nodeId === SCENE_ROOT_ID) return { kind: 'scene', id: null };
  if (nodeId.startsWith(COLLECTION_PREFIX)) return { kind: 'collection', id: nodeId };
  if (nodeId.startsWith(REFERENCE_PREFIX)) return { kind: 'reference', id: referenceObjectId(nodeId) };
  if (nodeId.startsWith(LIGHT_PREFIX)) return { kind: 'light', id: lightObjectId(nodeId) };
  if (nodeId.startsWith('@')) return { kind: 'unknown', id: nodeId };
  return { kind: 'panel', id: nodeId };
}

/** Reads a node's transform; a light reports its position under the identity rotation. */
export function readNodeTransform(project: Project, nodeId: string): ObjectTransform | null {
  const ref = parseSceneRef(nodeId);
  switch (ref.kind) {
    case 'avatar': return project.avatar.transform ?? IDENTITY_TRANSFORM;
    case 'reference': {
      const record = (project.scene.referenceObjects ?? []).find(r => r.id === ref.id);
      return record ? record.transform ?? IDENTITY_TRANSFORM : null;
    }
    case 'panel': {
      const panel = project.pattern.panels[ref.id];
      return panel ? panel.transform ?? IDENTITY_TRANSFORM : null;
    }
    case 'light': {
      const light = normalizeLights(project.scene.lights).find(l => l.id === ref.id);
      return light ? { ...IDENTITY_TRANSFORM, position: { ...light.position } } : null;
    }
    default: return null;
  }
}

/** Writes a node's transform in place; false when it stores none. */
export function writeNodeTransform(project: Project, nodeId: string, transform: ObjectTransform): boolean {
  const next: ObjectTransform = {
    position: { ...transform.position },
    rotationEuler: { ...transform.rotationEuler },
    scale: { ...transform.scale },
  };
  const ref = parseSceneRef(nodeId);
  switch (ref.kind) {
    case 'avatar': {
      project.avatar.transform = next;
      return true;
    }
    case 'reference': {
      const record = (project.scene.referenceObjects ?? []).find(r => r.id === ref.id);
      if (!record) return false;
      record.transform = next;
      return true;
    }
    case 'panel': {
      const panel = project.pattern.panels[ref.id];
      if (!panel) return false;
      panel.transform = next;
      return true;
    }
    // A light only moves: writing keeps the aim offset, so the beam keeps its direction.
    case 'light': return moveLight(project, ref.id, next.position);
    default: return false;
  }
}

/** The same light moved to a new position, keeping its aim offset so the beam keeps its direction. */
export function lightAtPosition(lights: LightConfig, lightId: string, position: Vec3): SceneLight | null {
  const light = normalizeLights(lights).find(l => l.id === lightId);
  if (!light) return null;
  const offset = {
    x: light.target.x - light.position.x,
    y: light.target.y - light.position.y,
    z: light.target.z - light.position.z,
  };
  return {
    ...light,
    position: { ...position },
    target: { x: position.x + offset.x, y: position.y + offset.y, z: position.z + offset.z },
  };
}

/** Moves one light in place; false when no light has that id. */
function moveLight(project: Project, lightId: string, position: Vec3): boolean {
  const lights = normalizeLights(project.scene.lights);
  const index = lights.findIndex(l => l.id === lightId);
  if (index < 0) return false;
  const moved = lightAtPosition(project.scene.lights, lightId, position);
  if (!moved) return false;
  lights[index] = moved;
  project.scene = { ...project.scene, lights: { ...project.scene.lights, lights } };
  return true;
}
