import { describe, expect, it } from 'vitest';
import { strainReportCsv } from '../../../src/render/analysis/strainReport';
import type { StrainStats } from '../../../src/render/analysis/strain';

describe('strainReportCsv', () => {
  it('lists the project, colour range and strain summary', () => {
    const stats: StrainStats = { min: -0.1, max: 0.2, meanAbs: 0.05 };
    const csv = strainReportCsv('连衣裙', stats, { min: -0.25, max: 0.25 });
    expect(csv).toContain('工程,连衣裙');
    expect(csv).toContain('色标下限,-0.250');
    expect(csv).toContain('色标上限,0.250');
    expect(csv).toContain('最小应变,-0.10000');
    expect(csv).toContain('最大应变,0.20000');
    expect(csv).toContain('平均绝对应变,0.05000');
  });
});