import type { Vec2 } from '../../core/model/types';

/** One polyline vertex; `bulge` is tan(quarter of the included angle) of the arc to the next vertex. */
export interface DxfVertex {
  x: number;
  y: number;
  bulge?: number;
}

/** A parsed DXF entity; coordinates stay in the file's drawing units. */
export type DxfEntity =
  | { kind: 'line'; layer: string; start: Vec2; end: Vec2 }
  | { kind: 'polyline'; layer: string; vertices: DxfVertex[]; closed: boolean }
  | { kind: 'circle'; layer: string; center: Vec2; radius: number }
  | { kind: 'arc'; layer: string; center: Vec2; radius: number; startAngleDeg: number; endAngleDeg: number }
  | { kind: 'text'; layer: string; pos: Vec2; height: number; rotationDeg: number; text: string }
  | { kind: 'insert'; layer: string; blockName: string; pos: Vec2; xScale: number; yScale: number; rotationDeg: number };

/** A BLOCK definition with its base point and contained entities. */
export interface DxfBlock {
  name: string;
  basePoint: Vec2;
  entities: DxfEntity[];
}

/** A whole R12 ASCII document: block definitions plus the root ENTITIES section. */
export interface DxfDocument {
  blocks: Record<string, DxfBlock>;
  entities: DxfEntity[];
}

interface Builder {
  type: string;
  layer: string;
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  r?: number;
  a1?: number;
  a2?: number;
  h?: number;
  rot?: number;
  text?: string;
  blockName?: string;
  sx?: number;
  sy?: number;
  flags?: number;
  vertices: DxfVertex[];
}

const newBuilder = (type: string): Builder => ({ type, layer: '0', vertices: [] });

const toNum = (value: string): number => Number(value.trim());

/** Tokenizes DXF text into (group code, value) pairs, skipping blank lines between pairs. */
export function tokenizePairs(text: string): Array<{ code: number; value: string }> {
  const lines = text.split(/\r?\n/);
  const pairs: Array<{ code: number; value: string }> = [];
  let i = 0;
  while (i + 1 < lines.length) {
    const rawCode = lines[i].trim();
    if (rawCode === '') {
      i += 1;
      continue;
    }
    const code = Number(rawCode);
    if (!Number.isInteger(code)) {
      i += 1;
      continue;
    }
    pairs.push({ code, value: lines[i + 1] });
    i += 2;
  }
  return pairs;
}

function finalize(b: Builder): DxfEntity | null {
  switch (b.type) {
    case 'LINE':
      if (b.x === undefined || b.y === undefined || b.x2 === undefined || b.y2 === undefined) return null;
      return { kind: 'line', layer: b.layer, start: { x: b.x, y: b.y }, end: { x: b.x2, y: b.y2 } };
    case 'POLYLINE':
    case 'LWPOLYLINE':
      if (b.vertices.length < 2) return null;
      return { kind: 'polyline', layer: b.layer, vertices: b.vertices, closed: ((b.flags ?? 0) & 1) === 1 };
    case 'CIRCLE':
      if (b.x === undefined || b.y === undefined || b.r === undefined) return null;
      return { kind: 'circle', layer: b.layer, center: { x: b.x, y: b.y }, radius: b.r };
    case 'ARC':
      if (b.x === undefined || b.y === undefined || b.r === undefined) return null;
      return {
        kind: 'arc', layer: b.layer, center: { x: b.x, y: b.y }, radius: b.r,
        startAngleDeg: b.a1 ?? 0, endAngleDeg: b.a2 ?? 360,
      };
    case 'TEXT':
    case 'MTEXT':
      return {
        kind: 'text', layer: b.layer, pos: { x: b.x ?? 0, y: b.y ?? 0 },
        height: b.h ?? 2.5, rotationDeg: b.rot ?? 0, text: b.text ?? '',
      };
    case 'INSERT':
      return {
        kind: 'insert', layer: b.layer, blockName: b.blockName ?? '',
        pos: { x: b.x ?? 0, y: b.y ?? 0 }, xScale: b.sx ?? 1, yScale: b.sy ?? 1, rotationDeg: b.rot ?? 0,
      };
    default:
      return null;
  }
}

/** Parses an AutoCAD R12 ASCII DXF document; unrecognized entities and sections are skipped. */
export function parseDxf(text: string): DxfDocument {
  const pairs = tokenizePairs(text);
  const doc: DxfDocument = { blocks: {}, entities: [] };

  let section = '';
  let block: DxfBlock | null = null;
  let ent: Builder | null = null;
  // BLOCK header fields read before the block body starts.
  let blockHeader = false;
  let blockName = '';
  let blockBase: Vec2 = { x: 0, y: 0 };
  // Legacy POLYLINE collects its VERTEX entities here.
  let openPoly: Builder | null = null;
  let vertexRef: DxfVertex | null = null;

  const sink = (): DxfEntity[] | null =>
    block ? block.entities : section === 'ENTITIES' ? doc.entities : null;

  const emit = (b: Builder | null): void => {
    const entity = b ? finalize(b) : null;
    if (entity) sink()?.push(entity);
  };

  const closePoly = (): void => {
    emit(openPoly);
    openPoly = null;
  };

  const materializeBlock = (): DxfBlock => ({ name: blockName, basePoint: blockBase, entities: [] });

  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    const raw = value.trim();
    const marker = raw.toUpperCase();

    if (code === 0) {
      if (blockHeader) {
        blockHeader = false;
        block = materializeBlock();
        blockName = '';
        blockBase = { x: 0, y: 0 };
      }
      if (marker === 'VERTEX' && openPoly) {
        ent = newBuilder('VERTEX');
        vertexRef = null;
        continue;
      }
      closePoly();
      emit(ent);
      ent = null;
      vertexRef = null;

      if (marker === 'SECTION') {
        const next = pairs[i + 1];
        if (next?.code === 2) {
          section = next.value.trim().toUpperCase();
          i += 1;
        }
        continue;
      }
      if (marker === 'ENDSEC') {
        section = '';
        if (block) {
          doc.blocks[block.name] = block;
          block = null;
        }
        continue;
      }
      if (marker === 'EOF') break;

      if (marker === 'BLOCK') {
        blockHeader = true;
        continue;
      }
      if (marker === 'ENDBLK') {
        if (block) {
          doc.blocks[block.name] = block;
          block = null;
        }
        continue;
      }
      if (marker === 'POLYLINE') {
        openPoly = newBuilder('POLYLINE');
        continue;
      }
      if (marker === 'SEQEND') continue;

      ent = newBuilder(marker);
      continue;
    }

    const b = ent;
    if (!b) {
      if (blockHeader && code === 2) blockName = raw;
      if (blockHeader && code === 10) blockBase = { x: toNum(raw), y: blockBase.y };
      if (blockHeader && code === 20) blockBase = { x: blockBase.x, y: toNum(raw) };
      if (openPoly && code === 8) openPoly.layer = raw;
      if (openPoly && code === 70) openPoly.flags = toNum(raw);
      continue;
    }

    if (b.type === 'VERTEX') {
      // VERTEX codes append one vertex to the owning POLYLINE each time code 10 repeats.
      if (code === 10) {
        vertexRef = { x: toNum(raw), y: 0 };
        openPoly?.vertices.push(vertexRef);
      } else if (code === 20 && vertexRef) vertexRef.y = toNum(raw);
      else if (code === 42 && vertexRef) vertexRef.bulge = toNum(raw);
      else if (code === 8 && openPoly) openPoly.layer = raw;
      continue;
    }

    if (b.type === 'LWPOLYLINE') {
      if (code === 10) {
        vertexRef = { x: toNum(raw), y: 0 };
        b.vertices.push(vertexRef);
      } else if (code === 20 && vertexRef) vertexRef.y = toNum(raw);
      else if (code === 42 && vertexRef) vertexRef.bulge = toNum(raw);
      else if (code === 70) b.flags = toNum(raw);
      else if (code === 8) b.layer = raw;
      continue;
    }

    switch (code) {
      case 2:
        if (b.type === 'INSERT') b.blockName = raw;
        break;
      case 1:
        b.text = value;
        break;
      case 8:
        b.layer = raw;
        break;
      case 10:
        b.x = toNum(raw);
        break;
      case 20:
        b.y = toNum(raw);
        break;
      case 11:
        b.x2 = toNum(raw);
        break;
      case 21:
        b.y2 = toNum(raw);
        break;
      case 40:
        if (b.type === 'TEXT' || b.type === 'MTEXT') b.h = toNum(raw);
        else b.r = toNum(raw);
        break;
      case 41:
        b.sx = toNum(raw);
        break;
      case 42:
        if (b.type === 'INSERT') b.sy = toNum(raw);
        break;
      case 50:
        if (b.type === 'ARC') b.a1 = toNum(raw);
        else b.rot = toNum(raw);
        break;
      case 51:
        b.a2 = toNum(raw);
        break;
      case 70:
        b.flags = toNum(raw);
        break;
      default:
        break;
    }
  }

  // Close out an unterminated document.
  if (blockHeader) {
    blockHeader = false;
    block = materializeBlock();
  }
  closePoly();
  emit(ent);
  if (block && !doc.blocks[block.name]) doc.blocks[block.name] = block;
  return doc;
}

interface Xf {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
  rotDeg: number;
}

function applyXf(p: Vec2, xf: Xf): Vec2 {
  const rad = (xf.rotDeg * Math.PI) / 180;
  const x = p.x * xf.sx;
  const y = p.y * xf.sy;
  return {
    x: xf.ox + x * Math.cos(rad) - y * Math.sin(rad),
    y: xf.oy + x * Math.sin(rad) + y * Math.cos(rad),
  };
}

function transformEntity(e: DxfEntity, xf: Xf): DxfEntity {
  switch (e.kind) {
    case 'line':
      return { ...e, start: applyXf(e.start, xf), end: applyXf(e.end, xf) };
    case 'polyline':
      return { ...e, vertices: e.vertices.map(v => ({ ...applyXf(v, xf), bulge: v.bulge })) };
    case 'circle':
      return { ...e, center: applyXf(e.center, xf), radius: e.radius * Math.abs(xf.sx) };
    case 'arc':
      return {
        ...e, center: applyXf(e.center, xf), radius: e.radius * Math.abs(xf.sx),
        startAngleDeg: e.startAngleDeg + xf.rotDeg, endAngleDeg: e.endAngleDeg + xf.rotDeg,
      };
    case 'text':
      return { ...e, pos: applyXf(e.pos, xf), height: e.height * Math.abs(xf.sy), rotationDeg: e.rotationDeg + xf.rotDeg };
    case 'insert':
      return {
        ...e, pos: applyXf(e.pos, xf),
        xScale: e.xScale * xf.sx, yScale: e.yScale * xf.sy, rotationDeg: e.rotationDeg + xf.rotDeg,
      };
  }
}

/** Resolves INSERT references into transformed copies of the referenced block's entities. */
export function expandInserts(entities: DxfEntity[], doc: DxfDocument, depth = 0): DxfEntity[] {
  if (depth > 8) return [];
  const out: DxfEntity[] = [];
  for (const e of entities) {
    if (e.kind !== 'insert') {
      out.push(e);
      continue;
    }
    const block = doc.blocks[e.blockName];
    if (!block) continue;
    const xf: Xf = {
      ox: e.pos.x,
      oy: e.pos.y,
      sx: e.xScale,
      sy: e.yScale,
      rotDeg: e.rotationDeg,
    };
    const shifted = block.entities.map(be => baseShift(be, block.basePoint));
    out.push(...expandInserts(shifted.map(be => transformEntity(be, xf)), doc, depth + 1));
  }
  return out;
}

/** Moves an entity so the block base point sits at the origin. */
function baseShift(e: DxfEntity, base: Vec2): DxfEntity {
  const sub = (p: Vec2): Vec2 => ({ x: p.x - base.x, y: p.y - base.y });
  switch (e.kind) {
    case 'line':
      return { ...e, start: sub(e.start), end: sub(e.end) };
    case 'polyline':
      return { ...e, vertices: e.vertices.map(v => ({ ...sub(v), bulge: v.bulge })) };
    case 'circle':
    case 'arc':
      return { ...e, center: sub(e.center) };
    case 'text':
    case 'insert':
      return { ...e, pos: sub(e.pos) };
  }
}
