import { describe, expect, it } from 'vitest';
import { fitReportCsv } from '../../../src/render/analysis/fitReport';

describe('fitReportCsv', () => {
  it('writes every fit number with fixed precision', () => {
    const csv = fitReportCsv('测试工程', {
      vertices: 100, penetration: 2, tight: 8, ideal: 70, loose: 20,
      minCm: -0.125, meanCm: 1.23456, maxCm: 3.4,
    }, { tightCm: 0.5, looseCm: 2.5 }, new Date('2026-10-31T00:00:00.000Z'));
    expect(csv).toContain('工程,测试工程');
    expect(csv).toContain('日期,2026-10-31T00:00:00.000Z');
    expect(csv).toContain('贴近阈值 (cm),0.50');
    expect(csv).toContain('宽松阈值 (cm),2.50');
    expect(csv).toContain('最小间隙 (cm),-0.125');
    expect(csv).toContain('平均间隙 (cm),1.235');
    expect(csv).toContain('最大间隙 (cm),3.400');
  });

  it('quotes project names containing separators', () => {
    const csv = fitReportCsv('前,后"片"', {
      vertices: 1, penetration: 0, tight: 0, ideal: 1, loose: 0,
      minCm: 0, meanCm: 0, maxCm: 0,
    }, { tightCm: 0.5, looseCm: 2.5 });
    expect(csv).toContain('工程,"前,后""片"""');
  });
});
