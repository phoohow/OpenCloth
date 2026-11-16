/**
 * Visibility and display name of every scene node: the one place that knows which object holds
 * which flag. The outliner row itself is built in `ui/sceneTree`, which also reads the flag.
 */

import type { Pattern, Project } from '@/model/types';
import { elementNodeId } from './elementRef';
import { normalizeLights } from './defaults';
import {
  ENVIRONMENT_NODE_ID, GARMENT_COLLECTION_ID, LIGHT_COLLECTION_ID,
  PRINT_COLLECTION_ID, REFERENCE_COLLECTION_ID, SEAM_COLLECTION_ID,
  TOPSTITCH_COLLECTION_ID, TRIM_COLLECTION_ID, lightNodeId, parseSceneRef, referenceNodeId,
  seamNodeId,
} from './sceneNodes';

/** State of one scene node; fields are null when the node has no such concept. */
export interface NodeState {
  /** Null when the node has no viewport visibility flag. */
  visible: boolean | null;
  /** Null when the node derives its label from the object instead of a stored name. */
  name: string | null;
}

/** Production object kinds that carry their own visibility flag. */
export type ProductionKind = 'print' | 'topstitch' | 'trim';

/** Records backing one production object kind. */
function productionRecords(pattern: Pattern, kind: ProductionKind): Record<string, { visible: boolean }> {
  return kind === 'print' ? pattern.prints ?? {} : kind === 'topstitch' ? pattern.topstitches ?? {} : pattern.trims ?? {};
}

/** Node ids a collection groups, in outliner order. */
export function collectionMemberRows(project: Project, collectionId: string): string[] {
  switch (collectionId) {
    case GARMENT_COLLECTION_ID:
      return Object.keys(project.pattern.panels);
    case SEAM_COLLECTION_ID:
      return Object.keys(project.pattern.seams).map(seamNodeId);
    case PRINT_COLLECTION_ID:
    case TOPSTITCH_COLLECTION_ID:
    case TRIM_COLLECTION_ID: {
      const kind = collectionId === PRINT_COLLECTION_ID ? 'print'
        : collectionId === TOPSTITCH_COLLECTION_ID ? 'topstitch' : 'trim';
      return Object.keys(productionRecords(project.pattern, kind)).map(id => elementNodeId(kind, id));
    }
    case REFERENCE_COLLECTION_ID:
      return (project.scene.referenceObjects ?? []).map(ref => referenceNodeId(ref.id));
    case LIGHT_COLLECTION_ID:
      return [...normalizeLights(project.scene.lights).map(light => lightNodeId(light.id)), ENVIRONMENT_NODE_ID];
    default:
      return [];
  }
}

/** Whether a node has a visibility flag the document can write. */
export function isNodeVisibleWritable(project: Project, nodeId: string): boolean {
  const ref = parseSceneRef(nodeId);
  if (ref.kind === 'collection') return collectionMemberRows(project, ref.id).length > 0;
  return readNodeVisible(project, nodeId) !== null;
}

/** Stored display name of a node, or null when it labels itself from its kind. */
export function readNodeName(project: Project, nodeId: string): string | null {
  const pattern = project.pattern;
  const ref = parseSceneRef(nodeId);
  switch (ref.kind) {
    case 'panel': return pattern.panels[ref.id]?.name ?? null;
    case 'point': return pattern.points[ref.id]?.name ?? null;
    case 'edge': return pattern.edges[ref.id]?.name ?? null;
    case 'internal': return pattern.internalLines[ref.id]?.name ?? null;
    case 'dart': return pattern.darts[ref.id]?.name ?? null;
    case 'seam': return pattern.seams[ref.id]?.name ?? null;
    case 'notch': return pattern.notches?.[ref.id]?.name ?? null;
    case 'annotation': return pattern.annotations?.[ref.id]?.name ?? null;
    case 'measurement': return pattern.measurements?.[ref.id]?.name ?? null;
    case 'print': return pattern.prints?.[ref.id]?.name ?? null;
    case 'topstitch': return pattern.topstitches?.[ref.id]?.name ?? null;
    case 'trim': return pattern.trims?.[ref.id]?.name ?? null;
    case 'avatar': return project.avatar.name ?? null;
    case 'environment': return project.scene.lights.iblLabel ?? null;
    case 'camera': return project.scene.cameraName ?? null;
    case 'reference':
      return (project.scene.referenceObjects ?? []).find(r => r.id === ref.id)?.name ?? null;
    case 'light': return normalizeLights(project.scene.lights).find(l => l.id === ref.id)?.name ?? null;
    default: return null;
  }
}

/** Visibility of one node; null when the node has no flag or does not exist. */
export function readNodeVisible(project: Project, nodeId: string): boolean | null {
  const pattern = project.pattern;
  const ref = parseSceneRef(nodeId);
  switch (ref.kind) {
    case 'panel': return pattern.panels[ref.id]?.visible ?? null;
    case 'seam': return pattern.seams[ref.id]?.stitchVisible ?? null;
    case 'print':
    case 'topstitch':
    case 'trim': {
      const record = productionRecords(pattern, ref.kind)[ref.id];
      return record ? record.visible !== false : null;
    }
    case 'avatar': return project.avatar.display !== 'hidden';
    case 'environment': return project.scene.lights.iblEnabled;
    case 'light': return normalizeLights(project.scene.lights).find(l => l.id === ref.id)?.enabled ?? null;
    case 'reference': {
      const record = (project.scene.referenceObjects ?? []).find(r => r.id === ref.id);
      return record ? record.visible : null;
    }
    case 'collection': {
      const members = collectionMemberRows(project, ref.id);
      if (members.length === 0) return false;
      return members.every(member => readNodeVisible(project, member) === true);
    }
    default: return null;
  }
}

/** Visibility and name of one node, or null when no reader claims it. */
export function readNodeState(project: Project, nodeId: string): NodeState | null {
  if (parseSceneRef(nodeId).kind === 'unknown') return null;
  return { visible: readNodeVisible(project, nodeId), name: readNodeName(project, nodeId) };
}

/** Writes one node's visibility; returns false when the node has no such flag. */
export function writeNodeVisible(project: Project, nodeId: string, visible: boolean): boolean {
  const pattern = project.pattern;
  const ref = parseSceneRef(nodeId);
  switch (ref.kind) {
    case 'panel': {
      const panel = pattern.panels[ref.id];
      if (!panel) return false;
      panel.visible = visible;
      return true;
    }
    case 'seam': {
      const seam = pattern.seams[ref.id];
      if (!seam) return false;
      seam.stitchVisible = visible;
      return true;
    }
    case 'print':
    case 'topstitch':
    case 'trim': {
      const record = productionRecords(pattern, ref.kind)[ref.id];
      if (!record) return false;
      record.visible = visible;
      return true;
    }
    // Display is a single enum, so hiding drops the half-transparent variant: turning the body
    // back on always returns the opaque one, which is what the properties panel then shows.
    case 'avatar': {
      if (visible) {
        if (project.avatar.display === 'hidden') project.avatar.display = 'visible';
      } else {
        project.avatar.display = 'hidden';
      }
      return true;
    }
    case 'environment': {
      project.scene = { ...project.scene, lights: { ...project.scene.lights, iblEnabled: visible } };
      return true;
    }
    case 'light': {
      const lights = normalizeLights(project.scene.lights);
      const index = lights.findIndex(l => l.id === ref.id);
      if (index < 0) return false;
      lights[index] = { ...lights[index]!, enabled: visible };
      project.scene = { ...project.scene, lights: { ...project.scene.lights, lights } };
      return true;
    }
    case 'reference': {
      const record = (project.scene.referenceObjects ?? []).find(r => r.id === ref.id);
      if (!record) return false;
      record.visible = visible;
      project.scene = { ...project.scene };
      return true;
    }
    case 'collection': {
      const members = collectionMemberRows(project, ref.id);
      if (members.length === 0) return false;
      let wrote = false;
      for (const member of members) wrote = writeNodeVisible(project, member, visible) || wrote;
      return wrote;
    }
    default: return false;
  }
}

/** Writes one node's display name; a blank name clears the override where the node allows one. */
export function writeNodeName(project: Project, nodeId: string, name: string): boolean {
  const trimmed = name.trim();
  const optional = trimmed || undefined;
  const pattern = project.pattern;
  const ref = parseSceneRef(nodeId);
  switch (ref.kind) {
    // Panels keep a required name, so a blank edit leaves it unchanged.
    case 'panel': {
      const panel = pattern.panels[ref.id];
      if (!panel) return false;
      if (trimmed) panel.name = trimmed;
      return true;
    }
    case 'point': {
      const point = pattern.points[ref.id];
      if (!point) return false;
      point.name = optional;
      return true;
    }
    case 'edge': {
      const edge = pattern.edges[ref.id];
      if (!edge) return false;
      edge.name = optional;
      return true;
    }
    case 'internal': {
      const line = pattern.internalLines[ref.id];
      if (!line) return false;
      line.name = optional;
      return true;
    }
    case 'dart': {
      const dart = pattern.darts[ref.id];
      if (!dart) return false;
      dart.name = optional;
      return true;
    }
    case 'seam': {
      const seam = pattern.seams[ref.id];
      if (!seam) return false;
      seam.name = optional;
      return true;
    }
    case 'notch': {
      const notch = pattern.notches?.[ref.id];
      if (!notch) return false;
      notch.name = optional;
      return true;
    }
    case 'annotation': {
      const note = pattern.annotations?.[ref.id];
      if (!note) return false;
      note.name = optional;
      return true;
    }
    case 'measurement': {
      const measurement = pattern.measurements?.[ref.id];
      if (!measurement) return false;
      measurement.name = optional;
      return true;
    }
    case 'print': {
      const print = pattern.prints?.[ref.id];
      if (!print) return false;
      print.name = optional;
      return true;
    }
    case 'topstitch': {
      const stitch = pattern.topstitches?.[ref.id];
      if (!stitch) return false;
      stitch.name = optional;
      return true;
    }
    case 'trim': {
      const trim = pattern.trims?.[ref.id];
      if (!trim) return false;
      trim.name = optional;
      return true;
    }
    case 'avatar': {
      project.avatar.name = optional;
      return true;
    }
    case 'environment': {
      project.scene = { ...project.scene, lights: { ...project.scene.lights, iblLabel: optional } };
      return true;
    }
    case 'camera': {
      project.scene = { ...project.scene, cameraName: optional };
      return true;
    }
    // Reference and light nodes keep a required name, so a blank edit leaves it unchanged.
    case 'reference': {
      const record = (project.scene.referenceObjects ?? []).find(r => r.id === ref.id);
      if (!record) return false;
      if (trimmed) record.name = trimmed;
      return true;
    }
    case 'light': {
      // The node keeps a required name, so a blank edit leaves the light list untouched.
      if (!trimmed) return true;
      const lights = normalizeLights(project.scene.lights);
      const index = lights.findIndex(l => l.id === ref.id);
      if (index < 0) return false;
      lights[index] = { ...lights[index]!, name: trimmed };
      project.scene = { ...project.scene, lights: { ...project.scene.lights, lights } };
      return true;
    }
    default: return false;
  }
}
