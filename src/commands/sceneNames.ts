import type { Project } from '@/model/types';
import {
  AVATAR_NODE_ID, CAMERA_NODE_ID, ENVIRONMENT_NODE_ID, lightObjectId, normalizeLights,
  parseElementNodeId, referenceObjectId,
} from '@/model';

/** Stored display name behind a row, or null when it labels itself from its kind. */
export function storedSceneName(project: Project, nodeId: string): string | null {
  const pattern = project.pattern;
  const element = parseElementNodeId(nodeId);
  if (element) {
    switch (element.kind) {
      case 'panel': return pattern.panels[element.id]?.name ?? null;
      case 'point': return pattern.points[element.id]?.name ?? null;
      case 'edge': return pattern.edges[element.id]?.name ?? null;
      case 'internal': return pattern.internalLines[element.id]?.name ?? null;
      case 'dart': return pattern.darts[element.id]?.name ?? null;
      case 'seam': return pattern.seams[element.id]?.name ?? null;
      case 'notch': return pattern.notches?.[element.id]?.name ?? null;
      case 'annotation': return pattern.annotations?.[element.id]?.name ?? null;
      case 'measurement': return pattern.measurements?.[element.id]?.name ?? null;
      case 'print': return pattern.prints?.[element.id]?.name ?? null;
      case 'topstitch': return pattern.topstitches?.[element.id]?.name ?? null;
      case 'trim': return pattern.trims?.[element.id]?.name ?? null;
    }
  }
  const panel = project.pattern.panels[nodeId];
  if (panel) return panel.name ?? null;
  if (nodeId === AVATAR_NODE_ID) return project.avatar.name ?? null;
  if (nodeId === ENVIRONMENT_NODE_ID) return project.scene.lights.iblLabel ?? null;
  if (nodeId === CAMERA_NODE_ID) return project.scene.cameraName ?? null;
  if (nodeId.startsWith('@ref:')) {
    return (project.scene.referenceObjects ?? []).find(r => r.id === referenceObjectId(nodeId))?.name ?? null;
  }
  if (nodeId.startsWith('@light:')) {
    return normalizeLights(project.scene.lights).find(l => l.id === lightObjectId(nodeId))?.name ?? null;
  }
  return null;
}

/** Writes a row's display name; a blank name clears the override where the row allows one. */
export function writeSceneName(project: Project, nodeId: string, name: string): void {
  const trimmed = name.trim();
  const optional = trimmed || undefined;
  const pattern = project.pattern;
  const element = parseElementNodeId(nodeId);
  if (element) {
    switch (element.kind) {
      case 'panel': {
        const panel = pattern.panels[element.id];
        if (panel && trimmed) panel.name = trimmed;
        return;
      }
      case 'point': {
        const point = pattern.points[element.id];
        if (point) point.name = optional;
        return;
      }
      case 'edge': {
        const edge = pattern.edges[element.id];
        if (edge) edge.name = optional;
        return;
      }
      case 'internal': {
        const line = pattern.internalLines[element.id];
        if (line) line.name = optional;
        return;
      }
      case 'dart': {
        const dart = pattern.darts[element.id];
        if (dart) dart.name = optional;
        return;
      }
      case 'seam': {
        const seam = pattern.seams[element.id];
        if (seam) seam.name = optional;
        return;
      }
      case 'notch': {
        const notch = pattern.notches?.[element.id];
        if (notch) notch.name = optional;
        return;
      }
      case 'annotation': {
        const note = pattern.annotations?.[element.id];
        if (note) note.name = optional;
        return;
      }
      case 'measurement': {
        const measurement = pattern.measurements?.[element.id];
        if (measurement) measurement.name = optional;
        return;
      }
      case 'print': {
        const print = pattern.prints?.[element.id];
        if (print) print.name = optional;
        return;
      }
      case 'topstitch': {
        const stitch = pattern.topstitches?.[element.id];
        if (stitch) stitch.name = optional;
        return;
      }
      case 'trim': {
        const trim = pattern.trims?.[element.id];
        if (trim) trim.name = optional;
        return;
      }
    }
  }
  const panel = pattern.panels[nodeId];
  if (panel) { panel.name = trimmed || panel.name; return; }
  if (nodeId === AVATAR_NODE_ID) { project.avatar.name = optional; return; }
  if (nodeId === ENVIRONMENT_NODE_ID) { project.scene.lights.iblLabel = optional; return; }
  if (nodeId === CAMERA_NODE_ID) { project.scene.cameraName = optional; return; }
  if (nodeId.startsWith('@ref:')) {
    const ref = (project.scene.referenceObjects ?? []).find(r => r.id === referenceObjectId(nodeId));
    if (ref && trimmed) ref.name = trimmed;
    return;
  }
  if (nodeId.startsWith('@light:')) {
    const light = normalizeLights(project.scene.lights).find(l => l.id === lightObjectId(nodeId));
    if (light) {
      project.scene = {
        ...project.scene,
        lights: { ...project.scene.lights, lights: project.scene.lights.lights.map(l => l.id === light.id ? { ...l, name: trimmed || l.name } : l) },
      };
    }
  }
}
