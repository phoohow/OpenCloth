import type { Panel, Pattern, Project, SceneLight, Seam } from '@/model/types';
import {
  AVATAR_NODE_ID, CAMERA_NODE_ID, EDGE_SEMANTIC_LABELS, ENVIRONMENT_NODE_ID, GARMENT_COLLECTION_ID,
  LIGHT_COLLECTION_ID, LIGHT_TYPE_LABELS, PATTERN_ELEMENT_KINDS, PRINT_COLLECTION_ID,
  REFERENCE_COLLECTION_ID, SCENE_ROOT_ID, SEAM_COLLECTION_ID, SEAM_TYPE_LABELS,
  TOPSTITCH_COLLECTION_ID, TRIM_COLLECTION_ID, TRIM_KIND_LABELS, elementNodeId, lightNodeId,
  matchAvatarPreset, normalizeLights, referenceNodeId, seamNodeId,
} from '@/model';
import { seamNumbers } from '@/pattern/seam';
import type { IconName } from '@/ui/icons';

/** Row categories shown in the outliner; `collection` is a group, only some carry a flag. */
export type SceneNodeKind =
  | 'scene' | 'collection' | 'panel' | 'avatar' | 'reference'
  | 'light' | 'environment' | 'camera' | 'seam'
  | 'point' | 'edge' | 'internal' | 'dart' | 'notch' | 'annotation' | 'measurement'
  | 'print' | 'topstitch' | 'trim';

/** Kinds addressed with the `@kind:id` element encoding. */
export const ELEMENT_NODE_KINDS: SceneNodeKind[] = PATTERN_ELEMENT_KINDS.filter(k => k !== 'panel');

/** Chinese name of each row kind, shared by the outliner and the properties panel. */
export const SCENE_KIND_LABELS: Record<SceneNodeKind, string> = {
  scene: '场景', collection: '组', panel: '版片', avatar: '模特', reference: '参考物',
  light: '光源', environment: '环境光', camera: '相机', seam: '缝合线',
  point: '顶点', edge: '轮廓边', internal: '内部线', dart: '省道',
  notch: '刀口', annotation: '注释', measurement: '尺寸线',
  print: '印花', topstitch: '明线', trim: '辅料',
};

/** Outliner icon of one light type. */
export const LIGHT_TYPE_ICONS: Record<SceneLight['type'], IconName> = {
  directional: 'light-directional', point: 'light-point', spot: 'light-spot', area: 'light-area',
};

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
  if (!edge) return '轮廓边';
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

/** Drafting records grouped by the panel they belong to, built once per revision. */
interface ElementBuckets {
  notchesByEdge: Map<string, SceneNode[]>;
  annotationsByPanel: Map<string, SceneNode[]>;
  measurementsByPanel: Map<string, SceneNode[]>;
}

/** Drafting elements owned by a panel, as outliner rows. */
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

/** Groups the pattern's drafting records by the panel row that lists them. */
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

/** The outliner hierarchy plus a lookup table for every row it holds. */
export interface SceneIndex {
  root: SceneNode;
  byId: ReadonlyMap<string, SceneNode>;
}

const indexCache = new WeakMap<Project, SceneIndex>();

/** Builds the outliner hierarchy from the project's scene contents. */
export function buildSceneTree(project: Project): SceneNode {
  return buildSceneIndex(project).root;
}

/**
 * Hierarchy and row lookup for one revision. A revision object is immutable, so the index is
 * cached while it is reachable: the outliner and the properties panel share one build.
 */
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

/** Every row of the hierarchy, keyed by id. */
function collectRows(node: SceneNode, out: Map<string, SceneNode>): void {
  out.set(node.id, node);
  for (const child of node.children) collectRows(child, out);
}

/** Builds the outliner hierarchy without caching. */
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
      // The numbers are the ones the canvas paints on both sides of each seam.
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
  if (avatar.source === 'glb') return avatar.modelName ?? '导入模型';
  return matchAvatarPreset(avatar.params)?.label ?? '自定义模特';
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
