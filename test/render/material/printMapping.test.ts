import { describe, expect, it } from 'vitest';
import type { Pattern, Print } from '@/model/types';
import { createEmptyPattern } from '@/model/defaults';
import { panelPrintFrame, printPlacement } from '@/render/material/printTexture';
import { addSquare } from '../../core/command/fixtures';

/** 10 × 10 cm square whose simulation mesh spans the seam-allowance box. */
function frameFixture(): { pattern: Pattern; panelId: string; positions2D: Float32Array } {
  const pattern = createEmptyPattern();
  const panelId = addSquare(pattern, 'sq', 0, 0, 10);
  pattern.panels[panelId]!.seamAllowanceCm = 0.5;
  const positions2D = new Float32Array([-0.5, -0.5, 10.5, -0.5, 10.5, 10.5, -0.5, 10.5]);
  return { pattern, panelId, positions2D };
}

function printRecord(panelId: string, patch: Partial<Print> = {}): Print {
  return {
    id: 'pr', panelId, imageUrl: 'data:image/png;base64,AAAA', center: { x: 2, y: -1 },
    widthCm: 4, heightCm: 2, angleDeg: 15, opacity: 0.7, repeat: { x: 1, y: 1 }, visible: true,
    ...patch,
  };
}

describe('panelPrintFrame', () => {
  it('uses the outline centre and the mesh box the UVs normalise over', () => {
    const { pattern, panelId, positions2D } = frameFixture();
    const frame = panelPrintFrame(pattern, panelId, positions2D);
    expect(frame).not.toBeNull();
    expect(frame!.center).toEqual({ x: 5, y: 5 });
    expect(frame!.min).toEqual({ x: -0.5, y: -0.5 });
    expect(frame!.max).toEqual({ x: 10.5, y: 10.5 });
  });

  it('returns null for a missing panel or a mesh without triangles', () => {
    const { pattern, positions2D } = frameFixture();
    expect(panelPrintFrame(pattern, 'missing', positions2D)).toBeNull();
    expect(panelPrintFrame(pattern, 'sq_panel', new Float32Array([0, 0]))).toBeNull();
  });
});

describe('printPlacement', () => {
  it('maps the print rectangle into the panel UV square', () => {
    const { pattern, panelId, positions2D } = frameFixture();
    const frame = panelPrintFrame(pattern, panelId, positions2D)!;
    const placement = printPlacement(printRecord(panelId), frame);
    expect(placement.center.x).toBeCloseTo(7.5 / 11, 8);
    expect(placement.center.y).toBeCloseTo(4.5 / 11, 8);
    expect(placement.width).toBeCloseTo(4 / 11, 8);
    expect(placement.height).toBeCloseTo(2 / 11, 8);
    expect(placement.angleDeg).toBe(15);
    expect(placement.opacity).toBe(0.7);
    expect(placement.repeat).toEqual({ x: 1, y: 1 });
  });

  it('clamps opacity and keeps repeat counts at least one', () => {
    const { pattern, panelId, positions2D } = frameFixture();
    const frame = panelPrintFrame(pattern, panelId, positions2D)!;
    const placement = printPlacement(printRecord(panelId, { opacity: 2, repeat: { x: 0, y: -1 } }), frame);
    expect(placement.opacity).toBe(1);
    expect(placement.repeat).toEqual({ x: 1, y: 1 });
  });
});
