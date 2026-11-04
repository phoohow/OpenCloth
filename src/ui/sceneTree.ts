import type { ObjectTransform, Panel, Pattern, Project, SceneLight, Seam } from '../core/model/types';
import { PATTERN_ELEMENT_KINDS } from '../core/model/elementRef';
import { elementNodeId, parseElementNodeId } from './elementSelection';
import {
  BUNDLED_AVATARS, EDGE_SEMANTIC_LABELS, IDENTITY_TRANSFORM, LIGHT_TYPE_LABELS, SEAM_TYPE_LABELS,
  TRIM_KIND_LABELS, normalizeLights,
} from '../core/model/defaults';
import type { IconName } from './icons';

/** Row categories shown in the outliner; element kinds come from 2D drafting picks. */
export type SceneNodeKind =
  | 'scene' | 'collection' | 'panel' | 'avatar' | 'reference'
  | 'light' | 'environment' | 'camera' | 'seam'
  | 'point' | 'edge' | 'internal' | 'dart' | 'notch' | 'annotation' | 'measurement'
  | 'print' | 'topstitch' | 'trim';

/** Kinds addressed with the `@kind:id` element encoding. */
export const ELEMENT_NODE_KINDS: SceneNodeKind[] = PATTERN_ELEMENT_KINDS.filter(k => k !== 'panel');

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

/** Chinese name of each row kind, shared by the outliner and the properties panel. */
export const SCENE_KIND_LABELS: Record<SceneNodeKind, string> = {
  scene: '场景', collection: '集合', panel: '版片', avatar: '模特', reference: '参考物体',
  light: '光源', environment: '环境光', camera: '相机', seam: '缝纫线',
  point: '点', edge: '边', internal: '内部线', dart: '省道',
  notch: '刀口', annotation: '注释', measurement: '尺寸线',
  print: '印花', topstitch: '明线', trim: '辅料',
};

/** Outliner icon of one light type. */
export const LIGHT_TYPE_ICONS: Record<SceneLight['type'], IconName> = {
  directional: 'light-directional', point: 'light-point', spot: 'light-spot', area: 'light-area',
};

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

/** One outliner row and its children. */
export interface SceneNode {
  id: string;
  kind: SceneNodeKind;
  label: string;
  icon: IconName;
  /** Kind detail shown after the label, e.g. a light's type. */
  note?: string;
  /** False when the row has no viewport visibility state to toggle. */
  hideable: boolean;
  visible: boolean;
  children: SceneNode[];
}

/** Display names of the outline edge roles. */
export { EDGE_SEMANTIC_LABELS };

/** Short Chinese description of one outline edge. */
export function edgeLabel(pattern: Pattern, edgeId: string): string {
  const edge = pattern.edges[edgeId];
  if (!edge) return '边';
  const kind = edge.type === 'arc' ? '圆弧边' : edge.type === 'bezier' ? '曲线边' : '直线边';
  return edge.semantic ? EDGE_SEMANTIC_LABELS[edge.semantic] : kind;
}

/** Outliner name of one element row; the properties panel heading reads the same name. */
export function elementLabel(project: Project, kind: SceneNodeKind, id: string): string {
  const pattern = project.pattern;
  switch (kind) {
    case 'panel': return pattern.panels[id]?.name ?? SCENE_KIND_LABELS.panel;
    case 'point': return pattern.points[id]?.name ?? SCENE_KIND_LABELS.point;
    case 'edge': return pattern.edges[id]?.name ?? edgeLabel(pattern, id);
    case 'internal': return pattern.internalLines[id]?.name ?? SCENE_KIND_LABELS.internal;
    case 'dart': return pattern.darts[id]?.name ?? SCENE_KIND_LABELS.dart;
    case 'seam': {
      const seam = pattern.seams[id];
      return seam ? seam.name ?? seamLabel(project, seam) : SCENE_KIND_LABELS.seam;
    }
    case 'notch': return pattern.notches?.[id]?.name ?? SCENE_KIND_LABELS.notch;
    case 'annotation': {
      const note = pattern.annotations?.[id];
      return note ? note.name ?? (note.text || SCENE_KIND_LABELS.annotation) : SCENE_KIND_LABELS.annotation;
    }
    case 'measurement': return pattern.measurements?.[id]?.name ?? SCENE_KIND_LABELS.measurement;
    case 'print': return pattern.prints?.[id]?.name ?? SCENE_KIND_LABELS.print;
    case 'topstitch': return pattern.topstitches?.[id]?.name ?? SCENE_KIND_LABELS.topstitch;
    case 'trim': {
      const trim = pattern.trims?.[id];
      return trim?.name ?? TRIM_KIND_LABELS[trim?.kind ?? 'button'];
    }
    default: return SCENE_KIND_LABELS[kind];
  }
}

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

/** Drafting elements owned by a panel, as outliner rows. */
export function patternElementChildren(project: Project, panelId: string): SceneNode[] {
  const panel = project.pattern.panels[panelId];
  if (!panel) return [];
  const pattern = project.pattern;
  const rows: SceneNode[] = [];
  const outlineEdges = new Set(panel.outlineEdgeIds);
  for (const edgeId of panel.outlineEdgeIds) {
    if (!pattern.edges[edgeId]) continue;
    rows.push({
      id: elementNodeId('edge', edgeId), kind: 'edge', label: elementLabel(project, 'edge', edgeId),
      icon: 'line', hideable: false, visible: true, children: [],
    });
  }
  panel.holes?.forEach((loop, i) => {
    rows.push({
      id: `@hole:${panelId}:${i}`, kind: 'collection', label: `镂空 ${i + 1}`,
      icon: 'folder', hideable: false, visible: true,
      children: loop.filter(id => pattern.edges[id]).map(edgeId => ({
        id: elementNodeId('edge', edgeId), kind: 'edge', label: elementLabel(project, 'edge', edgeId),
        icon: 'line', hideable: false, visible: true, children: [],
      })),
    });
  });
  for (const pointId of panelPointIds(pattern, panel)) {
    rows.push({
      id: elementNodeId('point', pointId), kind: 'point', label: elementLabel(project, 'point', pointId),
      icon: 'add-point', hideable: false, visible: true, children: [],
    });
  }
  for (const lineId of panel.internalLineIds) {
    if (!pattern.internalLines[lineId]) continue;
    rows.push({
      id: elementNodeId('internal', lineId), kind: 'internal', label: elementLabel(project, 'internal', lineId),
      icon: 'internal-line', hideable: false, visible: true, children: [],
    });
  }
  for (const dartId of panel.dartIds) {
    if (!pattern.darts[dartId]) continue;
    rows.push({
      id: elementNodeId('dart', dartId), kind: 'dart', label: elementLabel(project, 'dart', dartId),
      icon: 'dart', hideable: false, visible: true, children: [],
    });
  }
  for (const notch of Object.values(pattern.notches ?? {})) {
    if (!outlineEdges.has(notch.edgeId)) continue;
    rows.push({
      id: elementNodeId('notch', notch.id), kind: 'notch', label: elementLabel(project, 'notch', notch.id),
      icon: 'add-point', hideable: false, visible: true, children: [],
    });
  }
  for (const note of Object.values(pattern.annotations ?? {})) {
    if (note.panelId !== panelId) continue;
    rows.push({
      id: elementNodeId('annotation', note.id), kind: 'annotation', label: elementLabel(project, 'annotation', note.id),
      icon: 'panel', hideable: false, visible: true, children: [],
    });
  }
  for (const measurement of Object.values(pattern.measurements ?? {})) {
    if (measurement.panelId !== panelId) continue;
    rows.push({
      id: elementNodeId('measurement', measurement.id), kind: 'measurement', label: elementLabel(project, 'measurement', measurement.id),
      icon: 'internal-line', hideable: false, visible: true, children: [],
    });
  }
  return rows;
}

/** One top-level collection of production objects; each row notes the panel it sits on. */
function productionCollection(
  project: Project, kind: 'print' | 'topstitch' | 'trim', collectionId: string, icon: IconName,
  items: Array<{ id: string; label: string; panelId: string; visible: boolean }>,
): SceneNode {
  return {
    id: collectionId, kind: 'collection', label: SCENE_KIND_LABELS[kind], icon: 'folder',
    hideable: true, visible: items.length > 0 && items.every(item => item.visible),
    children: items.map(item => ({
      id: elementNodeId(kind, item.id), kind, label: item.label,
      note: project.pattern.panels[item.panelId]?.name, icon, hideable: true, visible: item.visible, children: [],
    })),
  };
}

/** Outline vertices of a panel, in outline order without duplicates. */
function panelPointIds(pattern: Pattern, panel: Panel): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const edgeId of panel.outlineEdgeIds) {
    const edge = pattern.edges[edgeId];
    if (!edge) continue;
    for (const id of [edge.startPointId, edge.endPointId]) {
      if (seen.has(id) || !pattern.points[id]) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Builds the outliner hierarchy from the project's scene contents. */
export function buildSceneTree(project: Project): SceneNode {
  const panels = Object.values(project.pattern.panels);
  const refs = project.scene.referenceObjects ?? [];
  const lights = normalizeLights(project.scene.lights);
  const seams = Object.values(project.pattern.seams) as Seam[];

  const garment: SceneNode = {
    id: GARMENT_COLLECTION_ID,
    kind: 'collection',
    label: '服装',
    icon: 'folder',
    hideable: true,
    visible: panels.length > 0 && panels.every(p => p.visible),
    children: panels.map(p => ({
      id: p.id,
      kind: 'panel' as const,
      label: p.name,
      icon: 'panel',
      hideable: true,
      visible: p.visible,
      children: patternElementChildren(project, p.id),
    })),
  };

  const stitchLines: SceneNode = {
    id: SEAM_COLLECTION_ID,
    kind: 'collection',
    label: '缝纫线',
    icon: 'folder',
    hideable: true,
    visible: seams.length > 0 && seams.every(s => s.stitchVisible),
    children: seams.map(s => ({
      id: seamNodeId(s.id),
      kind: 'seam' as const,
      label: elementLabel(project, 'seam', s.id),
      note: SEAM_TYPE_LABELS[s.type],
      icon: 'seam',
      hideable: true,
      visible: s.stitchVisible,
      children: [],
    })),
  };

  const prints = productionCollection(project, 'print', PRINT_COLLECTION_ID, 'print',
    Object.values(project.pattern.prints ?? {}).map((print, i) => ({
      id: print.id, label: print.name ?? `${SCENE_KIND_LABELS.print} ${i + 1}`,
      panelId: print.panelId, visible: print.visible !== false,
    })));

  const topstitches = productionCollection(project, 'topstitch', TOPSTITCH_COLLECTION_ID, 'topstitch',
    Object.values(project.pattern.topstitches ?? {}).map((stitch, i) => ({
      id: stitch.id, label: stitch.name ?? `${SCENE_KIND_LABELS.topstitch} ${i + 1}`,
      panelId: stitch.panelId, visible: stitch.visible !== false,
    })));

  const trims = productionCollection(project, 'trim', TRIM_COLLECTION_ID, 'trim',
    Object.values(project.pattern.trims ?? {}).map((trim, i) => ({
      id: trim.id, label: trim.name ?? `${TRIM_KIND_LABELS[trim.kind]} ${i + 1}`,
      panelId: trim.panelId, visible: trim.visible !== false,
    })));

  const avatar: SceneNode = {
    id: AVATAR_NODE_ID,
    kind: 'avatar',
    label: avatarLabel(project),
    icon: 'avatar',
    hideable: true,
    visible: project.avatar.display !== 'hidden',
    children: [],
  };

  const reference: SceneNode = {
    id: REFERENCE_COLLECTION_ID,
    kind: 'collection',
    label: '参考物',
    icon: 'folder',
    hideable: true,
    visible: refs.length > 0 && refs.every(r => r.visible),
    children: refs.map(r => ({
      id: referenceNodeId(r.id),
      kind: 'reference' as const,
      label: r.name,
      icon: 'reference',
      hideable: true,
      visible: r.visible,
      children: [],
    })),
  };

  const light: SceneNode = {
    id: LIGHT_COLLECTION_ID,
    kind: 'collection',
    label: '光源',
    icon: 'folder',
    hideable: false,
    visible: true,
    children: [
      ...lights.map(l => ({
        id: lightNodeId(l.id),
        kind: 'light' as const,
        label: l.name,
        note: LIGHT_TYPE_LABELS[l.type],
        icon: LIGHT_TYPE_ICONS[l.type],
        hideable: true,
        visible: l.enabled,
        children: [],
      })),
      {
        id: ENVIRONMENT_NODE_ID, kind: 'environment',
        label: project.scene.lights.iblLabel ?? '环境光', note: '环境光',
        icon: 'environment', hideable: true, visible: project.scene.lights.iblEnabled, children: [],
      },
    ],
  };

  const camera: SceneNode = {
    id: CAMERA_NODE_ID, kind: 'camera', label: project.scene.cameraName ?? '相机', icon: 'camera',
    hideable: false, visible: true, children: [],
  };

  return {
    id: SCENE_ROOT_ID,
    kind: 'scene',
    label: project.meta.name,
    icon: 'scene',
    hideable: false,
    visible: true,
    children: [garment, stitchLines, prints, topstitches, trims, avatar, reference, light, camera],
  };
}

/** Name of the panel owning an edge, or the edge id when no panel claims it. */
function panelNameForEdge(project: Project, edgeId: string): string {
  const panel = Object.values(project.pattern.panels).find(p => p.outlineEdgeIds.includes(edgeId));
  return panel?.name ?? project.pattern.edges[edgeId]?.id ?? '?';
}

/** Names of the two panels a seam joins. */
export function seamPanelNames(project: Project, seam: Seam): [string, string] {
  return [panelNameForEdge(project, seam.a.edgeId), panelNameForEdge(project, seam.b.edgeId)];
}

/** Seam row label: the two panels the stitch joins. */
export function seamLabel(project: Project, seam: Seam): string {
  const [a, b] = seamPanelNames(project, seam);
  return `${a} ⇄ ${b}`;
}

/** Display name of the current avatar source. */
export function avatarLabel(project: Project): string {
  const { avatar } = project;
  if (avatar.name) return avatar.name;
  if (avatar.source === 'procedural') return '程序模特';
  return avatar.modelName ?? BUNDLED_AVATARS.find(b => b.url === avatar.glbUrl)?.label ?? '外部模型';
}

/** Rows with a placement: a scene transform, or the position and target of a light. */
export function supportsTransform(kind: SceneNodeKind): boolean {
  return kind === 'panel' || kind === 'avatar' || kind === 'reference' || kind === 'light';
}

/** Rows that expose material properties. */
export function supportsMaterial(kind: SceneNodeKind): boolean {
  return kind === 'panel' || kind === 'avatar';
}

/** Rows that expose simulation settings. */
export function supportsSimulator(kind: SceneNodeKind): boolean {
  return kind === 'panel' || kind === 'avatar';
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

/** Whether every child of a collection row is visible. */
export function isCollectionVisible(node: SceneNode): boolean {
  return node.children.length > 0 && node.children.every(c => c.visible);
}

/** Depth-first lookup of an outliner row by id. */
export function findSceneNode(node: SceneNode, id: string): SceneNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const hit = findSceneNode(child, id);
    if (hit) return hit;
  }
  return null;
}

/** Bounding box of a panel's outline in pattern centimeters. */
export function panelSizeCm(pattern: Pattern, panelId: string): { width: number; height: number } | null {
  const panel = pattern.panels[panelId];
  if (!panel) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const edgeId of panel.outlineEdgeIds) {
    const edge = pattern.edges[edgeId];
    for (const pos of [pattern.points[edge?.startPointId ?? '']?.pos, pattern.points[edge?.endPointId ?? '']?.pos]) {
      if (!pos) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x);
      maxY = Math.max(maxY, pos.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { width: maxX - minX, height: maxY - minY };
}
