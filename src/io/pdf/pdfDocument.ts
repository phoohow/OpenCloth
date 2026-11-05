import type { Vec2 } from '@/model/types';
import { clamp } from '@/common/math';

/** Page points per centimetre at 1:1. */
export const CM_PT = 28.3465;

/** Rounds to micropoints; plain decimal, never exponential. */
export function pdfNum(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

export { clamp };

/** True when a run cannot be set in Helvetica and needs the CJK font. */
export function needsCjk(text: string): boolean {
  return /[^\x20-\x7E]/.test(text);
}

/** Keeps printable ASCII only; Helvetica has no CJK or other non-ASCII glyphs. */
function asciiText(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '');
}

/** Escapes a PDF literal string. */
function pdfLiteral(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** UTF-16BE hex string for the predefined Adobe-GB1 font; surrogate pairs fall back to '?'. */
function utf16Hex(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    out += (cp > 0xffff ? 0x3f : cp).toString(16).padStart(4, '0');
  }
  return out;
}

/**
 * Estimated advance width of a run in page points; CJK glyphs are one em, ASCII 0.55 em.
 * Used for column fitting, so exact per-glyph metrics are not required.
 */
export function textWidthPt(text: string, sizePt: number): number {
  let em = 0;
  for (const ch of text) em += (ch.codePointAt(0) ?? 0) > 0x7e ? 1 : 0.55;
  return em * sizePt;
}

/**
 * Text run in page points. Non-ASCII runs switch to the predefined Adobe-GB1 font
 * (`STSong-Light`), so Chinese prints without embedding a font file; `latin` drops
 * non-ASCII characters instead. With `cjk` and no rotation, ASCII and non-ASCII
 * segments are set separately so digits and units keep their Helvetica shapes.
 */
export function textOps(p: Vec2, sizePt: number, text: string, angleDeg = 0, font: 'latin' | 'cjk' = 'latin'): string {
  const size = pdfNum(clamp(sizePt, 5, 40));
  if (font === 'cjk' && !angleDeg) return mixedTextOps(p, clamp(sizePt, 5, 40), text);

  const useCjk = font === 'cjk' && needsCjk(text);
  const body = useCjk ? `<${utf16Hex(text)}>` : `(${pdfLiteral(asciiText(text))})`;
  if (body === '()' || body === '<>') return '';
  const id = useCjk ? 'F2' : 'F1';
  const lit = `${body} Tj ET\n`;
  if (!angleDeg) return `BT /${id} ${size} Tf 1 0 0 1 ${pdfNum(p.x)} ${pdfNum(p.y)} Td ${lit}`;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return `BT /${id} ${size} Tf ${pdfNum(cos)} ${pdfNum(sin)} ${pdfNum(-sin)} ${pdfNum(cos)} ${pdfNum(p.x)} ${pdfNum(p.y)} Tm ${lit}`;
}

/** Sets each ASCII or CJK segment with its own font, advancing by the estimated width. */
function mixedTextOps(p: Vec2, sizePt: number, text: string): string {
  const runs: Array<{ text: string; cjk: boolean }> = [];
  for (const ch of text) {
    const cjk = (ch.codePointAt(0) ?? 0) > 0x7e;
    const last = runs[runs.length - 1];
    if (last && last.cjk === cjk) last.text += ch;
    else runs.push({ text: ch, cjk });
  }
  let x = p.x;
  let out = '';
  for (const run of runs) {
    const body = run.cjk ? `<${utf16Hex(run.text)}>` : `(${pdfLiteral(run.text)})`;
    if (body !== '()' && body !== '<>') {
      out += `BT /${run.cjk ? 'F2' : 'F1'} ${pdfNum(sizePt)} Tf 1 0 0 1 ${pdfNum(x)} ${pdfNum(p.y)} Td ${body} Tj ET\n`;
    }
    x += textWidthPt(run.text, sizePt);
  }
  return out;
}

/** Closed stroked path: `m ... l h S`. */
export function closedPath(pts: Vec2[]): string {
  const head = pts[0]!;
  const rest = pts.slice(1).map(p => `${pdfNum(p.x)} ${pdfNum(p.y)} l`).join('\n');
  return `${pdfNum(head.x)} ${pdfNum(head.y)} m${rest ? `\n${rest}` : ''}\nh S\n`;
}

/** Open stroked polyline: `m ... l S`. */
export function openPath(pts: Vec2[]): string {
  const head = pts[0]!;
  const rest = pts.slice(1).map(p => `${pdfNum(p.x)} ${pdfNum(p.y)} l`).join('\n');
  return `${pdfNum(head.x)} ${pdfNum(head.y)} m${rest ? `\n${rest}` : ''}\nS\n`;
}

/** Stroked circle via four bezier arcs, in page points. */
export function circlePath(c: Vec2, r: number): string {
  const k = r * 0.5523;
  const seg = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): string =>
    `${pdfNum(x1)} ${pdfNum(y1)} ${pdfNum(x2)} ${pdfNum(y2)} ${pdfNum(x)} ${pdfNum(y)} c`;
  return `${pdfNum(c.x + r)} ${pdfNum(c.y)} m\n`
    + `${seg(c.x + r, c.y + k, c.x + k, c.y + r, c.x, c.y + r)}\n`
    + `${seg(c.x - k, c.y + r, c.x - r, c.y + k, c.x - r, c.y)}\n`
    + `${seg(c.x - r, c.y - k, c.x - k, c.y - r, c.x, c.y - r)}\n`
    + `${seg(c.x + k, c.y - r, c.x + r, c.y - k, c.x + r, c.y)}\n`
    + 'h S\n';
}

/** Rectangle path for clipping or stroking, `re`. */
export function rectPath(x: number, y: number, w: number, h: number): string {
  return `${pdfNum(x)} ${pdfNum(y)} ${pdfNum(w)} ${pdfNum(h)} re\n`;
}

const FIRST_PAGE_OBJECT = 7;

/**
 * Assembles a PDF 1.4 document from finished page content streams: Catalog, Pages, the
 * Helvetica and Adobe-GB1 fonts, then one Page and Content object per stream. Every emitted
 * byte is ASCII (CJK runs are hex strings), so string length equals byte length and the
 * recorded xref offsets stay exact.
 */
export function assemblePdf(pageContents: string[], pageWidthPt: number, pageHeightPt: number): Uint8Array {
  const kids = pageContents.map((_, i) => `${FIRST_PAGE_OBJECT + i * 2} 0 R`).join(' ');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageContents.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H'
      + ' /DescendantFonts [5 0 R] >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light'
      + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >>'
      + ' /FontDescriptor 6 0 R /DW 1000 >>\nendobj\n',
    '6 0 obj\n<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6'
      + ' /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120'
      + ' /CapHeight 880 /StemV 93 >>\nendobj\n',
  ];
  pageContents.forEach((content, i) => {
    const pageObj = FIRST_PAGE_OBJECT + i * 2;
    objects.push(
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R`
        + ` /MediaBox [0 0 ${pdfNum(pageWidthPt)} ${pdfNum(pageHeightPt)}]`
        + ` /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>`
        + ` /Contents ${pageObj + 1} 0 R >>\nendobj\n`,
    );
    objects.push(`${pageObj + 1} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  });

  const header = '%PDF-1.4\n';
  const offsets: number[] = [];
  let body = header;
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefAt = body.length;
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) tail += `${String(off).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body + tail);
}
