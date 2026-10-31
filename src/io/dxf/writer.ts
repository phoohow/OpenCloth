import type { Panel, Pattern, SizeDef, Vec2 } from '../../core/model/types';
import { pointAtT } from '../../pattern/geom/edgeSample';
import { edgeCurve, adaptiveSampleBezier } from '../../pattern/geom/bezier';
import { adaptiveSampleArc } from '../../pattern/geom/arc';
import { panelGrainLine, panelOutlineWithAllowance } from '../../pattern/panel/panelBuilder';
import { computeBBox, ensureCCW, perp, normalize, sub, dot } from '../../pattern/geom/vec2';
import { resolveSize } from '../../core/command/gradingCommands';
import {
  buildMarkerLayout, placePoint, placedLabel, placedOutline,
  type MarkerLayoutOptions,
} from '../../pattern/marker/markerLayout';
import { layerName, type DxfConvention } from './layers';

/** Text encoding of the string values written to a DXF file. */
export type DxfEncoding = 'utf-8' | 'ascii';

/**
 * Escapes every non-ASCII character of a string value as the `\U+XXXX` control sequence garment CAD
 * tools expect; backslashes are escaped too, code points beyond the BMP degrade to '?'.
 */
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

/** Reverses `escapeDxfValue`; raw `\U+XXXX` sequences in any DXF file decode the same way. */
export function unescapeDxfValue(value: string): string {
  return value.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)));
}

/** Multi-size export parameters for `writePatternDxf`. */
export interface WriteDxfSizes {
  /** Chart sizes to emit, in grading order (`orderedSizes(project)`); empty means single size. */
  chart: SizeDef[];
  /** Size the given pattern geometry already represents (`project.activeSizeId`); omit for base geometry. */
  fromSizeId?: string;
  /** Clear space between size groups along X in cm; default 10. */
  gapCm?: number;
}

/** Options for `writePatternDxf`. */
export interface WriteDxfOptions {
  /** Emit the offset (cutting) outline on the seam-allowance layer when panels carry an allowance. */
  includeSeamAllowance: boolean;
  /** Layer naming convention; default 'AAMA'. */
  convention?: DxfConvention;
  /** Optional size labels written as text marks under each panel. Grading is not applied. */
  sizeLabels?: string[];
  /** One BLOCK+INSERT group per chart size; groups advance along X so they never overlap. */
  sizes?: WriteDxfSizes;
  /** `'ascii'` escapes non-ASCII string values as `\U+XXXX`; `'utf-8'` (default) writes them raw. */
  encoding?: DxfEncoding;
}

const CM_TO_MM = 10;
const DEFAULT_SIZE_GAP_CM = 10;

/** Fixed 4-decimal DXF coordinate; keeps minus zero from printing. */
const f = (n: number): string => (Math.abs(n) < 5e-5 ? '0.0000' : n.toFixed(4));

class DxfWriter {
  private out: string[] = [];

  constructor(private readonly encoding: DxfEncoding = 'utf-8') { }

  /** Writes one group-code/value pair; numeric values are already ASCII, so escaping is a no-op. */
  pair(code: number, value: string | number): void {
    const text = String(value);
    this.out.push(String(code), this.encoding === 'ascii' ? escapeDxfValue(text) : text);
  }

  toString(): string {
    return this.out.join('\n') + '\n';
  }
}

/** Samples one edge finely in cm; arcs and beziers keep sub-0.01cm deviation. */
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

/** Closed sampled polygon for a list of edge ids, without the repeated closing vertex. */
function loopPolygon(pattern: Pattern, edgeIds: string[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const edgeId of edgeIds) {
    for (const p of sampleEdgeCm(pattern, edgeId)) {
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-9) continue;
      pts.push(p);
    }
  }
  if (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6) pts.pop();
  return pts;
}

/** Panel loops of one size sampled once in cm; reused for the block body and the X layout. */
interface PanelGeometry {
  panel: Panel;
  outline: Vec2[];
  holes: Vec2[][];
  seamAllowance: Vec2[] | null;
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

/** X extent in cm of every loop a size group writes. */
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

/** One export group: a size's resolved pattern, its sampled geometry and its X insert offset. */
interface ExportGroup {
  label: string | undefined;
  pattern: Pattern;
  geometries: PanelGeometry[];
  offsetXmm: number;
}

/**
 * Resolves each chart size with `resolveSize` and advances the groups along X by the widest group
 * plus the gap, so no two sizes overlap even though every block keeps its own pattern coordinates.
 */
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

/** Edge id to owning panel plus whether the edge sits on a hole loop. */
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

/** Block name made unique; the size label is appended so each size's panels stay attributable. */
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

/** Replaces characters DXF block names cannot contain. */
function sanitizeBlockName(name: string, index: number): string {
  const cleaned = name.replace(/[<>/\\":;?*|=`,]/g, '_').trim() || `PANEL${index + 1}`;
  return cleaned;
}

/** Opens the ENTITIES section of an R12 ASCII file. */
function beginEntities(dxf: DxfWriter): void {
  dxf.pair(0, 'SECTION');
  dxf.pair(2, 'ENTITIES');
}

/** Closes the ENTITIES section and terminates the file. */
function finish(dxf: DxfWriter): string {
  dxf.pair(0, 'ENDSEC');
  dxf.pair(0, 'EOF');
  return dxf.toString();
}

/**
 * Writes a pattern as an AutoCAD R12 ASCII DXF: one BLOCK per panel with the net
 * outline, optional seam allowance offset, grainline, notches, internal lines and
 * annotations. Pattern centimeters are written as millimeters, Y-up.
 *
 * `includeSeamAllowance` picks the rough (cutting) or net outline. `sizes.chart` resolves the
 * pattern to every chart size with `resolveSize` and writes one BLOCK per panel per size; each
 * block name ends with `-<size label>` and its INSERT carries an X offset of
 * `(widest group + gapCm) * 10` mm per index, so size groups never overlap and the reader
 * attributes every panel to its size from the block name alone.
 *
 * `encoding: 'ascii'` escapes every non-ASCII string value (panel names, annotations, block names)
 * as `\U+XXXX`; `parsePatternDxf` decodes it back. `'utf-8'` (default) writes values raw.
 * Output is byte-identical for identical input.
 */
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

/** Writes one panel's BLOCK definition: outlines, allowance, internals, grainline, notches and text. */
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
    let normal = normalize(perp(sub(b, a)));
    if (Math.hypot(normal.x, normal.y) < 0.5) continue;
    const center = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
    // Notches point away from the panel material: outward on the outline, inward on a hole.
    if (owner.onHole) normal = { x: -normal.x, y: -normal.y };
    if (dot(normal, sub(at, center)) < 0) normal = { x: -normal.x, y: -normal.y };
    const layer = notch.style === 'drill' ? layerName('drill', convention) : layerName('notch', convention);
    writeLine(dxf, layer, { x: at.x - normal.x * 0.3, y: at.y - normal.y * 0.3 }, { x: at.x + normal.x * 0.2, y: at.y + normal.y * 0.2 });
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

/** Marker packing options plus the layer naming convention, for `writeMarkerDxf`. */
export interface WriteMarkerDxfOptions extends MarkerLayoutOptions {
  /** Layer naming convention; default 'AAMA'. */
  convention?: DxfConvention;
  /** `'ascii'` escapes non-ASCII string values as `\U+XXXX`; `'utf-8'` (default) writes them raw. */
  encoding?: DxfEncoding;
}

/**
 * Writes a packed marker as an AutoCAD R12 ASCII DXF: the fabric-width boundary, one closed
 * polyline per placement, grainlines and panel-name labels. Centimetres become millimeters.
 */
export function writeMarkerDxf(pattern: Pattern, opts: WriteMarkerDxfOptions = {}): string {
  const convention: DxfConvention = opts.convention ?? 'AAMA';
  const layout = buildMarkerLayout(pattern, opts);
  const dxf = new DxfWriter(opts.encoding ?? 'utf-8');

  beginEntities(dxf);
  writeClosedPolyline(dxf, '0', [
    { x: 0, y: 0 },
    { x: layout.fabricWidthCm, y: 0 },
    { x: layout.fabricWidthCm, y: layout.usedLengthCm },
    { x: 0, y: layout.usedLengthCm },
  ]);

  for (const entry of layout.placements) {
    writeClosedPolyline(dxf, layerName('outline', convention), placedOutline(entry));
    if (entry.piece.grain) {
      writeOpenPolyline(dxf, layerName('grainline', convention),
        entry.piece.grain.map(p => placePoint(entry.piece, entry.place, p)));
    }
    writeText(dxf, layerName('annotation', convention), placedLabel(entry), 10, 0, entry.piece.name);
  }

  return finish(dxf);
}
