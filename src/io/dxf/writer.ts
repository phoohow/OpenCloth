import type { Panel, Pattern, SizeDef, Vec2 } from '@/model/types';

import { computeBBox, ensureCCW } from '@/base/geom';
import { adaptiveSampleArc } from '@/base/geom/arc';
import { add2, dot2, nearlyEqual2, normalize2, perp2, scale2, sub2 } from '@/base/math';
import { layerName, type DxfConvention } from '@/io/dxf/layers';
import { sheetLabel, sheetOutline, sheetPoint, type MarkerSheet } from '@/io/markerSheet';
import { pointAtT, edgeCurve, adaptiveSampleBezier } from '@/pattern/geom';
import { resolveSize } from '@/pattern/grading';
import { panelGrainLine, panelOutlineWithAllowance, topstitchRows } from '@/pattern/panel';

const CM_TO_MM = 10;

const DEFAULT_SIZE_GAP_CM = 10;

export type DxfEncoding = 'utf-8' | 'ascii';

export interface WriteDxfSizes {
  chart: SizeDef[];
  fromSizeId?: string;
  gapCm?: number;
}

export interface WriteDxfOptions {
  includeSeamAllowance: boolean;
  convention?: DxfConvention;
  sizeLabels?: string[];
  sizes?: WriteDxfSizes;
  encoding?: DxfEncoding;
}

interface PanelGeometry {
  panel: Panel;
  outline: Vec2[];
  holes: Vec2[][];
  seamAllowance: Vec2[] | null;
}

interface ExportGroup {
  label: string | undefined;
  pattern: Pattern;
  geometries: PanelGeometry[];
  offsetXmm: number;
}

export interface WriteMarkerDxfOptions {
  convention?: DxfConvention;
  encoding?: DxfEncoding;
}

const f = (n: number): string => (Math.abs(n) < 5e-5 ? '0.0000' : n.toFixed(4));

export function escapeDxfValue(value: string): string {
  let out = '';
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out += ch === '\\' ? '\\U+005C' : ch;
    else if (cp > 0xFFFF) out += '?';
    else out += `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  }

  return out;
}

export function unescapeDxfValue(value: string): string {
  return value.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)));
}

class DxfWriter {
  private out: string[] = [];

  constructor(private readonly encoding: DxfEncoding = 'utf-8') {}

  pair(code: number, value: string | number): void {
    const text = String(value);
    this.out.push(String(code), this.encoding === 'ascii' ? escapeDxfValue(text) : text);
  }

  toString(): string {
    return this.out.join('\n') + '\n';
  }
}

function sampleEdgeCm(pattern: Pattern, edgeId: string): Vec2[] {
  const edge = pattern.edges[edgeId];
  if (!edge) return [];
  const p0 = pattern.points[edge.startPointId]?.pos;
  const p1 = pattern.points[edge.endPointId]?.pos;
  if (!p0 || !p1) return [];
  if (edge.type === 'arc' && edge.arc) return adaptiveSampleArc(edge.arc, 0.002);
  if (edge.type === 'bezier') {
    const curve = edgeCurve(pattern, edge);
    return curve ? adaptiveSampleBezier(curve, 0.002) : [p0, p1];
  }

  return [p0, p1];
}

function loopPolygon(pattern: Pattern, edgeIds: string[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const edgeId of edgeIds) {
    for (const p of sampleEdgeCm(pattern, edgeId)) {
      const last = pts[pts.length - 1];
      if (last && nearlyEqual2(p, last, 1e-9)) continue;
      pts.push(p);
    }
  }

  if (pts.length > 1 && nearlyEqual2(pts[0], pts[pts.length - 1])) pts.pop();
  return pts;
}

function panelGeometries(pattern: Pattern, includeSeamAllowance: boolean): PanelGeometry[] {
  return Object.values(pattern.panels).map(panel => {
    const outline = ensureCCW(loopPolygon(pattern, panel.outlineEdgeIds));
    const holes = (panel.holes ?? []).map(loop => ensureCCW(loopPolygon(pattern, loop)));
    let seamAllowance: Vec2[] | null = null;
    if (includeSeamAllowance) {
      const hasAllowance = panel.seamAllowanceCm > 0
        || panel.outlineEdgeIds.some(edgeId => (pattern.edges[edgeId]?.seamAllowanceCm ?? 0) > 0);
      if (hasAllowance) {
        const offset = ensureCCW(panelOutlineWithAllowance(pattern, panel));
        if (offset.length >= 3) seamAllowance = offset;
      }
    }

    return { panel, outline, holes, seamAllowance };
  });
}

function spanX(geometries: PanelGeometry[]): { minX: number; maxX: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const geometry of geometries) {
    for (const loop of [geometry.outline, ...geometry.holes, ...(geometry.seamAllowance ? [geometry.seamAllowance] : [])]) {
      for (const p of loop) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      }
    }
  }

  return { minX, maxX };
}

function buildExportGroups(pattern: Pattern, opts: WriteDxfOptions): ExportGroup[] {
  const sizes = opts.sizes;
  const entries: { label: string | undefined; pattern: Pattern }[] =
    (sizes?.chart ?? []).map(size => ({ label: size.label, pattern: resolveSize(pattern, sizes?.fromSizeId, size.id) }));
  if (entries.length === 0) entries.push({ label: undefined, pattern });

  const groups: ExportGroup[] = entries.map(entry => ({
    label: entry.label,
    pattern: entry.pattern,
    geometries: panelGeometries(entry.pattern, opts.includeSeamAllowance),
    offsetXmm: 0,
  }));
  if (groups.length < 2) return groups;

  const spans = groups.map(group => spanX(group.geometries));
  const minX = Math.min(...spans.map(span => span.minX));
  const maxX = Math.max(...spans.map(span => span.maxX));
  const advance = (maxX - minX + (sizes?.gapCm ?? DEFAULT_SIZE_GAP_CM)) * CM_TO_MM;
  groups.forEach((group, index) => { group.offsetXmm = index * advance; });
  return groups;
}

function edgeOwners(pattern: Pattern): Map<string, { panelId: string; onHole: boolean }> {
  const ownerOfEdge = new Map<string, { panelId: string; onHole: boolean }>();
  for (const panel of Object.values(pattern.panels)) {
    for (const edgeId of panel.outlineEdgeIds) ownerOfEdge.set(edgeId, { panelId: panel.id, onHole: false });
    for (const loop of panel.holes ?? []) {
      for (const edgeId of loop) ownerOfEdge.set(edgeId, { panelId: panel.id, onHole: true });
    }
  }

  return ownerOfEdge;
}

function uniqueBlockName(used: Set<string>, panelName: string, sizeLabel: string | undefined, index: number): string {
  const base = sanitizeBlockName(sizeLabel ? `${panelName}-${sizeLabel}` : panelName, index);
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  used.add(name);
  return name;
}

function writeClosedPolyline(dxf: DxfWriter, layer: string, pts: Vec2[]): void {
  if (pts.length < 3) return;
  dxf.pair(0, 'LWPOLYLINE');
  dxf.pair(8, layer);
  dxf.pair(90, pts.length);
  dxf.pair(70, 1);
  for (const p of pts) {
    dxf.pair(10, f(p.x * CM_TO_MM));
    dxf.pair(20, f(p.y * CM_TO_MM));
  }
}

function writeOpenPolyline(dxf: DxfWriter, layer: string, pts: Vec2[]): void {
  if (pts.length < 2) return;
  dxf.pair(0, 'LWPOLYLINE');
  dxf.pair(8, layer);
  dxf.pair(90, pts.length);
  dxf.pair(70, 0);
  for (const p of pts) {
    dxf.pair(10, f(p.x * CM_TO_MM));
    dxf.pair(20, f(p.y * CM_TO_MM));
  }
}

function writeLine(dxf: DxfWriter, layer: string, a: Vec2, b: Vec2): void {
  dxf.pair(0, 'LINE');
  dxf.pair(8, layer);
  dxf.pair(10, f(a.x * CM_TO_MM));
  dxf.pair(20, f(a.y * CM_TO_MM));
  dxf.pair(11, f(b.x * CM_TO_MM));
  dxf.pair(21, f(b.y * CM_TO_MM));
}

function writeText(dxf: DxfWriter, layer: string, pos: Vec2, heightMm: number, rotationDeg: number, text: string): void {
  dxf.pair(0, 'TEXT');
  dxf.pair(8, layer);
  dxf.pair(10, f(pos.x * CM_TO_MM));
  dxf.pair(20, f(pos.y * CM_TO_MM));
  dxf.pair(30, '0.0000');
  dxf.pair(40, f(Math.max(0.1, heightMm)));
  dxf.pair(50, f(rotationDeg));
  dxf.pair(1, text.replace(/\r?\n/g, ' '));
}

function sanitizeBlockName(name: string, index: number): string {
  const cleaned = name.replace(/[<>/\\":;?*|=`,]/g, '_').trim() || `PANEL${index + 1}`;
  return cleaned;
}

function beginEntities(dxf: DxfWriter): void {
  dxf.pair(0, 'SECTION');
  dxf.pair(2, 'ENTITIES');
}

function finish(dxf: DxfWriter): string {
  dxf.pair(0, 'ENDSEC');
  dxf.pair(0, 'EOF');
  return dxf.toString();
}

export function writePatternDxf(pattern: Pattern, opts: WriteDxfOptions): string {
  const convention: DxfConvention = opts.convention ?? 'AAMA';
  const dxf = new DxfWriter(opts.encoding ?? 'utf-8');
  const groups = buildExportGroups(pattern, opts);

  dxf.pair(0, 'SECTION');
  dxf.pair(2, 'BLOCKS');

  const inserts: { blockName: string; offsetXmm: number }[] = [];
  const usedNames = new Set<string>();
  let panelIndex = 0;
  for (const group of groups) {
    const owners = edgeOwners(group.pattern);
    for (const geometry of group.geometries) {
      const blockName = uniqueBlockName(usedNames, geometry.panel.name, group.label, panelIndex++);
      writePanelBlock(dxf, group, geometry, owners, blockName, convention, opts);
      inserts.push({ blockName, offsetXmm: group.offsetXmm });
    }
  }

  dxf.pair(0, 'ENDSEC');
  beginEntities(dxf);

  for (const insert of inserts) {
    dxf.pair(0, 'INSERT');
    dxf.pair(8, '0');
    dxf.pair(2, insert.blockName);
    dxf.pair(10, f(insert.offsetXmm));
    dxf.pair(20, '0.0000');
    dxf.pair(30, '0.0000');
  }

  return finish(dxf);
}

function writePanelBlock(
  dxf: DxfWriter,
  group: ExportGroup,
  geometry: PanelGeometry,
  owners: Map<string, { panelId: string; onHole: boolean }>,
  blockName: string,
  convention: DxfConvention,
  opts: WriteDxfOptions,
): void {
  const { panel, outline } = geometry;
  const pattern = group.pattern;

  dxf.pair(0, 'BLOCK');
  dxf.pair(8, '0');
  dxf.pair(2, blockName);
  dxf.pair(10, '0.0000');
  dxf.pair(20, '0.0000');
  dxf.pair(30, '0.0000');

  writeClosedPolyline(dxf, layerName('outline', convention), outline);
  for (const loop of geometry.holes) {
    writeClosedPolyline(dxf, layerName('outline', convention), loop);
  }

  if (geometry.seamAllowance) {
    writeClosedPolyline(dxf, layerName('seamAllowance', convention), geometry.seamAllowance);
  }

  for (const lineId of panel.internalLineIds) {
    const line = pattern.internalLines[lineId];
    if (!line) continue;
    const layer = line.kind === 'fold'
      ? (convention === 'AAMA' ? '029-FOLD' : 'FOLD')
      : layerName('internalLine', convention);
    writeOpenPolyline(dxf, layer, line.points);
  }

  const box = computeBBox(outline);

  const grain = panelGrainLine(panel, outline);
  if (grain) writeLine(dxf, layerName('grainline', convention), grain[0]!, grain[1]!);

  for (const notch of Object.values(pattern.notches ?? {})) {
    const owner = owners.get(notch.edgeId);
    if (!owner || owner.panelId !== panel.id) continue;
    const at = pointAtT(pattern, notch.edgeId, notch.t);
    const samples = sampleEdgeCm(pattern, notch.edgeId);
    if (!at || samples.length < 2) continue;
    let bi = 0;
    let bd = Infinity;
    samples.forEach((p, i) => {
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    const a = samples[Math.max(0, bi - 1)];
    const b = samples[Math.min(samples.length - 1, bi + 1)];
    let normal = normalize2(perp2(sub2(b, a)));
    if (Math.hypot(normal.x, normal.y) < 0.5) continue;
    const center = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
    if (owner.onHole) normal = { x: -normal.x, y: -normal.y };
    if (dot2(normal, sub2(at, center)) < 0) normal = { x: -normal.x, y: -normal.y };
    const layer = notch.style === 'drill' ? layerName('drill', convention) : layerName('notch', convention);
    writeLine(dxf, layer, add2(at, scale2(normal, -0.3)), add2(at, scale2(normal, 0.2)));
  }

  for (const stitch of Object.values(pattern.topstitches ?? {})) {
    if (stitch.panelId !== panel.id || stitch.visible === false) continue;
    for (const row of topstitchRows(pattern, stitch)) {
      writeOpenPolyline(dxf, layerName('topstitch', convention), row);
    }
  }

  for (const annotation of Object.values(pattern.annotations ?? {})) {
    if (annotation.panelId !== panel.id) continue;
    writeText(dxf, layerName('annotation', convention), annotation.pos, annotation.sizeMm ?? 10, annotation.angleDeg ?? 0, annotation.text);
  }

  const labels = [...(group.label ? [group.label] : []), ...(opts.sizeLabels ?? [])];
  labels.forEach((label, i) => {
    writeText(dxf, layerName('annotation', convention),
      { x: box.min.x, y: box.min.y - 1 - i * 0.6 }, 8, 0, label);
  });

  dxf.pair(0, 'ENDBLK');
}

export function writeMarkerDxf(sheet: MarkerSheet, opts: WriteMarkerDxfOptions = {}): string {
  const convention: DxfConvention = opts.convention ?? 'AAMA';
  const dxf = new DxfWriter(opts.encoding ?? 'utf-8');

  beginEntities(dxf);
  writeClosedPolyline(dxf, '0', [
    { x: 0, y: 0 },
    { x: sheet.fabricWidthCm, y: 0 },
    { x: sheet.fabricWidthCm, y: sheet.usedLengthCm },
    { x: 0, y: sheet.usedLengthCm },
  ]);

  for (const entry of sheet.placements) {
    writeClosedPolyline(dxf, layerName('outline', convention), sheetOutline(entry));
    if (entry.piece.grain) {
      writeOpenPolyline(dxf, layerName('grainline', convention),
        entry.piece.grain.map(p => sheetPoint(entry, p)));
    }

    writeText(dxf, layerName('annotation', convention), sheetLabel(entry), 10, 0, entry.piece.name);
  }

  return finish(dxf);
}
