import type { Pattern, Vec2 } from '../../core/model/types';
import { patternFromGroups } from './patternFromGroups';

/** Options for the PDF vector reader. */
export interface PdfPatternOptions {
  /** Group name used for the imported pieces. */
  name?: string;
}

/** Centimetres per PDF page point. */
const PT_TO_CM = 2.54 / 72;

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface SubPath {
  points: Vec2[];
  closed: boolean;
}

/** Concatenates two PDF matrices: the current transform followed by the new one. */
function concatMatrix(current: Matrix, next: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = current;
  const [a2, b2, c2, d2, e2, f2] = next;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

/** Applies a matrix to one page point. */
function applyMatrix(m: Matrix, x: number, y: number): Vec2 {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Samples a cubic bezier, appending everything after the start point. */
function appendCubic(points: Vec2[], p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): void {
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
}

/** Point chains of one PDF content stream, in page points. */
export function pathChains(content: string): Vec2[][] {
  const cleaned = content
    .replace(/BT[\s\S]*?ET/g, '')
    .replace(/BI[\s\S]*?EI/g, '')
    .replace(/%.*$/gm, '');
  const tokenRe = /([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)|([A-Za-z]+)/gi;
  const chains: Vec2[][] = [];
  const subpaths: SubPath[] = [];
  let pending: Vec2[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  let operands: number[] = [];

  /** Moves the current subpath into the list and starts a new one at a point. */
  const startSubpath = (point: Vec2): void => {
    if (pending.length >= 2) subpaths.push({ points: pending, closed: false });
    pending = [point];
  };

  /** Emits every finished subpath; `closeAll` closes them as the `s` / `b` operators do. */
  const paint = (closeAll: boolean): void => {
    if (pending.length >= 2) subpaths.push({ points: pending, closed: closeAll });
    pending = [];
    for (const path of subpaths) {
      if (path.points.length < 2) continue;
      chains.push(path.closed ? [...path.points, path.points[0]!] : path.points);
    }
    subpaths.length = 0;
  };

  for (const match of cleaned.matchAll(tokenRe)) {
    const number = match[1];
    if (number !== undefined) {
      operands.push(Number(number));
      continue;
    }
    const op = match[2]!;
    const args = operands;
    operands = [];

    switch (op) {
      case 'q':
        stack.push(ctm);
        break;
      case 'Q':
        ctm = stack.pop() ?? IDENTITY;
        break;
      case 'cm':
        if (args.length >= 6) {
          ctm = concatMatrix(ctm, [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!]);
        }
        break;
      case 'm':
        if (args.length >= 2) startSubpath(applyMatrix(ctm, args[0]!, args[1]!));
        break;
      case 'l':
        if (args.length >= 2) pending.push(applyMatrix(ctm, args[0]!, args[1]!));
        break;
      case 'c':
        if (args.length >= 6 && pending.length > 0) {
          const p0 = pending[pending.length - 1]!;
          appendCubic(
            pending, p0,
            applyMatrix(ctm, args[0]!, args[1]!),
            applyMatrix(ctm, args[2]!, args[3]!),
            applyMatrix(ctm, args[4]!, args[5]!),
          );
        }
        break;
      case 'v':
        if (args.length >= 4 && pending.length > 0) {
          const p0 = pending[pending.length - 1]!;
          appendCubic(pending, p0, p0, applyMatrix(ctm, args[0]!, args[1]!), applyMatrix(ctm, args[2]!, args[3]!));
        }
        break;
      case 'y':
        if (args.length >= 4 && pending.length > 0) {
          const p0 = pending[pending.length - 1]!;
          const end = applyMatrix(ctm, args[2]!, args[3]!);
          appendCubic(pending, p0, applyMatrix(ctm, args[0]!, args[1]!), end, end);
        }
        break;
      case 'h':
        if (pending.length >= 2) {
          pending.push({ ...pending[0]! });
          subpaths.push({ points: pending, closed: true });
          pending = [];
        }
        break;
      case 'S':
        paint(false);
        break;
      case 's':
        paint(true);
        break;
      case 'f':
      case 'F':
      case 'B':
        paint(false);
        break;
      case 'b':
        paint(true);
        break;
      case 'n':
        pending = [];
        subpaths.length = 0;
        break;
      default:
        break;
    }
  }
  paint(false);
  return chains;
}

/** Latin-1 text of a byte buffer; PDF keywords and content streams are byte-oriented. */
function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

/** Inflates one FlateDecode stream, or null when the platform or data cannot decompress it. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const data = new Uint8Array(bytes.length);
    data.set(bytes);
    const stream = new Blob([data.buffer]).stream().pipeThrough(new DecompressionStream('deflate'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/** Decoded content streams of a PDF, skipping images, fonts, object streams and metadata. */
async function contentStreams(bytes: Uint8Array): Promise<string[]> {
  const latin = bytesToLatin1(bytes);
  const found: { start: number; end: number; flate: boolean }[] = [];
  let cursor = 0;
  while (cursor < latin.length) {
    const at = latin.indexOf('stream', cursor);
    if (at < 0) break;
    if (latin.slice(at - 3, at) === 'end') {
      cursor = at + 6;
      continue;
    }
    let start = at + 6;
    if (latin[start] === '\r') start += 1;
    if (latin[start] === '\n') start += 1;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    const header = latin.slice(Math.max(0, at - 400), at);
    const skip = /\/Subtype\s*\/Image/.test(header)
      || /\/Type\s*\/ObjStm/.test(header)
      || /\/Type\s*\/Metadata/.test(header)
      || /\/FontFile/.test(header);
    if (!skip) found.push({ start, end, flate: /\/FlateDecode/.test(header) });
    cursor = end + 9;
  }

  const contents: string[] = [];
  for (const stream of found) {
    const slice = bytes.subarray(stream.start, stream.end);
    const decoded = stream.flate ? await inflate(slice) : slice;
    if (decoded && decoded.length > 0) contents.push(bytesToLatin1(decoded));
  }
  return contents;
}

/** True when a chain is large enough and small enough to be a garment piece. */
function plausible(chain: Vec2[]): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of chain) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return width >= 0.1 && height >= 0.1 && width <= 1000 && height <= 1000;
}

/**
 * Extracts vector paths from a PDF and builds a pattern from their closed contours.
 * Content streams may be Flate-compressed; images, fonts and text runs are skipped.
 */
export async function parsePdfPattern(bytes: Uint8Array, options: PdfPatternOptions = {}): Promise<Pattern> {
  const latin = bytesToLatin1(bytes);
  if (/\/Encrypt/.test(latin)) throw new Error('加密 PDF 暂不支持');
  const streams = await contentStreams(bytes);
  const groups = streams
    .map((content, index) => {
      const chains = pathChains(content)
        .map(chain => chain.map(p => ({ x: p.x * PT_TO_CM, y: p.y * PT_TO_CM })))
        .filter(plausible);
      return { name: `${options.name ?? 'PDF'} ${index + 1}`, chains };
    })
    .filter(group => group.chains.length > 0);
  if (groups.length === 0) throw new Error('PDF 里没有可识别的矢量路径');
  return patternFromGroups(groups);
}
