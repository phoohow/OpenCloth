import { genId } from '@/base/id';
import type { Pattern } from '@/model/types';
import { DEFAULT_MESH_RESOLUTION_CM } from '@/model';
import { patternFromJson } from '@/pattern/patternJson';
import type { GarmentTemplate } from '@/pattern/template/garmentTemplate';

/**
 * A `.ocpat` file carries display metadata and one complete `Pattern`: points, edges, panels,
 * seams, drape and production marks, all in pattern-plane centimetres. Files are static geometry.
 */
export const PATTERN_FILE_EXTENSION = '.ocpat';

/** One garment template stored as a standalone file. */
export interface PatternFile {
  /** Stable catalogue key, unique across the default folder and imported templates. */
  key: string;
  name: string;
  summary?: string;
  /** Display position in the template tab; files without it sort after the rest by name. */
  order?: number;
  /** Measurements the geometry was drafted from; informational, not applied again. */
  params?: Record<string, number>;
  pattern: Pattern;
}

/** A parsed template file plus non-blocking hints about how well it fits the body. */
interface ParsedPatternFile {
  file: PatternFile;
  warnings: string[];
}

/** Metadata supplied when writing the open pattern out as a template file. */
export interface PatternFileMeta {
  name: string;
  summary?: string;
  key?: string;
  order?: number;
  params?: Record<string, number>;
}

const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads a `.ocpat` document, validates its pattern and returns usable geometry. */
export function parsePatternFile(text: string): ParsedPatternFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`版型文件解析失败：${(error as Error).message}`);
  }
  if (!isRecord(raw)) throw new Error('版型文件必须是 JSON 对象');
  if (typeof raw.key !== 'string' || !KEY_RE.test(raw.key)) {
    throw new Error('版型文件缺少合法的 key（字母、数字、下划线或连字符）');
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new Error('版型文件缺少 name');
  }
  if (!isRecord(raw.pattern)) throw new Error('版型文件缺少 pattern 对象');

  const pattern = patternFromJson(JSON.stringify(raw.pattern), '版型文件');
  alignRecordIds(pattern);
  fillPanelDefaults(pattern);

  const summary = typeof raw.summary === 'string' && raw.summary.trim()
    ? raw.summary.trim()
    : deriveSummary(pattern);

  const params = isRecord(raw.params)
    ? Object.fromEntries(
      Object.entries(raw.params)
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
    )
    : undefined;
  const order = typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : undefined;
  const file: PatternFile = {
    key: raw.key,
    name: raw.name.trim(),
    summary,
    ...(order !== undefined ? { order } : {}),
    ...(params && Object.keys(params).length > 0 ? { params } : {}),
    pattern,
  };
  return { file, warnings: patternFileWarnings(pattern) };
}

/** Writes the given pattern and metadata as a `.ocpat` document. */
export function encodePatternFile(pattern: Pattern, meta: PatternFileMeta): string {
  const draft = structuredClone(pattern);
  for (const panel of Object.values(draft.panels)) {
    delete panel.sheetLiftCm;
    delete panel.placement;
  }
  const file: PatternFile = {
    key: meta.key ?? genId('tpl'),
    name: meta.name.trim() || '未命名版型',
    summary: meta.summary?.trim() || deriveSummary(draft),
    ...(meta.order !== undefined ? { order: meta.order } : {}),
    ...(meta.params ? { params: { ...meta.params } } : {}),
    pattern: draft,
  };
  const text = JSON.stringify(file, null, 2);
  // Validate the encoded text so a broken outline fails here instead of at apply time.
  parsePatternFile(text);
  return text;
}

/** Hints about a template that still loads but may not dress the body on its own. */
function patternFileWarnings(pattern: Pattern): string[] {
  const panels = Object.values(pattern.panels);
  const warnings: string[] = [];
  if (panels.length === 0) warnings.push('文件里没有版片');
  if (panels.some(panel => !panel.drape)) warnings.push('部分版片缺少 drape（包裹信息），3D 试衣时可能保持平铺');
  if (Object.keys(pattern.seams).length === 0) warnings.push('文件里没有缝合（seams），应用后不会自动缝合');
  return warnings;
}

/** Turns a parsed template file into a catalogue entry the existing commands can apply. */
export function patternFileToTemplate(
  file: PatternFile,
  source: 'file' | 'user',
  assetId?: string,
): GarmentTemplate {
  return {
    key: file.key,
    name: file.name,
    revision: contentRevision(file.pattern),
    summary: file.summary ?? deriveSummary(file.pattern),
    ...(file.params ? { params: { ...file.params } } : {}),
    source,
    ...(assetId ? { assetId } : {}),
    generate: fabricId => instantiatePattern(file.pattern, fabricId),
  };
}

/** Cheap fingerprint of a pattern's content, used to cache the rendered thumbnail. */
function contentRevision(pattern: Pattern): string {
  const text = JSON.stringify(pattern);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Panel names shown under a template that did not declare a summary. */
function deriveSummary(pattern: Pattern): string {
  const names = Object.values(pattern.panels).map(panel => panel.name).filter(Boolean);
  if (names.length === 0) return '自定义版型';
  const shown = names.slice(0, 4).join(' · ');
  return names.length > 4 ? `${shown} 等 ${names.length} 片` : shown;
}

/** Makes every collection use its dictionary key as the record id, so references stay resolvable. */
function alignRecordIds(pattern: Pattern): void {
  for (const records of collectionsOf(pattern)) {
    for (const [key, record] of Object.entries(records)) record.id = key;
  }
}

/** Fills the per-panel scalars a hand-written file may omit and drops transient sheet state. */
function fillPanelDefaults(pattern: Pattern): void {
  for (const panel of Object.values(pattern.panels)) {
    panel.name ||= '版片';
    panel.outlineEdgeIds ??= [];
    panel.dartIds ??= [];
    panel.internalLineIds ??= [];
    panel.holes ??= [];
    panel.seamAllowanceCm ??= 1;
    panel.meshResolutionCm ??= DEFAULT_MESH_RESOLUTION_CM;
    panel.fabricId ??= 'fabric_default';
    panel.visible ??= true;
    panel.locked ??= false;
    delete panel.sheetLiftCm;
    delete panel.placement;
  }
}

/** Every id-keyed collection of a pattern, in a stable order. */
function collectionsOf(pattern: Pattern): Record<string, { id: string }>[] {
  return [
    pattern.points, pattern.edges, pattern.darts, pattern.internalLines, pattern.panels,
    pattern.seams, pattern.notches, pattern.annotations, pattern.measurements,
    pattern.prints, pattern.topstitches, pattern.trims,
  ];
}

/** Id prefix of each collection, matching the prefixes the pattern builder uses. */
const ID_PREFIXES = [
  'pt', 'edge', 'dart', 'line', 'panel', 'seam',
  'notch', 'annotation', 'measurement', 'print', 'topstitch', 'trim',
] as const;

/** Id maps for every entity collection plus the panel group tags. */
interface IdMaps {
  collections: Map<string, string>[];
  groups: Map<string, string>;
}

/**
 * Creates fresh ids for one generated copy. A template file is static, so applying it twice with
 * the same ids would collide inside `appendPattern`; every instance needs its own id space.
 */
function buildIdMaps(pattern: Pattern): IdMaps {
  const collections = collectionsOf(pattern).map((records, index) =>
    new Map(Object.keys(records).map(key => [key, genId(ID_PREFIXES[index]!)])),
  );
  const groupIds = new Set(
    Object.values(pattern.panels).map(panel => panel.groupId).filter((id): id is string => !!id),
  );
  const groups = new Map([...groupIds].map(id => [id, genId('group')]));
  return { collections, groups };
}

/** Copies one collection under its new ids. */
function remapRecords<T extends { id: string }>(
  records: Record<string, T>, ids: Map<string, string>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, record] of Object.entries(records)) {
    const id = ids.get(key) ?? key;
    out[id] = { ...record, id };
  }
  return out;
}

/** Builds a fresh pattern instance, rewriting every reference and the fabric it is cut from. */
export function instantiatePattern(pattern: Pattern, fabricId: string): Pattern {
  const copy = structuredClone(pattern);
  const maps = buildIdMaps(copy);
  const [
    pointIds, edgeIds, dartIds, lineIds, panelIds, seamIds,
    notchIds, annotationIds, measurementIds, printIds, topstitchIds, trimIds,
  ] = maps.collections;
  const out: Pattern = {
    points: remapRecords(copy.points, pointIds!),
    edges: remapRecords(copy.edges, edgeIds!),
    darts: remapRecords(copy.darts, dartIds!),
    internalLines: remapRecords(copy.internalLines, lineIds!),
    panels: remapRecords(copy.panels, panelIds!),
    seams: remapRecords(copy.seams, seamIds!),
    notches: remapRecords(copy.notches, notchIds!),
    annotations: remapRecords(copy.annotations, annotationIds!),
    measurements: remapRecords(copy.measurements, measurementIds!),
    prints: remapRecords(copy.prints, printIds!),
    topstitches: remapRecords(copy.topstitches, topstitchIds!),
    trims: remapRecords(copy.trims, trimIds!),
  };

  const at = (ids: Map<string, string>, id: string): string => ids.get(id) ?? id;
  const point = (id: string): string => at(pointIds!, id);
  const edge = (id: string): string => at(edgeIds!, id);
  const dart = (id: string): string => at(dartIds!, id);
  const line = (id: string): string => at(lineIds!, id);
  const panel = (id: string): string => at(panelIds!, id);

  for (const item of Object.values(out.edges)) {
    item.startPointId = point(item.startPointId);
    item.endPointId = point(item.endPointId);
  }
  for (const item of Object.values(out.darts)) {
    item.tipId = point(item.tipId);
    item.edge1Id = edge(item.edge1Id);
    item.edge2Id = edge(item.edge2Id);
  }
  for (const item of Object.values(out.panels)) {
    item.outlineEdgeIds = item.outlineEdgeIds.map(edge);
    item.dartIds = item.dartIds.map(dart);
    item.internalLineIds = item.internalLineIds.map(line);
    item.holes = (item.holes ?? []).map(loop => loop.map(edge));
    if (item.symmetry) {
      item.symmetry = {
        axisEdgeId: edge(item.symmetry.axisEdgeId),
        linkedPanelId: panel(item.symmetry.linkedPanelId),
      };
    }
    if (item.groupId) item.groupId = at(maps.groups, item.groupId);
    item.fabricId = fabricId;
    delete item.sheetLiftCm;
    delete item.placement;
  }
  for (const item of Object.values(out.seams)) {
    item.a = { ...item.a, edgeId: edge(item.a.edgeId) };
    item.b = { ...item.b, edgeId: edge(item.b.edgeId) };
  }
  for (const item of Object.values(out.notches)) item.edgeId = edge(item.edgeId);
  for (const item of Object.values(out.annotations)) item.panelId = panel(item.panelId);
  for (const item of Object.values(out.measurements)) {
    item.panelId = panel(item.panelId);
    if (item.refs.pointAId) item.refs.pointAId = point(item.refs.pointAId);
    if (item.refs.pointBId) item.refs.pointBId = point(item.refs.pointBId);
    if (item.refs.edgeId) item.refs.edgeId = edge(item.refs.edgeId);
  }
  for (const item of Object.values(out.prints)) item.panelId = panel(item.panelId);
  for (const item of Object.values(out.topstitches)) {
    item.panelId = panel(item.panelId);
    item.edgeId = edge(item.edgeId);
  }
  for (const item of Object.values(out.trims)) item.panelId = panel(item.panelId);

  return out;
}
