import type { ObjectTransform, Pattern, Project, SceneLight, Seam } from '../core/model/types';
import {
  BUNDLED_AVATARS, IDENTITY_TRANSFORM, LIGHT_TYPE_LABELS, SEAM_TYPE_LABELS, normalizeLights,
} from '../core/model/defaults';
import type { IconName } from './icons';

/** Row categories shown in the outliner. */
export type SceneNodeKind =
  | 'scene' | 'collection' | 'panel' | 'avatar' | 'reference'
  | 'light' | 'environment' | 'camera' | 'seam';

export const SCENE_ROOT_ID = '@scene';

// Outliner rows with no project object behind them.
export const AVATAR_NODE_ID = '@avatar';
export const CAMERA_NODE_ID = '@camera';
export const ENVIRONMENT_NODE_ID = '@env';
export const GARMENT_COLLECTION_ID = '@collection:garment';
export const REFERENCE_COLLECTION_ID = '@collection:reference';
export const LIGHT_COLLECTION_ID = '@collection:light';
export const SEAM_COLLECTION_ID = '@collection:seam';

/** What each outliner row kind is called in the properties panel. */
export const SCENE_KIND_LABELS: Record<SceneNodeKind, string> = {
  scene: '场景', collection: '集合', panel: '版型片', avatar: '模特', reference: '参考物体',
  light: '光源', environment: '环境光', camera: '相机', seam: '缝纫线',
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
      children: [],
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
      label: seamLabel(project, s),
      note: SEAM_TYPE_LABELS[s.type],
      icon: 'seam',
      hideable: true,
      visible: s.stitchVisible,
      children: [],
    })),
  };

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
    label: '灯光',
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
        id: ENVIRONMENT_NODE_ID, kind: 'environment', label: '环境光', note: 'HDRI',
        icon: 'environment', hideable: true, visible: project.scene.lights.iblEnabled, children: [],
      },
    ],
  };

  const camera: SceneNode = {
    id: CAMERA_NODE_ID, kind: 'camera', label: '相机', icon: 'camera',
    hideable: false, visible: true, children: [],
  };

  return {
    id: SCENE_ROOT_ID,
    kind: 'scene',
    label: project.meta.name,
    icon: 'scene',
    hideable: false,
    visible: true,
    children: [garment, stitchLines, avatar, reference, light, camera],
  };
}

/** Name of the panel owning an edge, or the edge id when no panel claims it. */
function panelNameForEdge(project: Project, edgeId: string): string {
  const panel = Object.values(project.pattern.panels).find(p => p.outlineEdgeIds.includes(edgeId));
  return panel?.name ?? project.pattern.edges[edgeId]?.id ?? '?';
}

/** Names of the two panels a seam joins. */
export function seamPanelNames(project: Project, seam: Seam): [string, string] {
  return [panelNameForEdge(project, seam.edgeAId), panelNameForEdge(project, seam.edgeBId)];
}

/** Seam row label: the two panels the stitch joins. */
export function seamLabel(project: Project, seam: Seam): string {
  const [a, b] = seamPanelNames(project, seam);
  return `${a} ⇄ ${b}`;
}

/** Display name of the current avatar source. */
export function avatarLabel(project: Project): string {
  const { avatar } = project;
  if (avatar.source === 'procedural') return '程序人台';
  return avatar.modelName ?? BUNDLED_AVATARS.find(b => b.url === avatar.glbUrl)?.label ?? '外部模型';
}

/** Rows that carry a scene transform. */
export function supportsTransform(kind: SceneNodeKind): boolean {
  return kind === 'panel' || kind === 'avatar' || kind === 'reference';
}

/** Rows that expose material properties. */
export function supportsMaterial(kind: SceneNodeKind): boolean {
  return kind === 'panel';
}

/** Rows that expose simulation properties. */
export function supportsPhysics(kind: SceneNodeKind): boolean {
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
