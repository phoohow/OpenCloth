import { describe, expect, it } from 'vitest';
import type { Pattern, Vec2 } from '@/model/types';
import { createEmptyPattern } from '@/model/defaults';
import { buildPatternPdf, planPdfTiling } from '@/io/exporters/pdfPattern';
import { CM_PT } from '@/io/pdf/pdfDocument';
import { addSquare } from '../core/command/fixtures';

/** Empty pattern holding one rectangle panel with a controlled allowance. */
function rectPattern(size: number, allowanceCm: number): Pattern {
  const pattern = createEmptyPattern();
  const panelId = addSquare(pattern, 'a', 0, 0, size);
  pattern.panels[panelId]!.seamAllowanceCm = allowanceCm;
  return pattern;
}

/** True when the page's clip rectangle contains the point. */
function coversPoint(page: { clipCm: { min: Vec2; max: Vec2 } }, p: Vec2): boolean {
  return p.x >= page.clipCm.min.x - 1e-9 && p.x <= page.clipCm.max.x + 1e-9
    && p.y >= page.clipCm.min.y - 1e-9 && p.y <= page.clipCm.max.y + 1e-9;
}

const decode = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

/** Asserts ASCII-only content and that every xref offset resolves to its object header. */
function expectValidPdf(pdf: string): void {
  expect([...pdf].every(ch => ch.charCodeAt(0) < 128)).toBe(true);
  const startxref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  expect(offsets.length).toBeGreaterThan(0);
  offsets.forEach((offset, i) => {
    expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
}

describe('planPdfTiling', () => {
  it('covers the whole allowance bounds with a full page grid', () => {
    const pattern = rectPattern(50, 1);
    const tiling = planPdfTiling(pattern, { page: 'A4', marginCm: 1, overlapCm: 1, includeSeamAllowance: true });
    expect(tiling.boundsCm).not.toBeNull();
    const bounds = tiling.boundsCm!;
    expect(bounds.min.x).toBeCloseTo(-1, 6);
    expect(bounds.min.y).toBeCloseTo(-1, 6);
    expect(bounds.max.x).toBeCloseTo(51, 6);
    expect(bounds.max.y).toBeCloseTo(51, 6);

    expect(tiling.pages).toHaveLength(tiling.cols * tiling.rows);
    const first = tiling.pages[0]!;
    const last = tiling.pages[tiling.pages.length - 1]!;
    expect(first.clipCm.min.x).toBeCloseTo(bounds.min.x, 9);
    expect(first.clipCm.max.y).toBeCloseTo(bounds.max.y, 9);
    expect(last.clipCm.max.x).toBeGreaterThanOrEqual(bounds.max.x - 1e-9);
    expect(last.clipCm.min.y).toBeLessThanOrEqual(bounds.min.y + 1e-9);

    // Every corner of the bounds falls on at least one page.
    for (const corner of [
      { x: bounds.min.x, y: bounds.min.y }, { x: bounds.max.x, y: bounds.max.y },
      { x: bounds.min.x, y: bounds.max.y }, { x: bounds.max.x, y: bounds.min.y },
    ]) {
      expect(tiling.pages.some(page => coversPoint(page, corner))).toBe(true);
    }
    for (const page of tiling.pages) expect(page.scalePtPerCm).toBe(CM_PT);
  });

  it('overlaps neighbouring pages by the requested amount', () => {
    const tiling = planPdfTiling(rectPattern(80, 0), { page: 'A4', overlapCm: 1.5 });
    expect(tiling.cols).toBeGreaterThan(1);
    expect(tiling.rows).toBeGreaterThan(1);
    for (let row = 0; row < tiling.rows; row++) {
      for (let col = 1; col < tiling.cols; col++) {
        const left = tiling.pages[row * tiling.cols + col - 1]!;
        const right = tiling.pages[row * tiling.cols + col]!;
        expect(right.clipCm.min.x - left.clipCm.max.x).toBeCloseTo(-1.5, 9);
      }
    }
    for (let row = 1; row < tiling.rows; row++) {
      const above = tiling.pages[(row - 1) * tiling.cols]!;
      const below = tiling.pages[row * tiling.cols]!;
      expect(above.clipCm.min.y - below.clipCm.max.y).toBeCloseTo(-1.5, 9);
    }
  });

  it('keeps neighbouring pages at one continuous 1:1 mapping', () => {
    const tiling = planPdfTiling(rectPattern(80, 0), { page: 'A4', overlapCm: 1 });
    const a = tiling.pages[0]!;
    const b = tiling.pages[1]!;
    const probe = a.clipCm.max.x - 0.2;
    const ax = a.offsetPt.x + probe * CM_PT;
    const bx = b.offsetPt.x + probe * CM_PT;
    expect(ax - bx).toBeCloseTo((b.clipCm.min.x - a.clipCm.min.x) * CM_PT, 6);
    expect(a.offsetPt.y).toBeCloseTo(b.offsetPt.y, 9);
  });

  it('derives the tile size from the paper and margin', () => {
    const a4 = planPdfTiling(rectPattern(10, 0), { page: 'A4', marginCm: 1 });
    expect(a4.tileCm.x).toBeCloseTo(19, 3);
    expect(a4.tileCm.y).toBeCloseTo(27.7, 3);
    const a4Wide = planPdfTiling(rectPattern(10, 0), { page: 'A4', marginCm: 2 });
    expect(a4Wide.tileCm.x).toBeCloseTo(17, 3);
    const a3 = planPdfTiling(rectPattern(10, 0), { page: 'A3', marginCm: 1 });
    expect(a3.tileCm.x).toBeCloseTo(27.7, 3);
    expect(a3.tileCm.y).toBeCloseTo(40, 2);
    expect(a4.pages).toHaveLength(1);
  });

  it('follows the seam allowance flag when bounding the pattern', () => {
    const net = planPdfTiling(rectPattern(50, 1), { includeSeamAllowance: false });
    expect(net.boundsCm!.min.x).toBeCloseTo(0, 6);
    expect(net.boundsCm!.max.x).toBeCloseTo(50, 6);
    const gross = planPdfTiling(rectPattern(50, 1), { includeSeamAllowance: true });
    expect(gross.boundsCm!.max.x).toBeCloseTo(51, 6);
  });

  it('returns no pages for an empty pattern', () => {
    const tiling = planPdfTiling(createEmptyPattern(), {});
    expect(tiling.boundsCm).toBeNull();
    expect(tiling.pages).toEqual([]);
    expect(tiling.cols).toBe(0);
    expect(tiling.rows).toBe(0);
  });
});

describe('buildPatternPdf', () => {
  it('writes one page in single mode', () => {
    const pdf = decode(buildPatternPdf(rectPattern(20, 1), {}));
    expectValidPdf(pdf);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 1');
    expect(pdf).toContain('Scale 1:1');
  });

  it('writes one page per tile, with page grid notes', () => {
    const pattern = rectPattern(80, 0);
    const tiling = planPdfTiling(pattern, { page: 'A4', overlapCm: 1 });
    const pdf = decode(buildPatternPdf(pattern, { page: 'A4', mode: 'tile', overlapCm: 1 }));
    expectValidPdf(pdf);
    expect(pdf).toContain(`/Count ${tiling.pages.length}`);
    expect(pdf).toContain('1:1  tiled');
    expect(pdf).toContain(`Page 1 / ${tiling.pages.length}`);
  });

  it('still emits a single page for an empty tiled pattern', () => {
    const pdf = decode(buildPatternPdf(createEmptyPattern(), { mode: 'tile' }));
    expectValidPdf(pdf);
    expect(pdf).toContain('/Count 1');
    expect(pdf).toContain('No visible panels');
  });
});
