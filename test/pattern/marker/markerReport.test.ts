import { describe, expect, it } from 'vitest';
import { buildMarkerReport, markerReportCsv, polygonArea } from '../../../src/pattern/marker/markerReport';
import type { MarkerLayout, MarkerPlacement } from '../../../src/pattern/marker/markerLayout';

function placement(name: string, width: number, height: number): MarkerPlacement {
  return {
    piece: {
      panelId: name,
      name,
      width,
      height,
      outline: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
      grain: null,
    },
    place: { itemId: name, x: 0, y: 0, width, height, angleDeg: 0, flipped: false },
  };
}

function layout(): MarkerLayout {
  return {
    fabricWidthCm: 100,
    usedLengthCm: 200,
    utilization: 0.375,
    placements: [placement('前片', 50, 50), placement('后片', 100, 50)],
  };
}

describe('polygonArea', () => {
  it('returns the shoelace area regardless of winding', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }])).toBe(6);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 0, y: 3 }, { x: 4, y: 0 }])).toBe(6);
  });

  it('returns zero for degenerate outlines', () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(0);
  });
});

describe('buildMarkerReport', () => {
  it('aggregates area, utilization and grouped panel counts', () => {
    const report = buildMarkerReport(layout());
    expect(report.pieceCount).toBe(2);
    expect(report.usedLengthM).toBeCloseTo(2);
    expect(report.fabricAreaM2).toBeCloseTo(2);
    expect(report.garmentAreaM2).toBeCloseTo(0.75);
    expect(report.utilization).toBeCloseTo(0.375);
    expect(report.panels).toHaveLength(2);
    expect(report.panels).toEqual(expect.arrayContaining([
      { name: '前片', count: 1, areaM2: 0.25 },
      { name: '后片', count: 1, areaM2: 0.5 },
    ]));
    expect(report.cost).toBeNull();
  });

  it('prices the used fabric when a price is given', () => {
    const report = buildMarkerReport(layout(), { pricePerMeter: 12.5, currency: 'EUR' });
    expect(report.cost).toBeCloseTo(25);
    expect(report.currency).toBe('EUR');
  });

  it('ignores a negative price', () => {
    expect(buildMarkerReport(layout(), { pricePerMeter: -3 }).cost).toBeNull();
  });

  it('groups repeated panel names', () => {
    const repeated = layout();
    repeated.placements.push(placement('前片', 50, 50));
    const report = buildMarkerReport(repeated);
    expect(report.panels.find(panel => panel.name === '前片')?.count).toBe(2);
  });
});

describe('markerReportCsv', () => {
  it('writes fixed rows and escapes names containing separators', () => {
    const report = buildMarkerReport({
      ...layout(),
      placements: [placement('前,片"甲"', 10, 10)],
    });
    const csv = markerReportCsv(report);
    expect(csv).toContain('版片数,1');
    expect(csv).toContain('"前,片""甲"""');
  });
});
