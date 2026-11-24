import type { Panel, Pattern, Project, SceneLight, Seam } from '@/model/types';
import type { IconName } from '@/ui/icons';

import {
  AVATAR_NODE_ID, CAMERA_NODE_ID, EDGE_SEMANTIC_LABELS, ENVIRONMENT_NODE_ID, FLOOR_NODE_ID,
  GARMENT_COLLECTION_ID, LIGHT_COLLECTION_ID, LIGHT_TYPE_LABELS, PRINT_COLLECTION_ID,
  REFERENCE_COLLECTION_ID, SCENE_ROOT_ID, SEAM_COLLECTION_ID, SEAM_TYPE_LABELS,
  TOPSTITCH_COLLECTION_ID, TRIM_COLLECTION_ID, TRIM_KIND_LABELS, elementNodeId, floorVisible,
  lightNodeId, matchAvatarPreset, normalizeLights, referenceNodeId, seamNodeId,
} from '@/model';
import { seamNumbers } from '@/pattern/seam';

export { EDGE_SEMANTIC_LABELS } from '@/model';

export const SCENE_KIND_LABELS: Record<SceneNodeKind, string> = {
  scene: '场景', collection: '组', panel: '版片', avatar: '模特', reference: '参考物',
  light: '光源', environment: '环境光', camera: '相机', floor: '地板', seam: '缝合线',
  point: '顶点', edge: '轮廓边', internal: '内部线', dart: '省道',
  notch: '刀口', annotation: '注释', measurement: '尺寸线',
  print: '印花', topstitch: '明线', trim: '辅料',
};

export const LIGHT_TYPE_ICONS: Record<SceneLight['type'], IconName> = {
  directional: 'light-directional', point: 'light-point', spot: 'light-spot', area: 'light-area',
};

const indexCache = new WeakMap<Project, SceneIndex>();

export type SceneNodeKind =
  | 'scene' | 'collection' | 'panel' | 'avatar' | 'reference'
  | 'light' | 'environment' | 'camera' | 'floor' | 'seam'
  | 'point' | 'edge' | 'internal' | 'dart' | 'notch' | 'annotation' | 'measurement'
  | 'print' | 'topstitch' | 'trim';

export interface SceneNode {
  id: string;
  kind: SceneNodeKind;
  label: string;
  icon: IconName;
  note?: string;
  hideable: boolean;
  visible: boolean;
  children: SceneNode[];
}

interface ElementBuckets {
  notchesByEdge: Map<string, SceneNode[]>;
  annotationsByPanel: Map<string, SceneNode[]>;
  measurementsByPanel: Map<string, SceneNode[]>;
}

export interface SceneIndex {
  root: SceneNode;
  byId: ReadonlyMap<string, SceneNode>;
}

export function edgeLabel(pattern: Pattern, edgeId: string): string {
  const edge = pattern.edges[edgeId];
  if (!edge) return '轮廓边';
  const kind = edge.type === 'arc' ? '圆弧边' : edge.type === 'bezier' ? '曲线边' : '直线边';
  return edge.semantic ? EDGE_SEMANTIC_LABELS[edge.semantic] : kind;
}

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

export function patternElementChildren(
  project: Project, panelId: string, buckets = elementBuckets(project),
): SceneNode[] {
  const panel = project.pattern.panels[panelId];
  if (!panel) return [];
  const pattern = project.pattern;
  const rows: SceneNode[] = [];
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

  for (const edgeId of panel.outlineEdgeIds) {
    rows.push(...buckets.notchesByEdge.get(edgeId) ?? []);
  }

  rows.push(...buckets.annotationsByPanel.get(panelId) ?? []);
  rows.push(...buckets.measurementsByPanel.get(panelId) ?? []);
  return rows;
}

function elementBuckets(project: Project): ElementBuckets {
  const pattern = project.pattern;
  const notchesByEdge = new Map<string, SceneNode[]>();
  for (const notch of Object.values(pattern.notches ?? {})) {
    const row: SceneNode = {
      id: elementNodeId('notch', notch.id), kind: 'notch', label: elementLabel(project, 'notch', notch.id),
      icon: 'add-point', hideable: false, visible: true, children: [],
    };
    const list = notchesByEdge.get(notch.edgeId);
    if (list) list.push(row);
    else notchesByEdge.set(notch.edgeId, [row]);
  }

  const byPanel = (
    records: Array<{ id: string; panelId: string }>, kind: 'annotation' | 'measurement', icon: IconName,
  ): Map<string, SceneNode[]> => {
    const map = new Map<string, SceneNode[]>();
    for (const record of records) {
      const row: SceneNode = {
        id: elementNodeId(kind, record.id), kind, label: elementLabel(project, kind, record.id),
        icon, hideable: false, visible: true, children: [],
      };
      const list = map.get(record.panelId);
      if (list) list.push(row);
      else map.set(record.panelId, [row]);
    }

    return map;
  };
  return {
    notchesByEdge,
    annotationsByPanel: byPanel(Object.values(pattern.annotations ?? {}), 'annotation', 'panel'),
    measurementsByPanel: byPanel(Object.values(pattern.measurements ?? {}), 'measurement', 'internal-line'),
  };
}

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

export function buildSceneTree(project: Project): SceneNode {
  return buildSceneIndex(project).root;
}

export function buildSceneIndex(project: Project): SceneIndex {
  const cached = indexCache.get(project);
  if (cached) return cached;
  const root = buildTree(project);
  const byId = new Map<string, SceneNode>();
  collectRows(root, byId);
  const index = { root, byId };
  indexCache.set(project, index);
  return index;
}

function collectRows(node: SceneNode, out: Map<string, SceneNode>): void {
  out.set(node.id, node);
  for (const child of node.children) collectRows(child, out);
}

function buildTree(project: Project): SceneNode {
  const panels = Object.values(project.pattern.panels);
  const refs = project.scene.referenceObjects ?? [];
  const lights = normalizeLights(project.scene.lights);
  const seams = Object.values(project.pattern.seams) as Seam[];
  const buckets = elementBuckets(project);

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
      children: patternElementChildren(project, p.id, buckets),
    })),
  };

  const stitchLines: SceneNode = {
    id: SEAM_COLLECTION_ID,
    kind: 'collection',
    label: '缝合线',
    icon: 'folder',
    hideable: true,
    visible: seams.length > 0 && seams.every(s => s.stitchVisible),
    children: (() => {
      const numbers = seamNumbers(project.pattern);
      return seams.map(s => {
        const name = elementLabel(project, 'seam', s.id);
        const no = numbers.get(s.id);
        return {
          id: seamNodeId(s.id),
          kind: 'seam' as const,
          label: no === null ? name : `${name} · ${no}`,
          note: SEAM_TYPE_LABELS[s.type],
          icon: 'seam',
          hideable: true,
          visible: s.stitchVisible,
          children: [],
        };
      });
    })(),
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

  const floor: SceneNode = {
    id: FLOOR_NODE_ID, kind: 'floor', label: project.scene.floorName ?? SCENE_KIND_LABELS.floor,
    icon: 'floor', hideable: true, visible: floorVisible(project.scene), children: [],
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
        label: project.scene.lights.iblLabel ?? '环境光',
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
    children: [garment, stitchLines, prints, topstitches, trims, avatar, floor, reference, light, camera],
  };
}

function panelNameForEdge(project: Project, edgeId: string): string {
  const panel = Object.values(project.pattern.panels).find(p => p.outlineEdgeIds.includes(edgeId));
  return panel?.name ?? project.pattern.edges[edgeId]?.id ?? '?';
}

export function seamPanelNames(project: Project, seam: Seam): [string, string] {
  return [panelNameForEdge(project, seam.a.edgeId), panelNameForEdge(project, seam.b.edgeId)];
}

export function seamLabel(project: Project, seam: Seam): string {
  const [a, b] = seamPanelNames(project, seam);
  return `${a} ⇄ ${b}`;
}

export function avatarLabel(project: Project): string {
  const { avatar } = project;
  if (avatar.name) return avatar.name;
  if (avatar.source === 'glb') return avatar.modelName ?? '导入模型';
  return matchAvatarPreset(avatar.params)?.label ?? '自定义模特';
}

export function supportsTransform(kind: SceneNodeKind): boolean {
  return kind === 'panel' || kind === 'avatar' || kind === 'reference' || kind === 'light' || kind === 'floor';
}

export function supportsMaterial(kind: SceneNodeKind): boolean {
  return kind === 'panel' || kind === 'avatar' || kind === 'seam'
    || kind === 'print' || kind === 'topstitch' || kind === 'trim';
}

export function supportsDelete(kind: SceneNodeKind): boolean {
  return kind === 'seam'
    || kind === 'print' || kind === 'topstitch' || kind === 'trim'
    || kind === 'notch' || kind === 'annotation' || kind === 'measurement'
    || kind === 'reference' || kind === 'light';
}

export function supportsSimulator(kind: SceneNodeKind): boolean {
  return kind === 'panel' || kind === 'avatar' || kind === 'floor';
}
