import { describe, expect, it } from 'vitest';
import type { Pattern, Project } from '../../src/core/model/types';
import { createDefaultProject, createEmptyPattern } from '../../src/core/model/defaults';
import { buildTechPackData, buildTechPackPdf } from '../../src/io/techPack';
import { buildSamplePattern } from './dxf/samplePattern';
import { addSquare } from '../core/command/fixtures';
import { createStarterProject } from '../../src/pattern/template';

/** Project with the sample pattern, a size chart, a gather seam and dimension lines. */
function sampleProject(): { project: Project; pattern: Pattern } {
  const pattern = buildSamplePattern();
  pattern.seams['seam_side'] = {
    id: 'seam_side', type: 'gather',
    a: { edgeId: 'front_e1', t0: 0.2, t1: 0.8 },
    b: { edgeId: 'sleeve_e1', t0: 0, t1: 1 },
    flip: false, gatherRatio: 0.9, strength: 1, threadColor: '#ffffff', stitchVisible: true,
  };
  pattern.measurements['m_edge'] = { id: 'm_edge', name: '前中长', panelId: 'front', kind: 'edgeLength', refs: { edgeId: 'front_e1' } };
  pattern.measurements['m_dist'] = { id: 'm_dist', panelId: 'front', kind: 'distance', refs: { pointAId: 'front_p0', pointBId: 'front_p1' } };
  pattern.measurements['m_angle'] = { id: 'm_angle', panelId: 'front', kind: 'angle', refs: { pointAId: 'front_p0', pointBId: 'front_p1' } };
  pattern.measurements['m_missing'] = { id: 'm_missing', panelId: 'front', kind: 'distance', refs: { pointAId: 'nope', pointBId: 'front_p1' } };
  pattern.prints['pr_logo'] = {
    id: 'pr_logo', panelId: 'front', imageUrl: 'data:image/png;base64,AAAA', imageName: '徽标.png',
    center: { x: 0, y: 0 }, widthCm: 8, heightCm: 6, angleDeg: 15, opacity: 0.8,
    repeat: { x: 2, y: 1 }, visible: true,
  };
  pattern.topstitches['ts_hem'] = {
    id: 'ts_hem', panelId: 'front', edgeId: 'front_e1', t0: 0, t1: 1, offsetMm: 3, spacingMm: 4,
    rows: 2, color: '#d9a441', stitchMm: 3, gapMm: 2, visible: true,
  };
  pattern.trims['tr_button'] = {
    id: 'tr_button', panelId: 'front', kind: 'button', pos: { x: 0, y: 0 }, sizeMm: 12,
    color: '#111111', qty: 5, unitPrice: 0.8, visible: true,
  };

  const project = createDefaultProject('测试工程');
  project.pattern = pattern;
  project.sizes = [
    { id: 's', label: 'S', seq: 0 },
    { id: 'm', label: 'M', seq: 1, isBase: true },
  ];
  project.activeSizeId = 'm';
  return { project, pattern };
}

const decode = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

/** Joins every hex text run so the sheet's Chinese copy can be asserted. */
function decodedText(pdf: string): string {
  return [...pdf.matchAll(/<([0-9a-f]+)> Tj/g)]
    .map(match => (match[1]!.match(/.{4}/g) ?? []).map(hex => String.fromCharCode(parseInt(hex, 16))).join(''))
    .join('\n');
}

/** Asserts ASCII-only content and that every xref offset resolves to its object header. */
function expectValidPdf(pdf: string): void {
  expect([...pdf].every(ch => ch.charCodeAt(0) < 128)).toBe(true);
  const startxref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  offsets.forEach((offset, i) => {
    expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
}

describe('buildTechPackData', () => {
  it('summarises the size chart with its base size', () => {
    const { project } = sampleProject();
    const data = buildTechPackData(project, { date: '2026-02-03' });
    expect(data.projectName).toBe('测试工程');
    expect(data.date).toBe('2026-02-03');
    expect(data.sizes).toEqual([
      { label: 'S', isBase: false, isActive: false },
      { label: 'M', isBase: true, isActive: true },
    ]);
    expect(data.baseSizeLabel).toBe('M');
    expect(data.activeSizeLabel).toBe('M');
  });

  it('measures net and gross panel areas, holes deducted', () => {
    const { project } = sampleProject();
    const data = buildTechPackData(project, {});
    expect(data.panels).toHaveLength(3);
    const front = data.panels.find(panel => panel.name === '前片')!;
    expect(front.quantity).toBe(1);
    expect(front.netAreaM2).toBeCloseTo(0.24, 6);
    expect(front.grossAreaM2).toBeCloseTo(0.2604, 6);
    const pocket = data.panels.find(panel => panel.name === '口袋')!;
    expect(pocket.netAreaM2).toBeCloseTo(0.0434, 6);
    expect(pocket.grossAreaM2).toBeCloseTo(0.0434, 6);
  });

  it('lists material appearance and physics', () => {
    const { project } = sampleProject();
    const data = buildTechPackData(project, {});
    expect(data.fabrics).toHaveLength(1);
    const fabric = data.fabrics[0]!;
    expect(fabric.name).toBe('棉');
    expect(fabric.massPerArea).toBe(180);
    expect(fabric.stretchStiffness).toBe(0.9);
    expect(fabric.bendingStiffness).toBe(0.4);
    expect(fabric.shearStiffness).toBe(0.8);
    expect(fabric.damping).toBe(0.02);
    expect(fabric.baseColor).toMatch(/^#/);
  });

  it('describes both seam sides, allowance, length and gather state', () => {
    const { project } = sampleProject();
    const data = buildTechPackData(project, {});
    expect(data.seams).toHaveLength(1);
    const seam = data.seams[0]!;
    expect(seam.panelA).toBe('前片');
    expect(seam.panelB).toBe('袖片');
    expect(seam.edgeA).toBe('自由边');
    expect(seam.intervalA).toBe('20% – 80%');
    expect(seam.intervalB).toBe('0% – 100%');
    expect(seam.lengthCm).toBeCloseTo(36);
    expect(seam.typeLabel).toBe('缩缝');
    expect(seam.allowanceA).toBe(1);
    expect(seam.allowanceB).toBe(0);
    expect(seam.gather).toBe(true);
    expect(seam.gatherRatio).toBe(0.9);
  });

  it('lays out the default marker and prices it only when asked', () => {
    const { project } = sampleProject();
    const plain = buildTechPackData(project, {}).marker;
    expect(plain.laidOut).toBe(true);
    expect(plain.fabricWidthCm).toBe(150);
    expect(plain.shrinkPercent).toBe(0);
    expect(plain.gapCm).toBe(0.5);
    expect(plain.pieceCount).toBe(3);
    expect(plain.usedLengthM).toBeGreaterThan(0);
    expect(plain.utilization).toBeGreaterThan(0);
    expect(plain.cost).toBeNull();

    const priced = buildTechPackData(project, { pricePerMeter: 12.5 }).marker;
    expect(priced.cost).toBeCloseTo(priced.usedLengthM * 12.5);
  });

  it('keeps only dimension lines whose value can be computed', () => {
    const { project } = sampleProject();
    const data = buildTechPackData(project, {});
    expect(data.measurements).toHaveLength(3);
    expect(data.measurements.find(row => row.id === 'm_edge')?.value).toBeCloseTo(60);
    expect(data.measurements.find(row => row.id === 'm_edge')?.unit).toBe('cm');
    expect(data.measurements.find(row => row.id === 'm_dist')?.value).toBeCloseTo(40);
    expect(data.measurements.find(row => row.id === 'm_angle')?.unit).toBe('deg');
    expect(data.measurements.some(row => row.id === 'm_missing')).toBe(false);
  });

  it('lists prints, topstitches and trims and reuses them in the bill of materials', () => {
    const { project } = sampleProject();
    const data = buildTechPackData(project, {});
    expect(data.prints).toHaveLength(1);
    expect(data.prints[0]).toMatchObject({
      id: 'pr_logo', name: '徽标.png', panelName: '前片', widthCm: 8, heightCm: 6,
      angleDeg: 15, repeat: { x: 2, y: 1 }, opacity: 0.8,
    });
    expect(data.topstitches).toHaveLength(1);
    expect(data.topstitches[0]!.edge).toBe('自由边');
    expect(data.topstitches[0]!.lengthCm).toBeCloseTo(120, 6);
    expect(data.trims).toHaveLength(1);
    expect(data.trims[0]!.kindLabel).toBe('纽扣');
    expect(data.trims[0]!.quantity).toBe(5);
    expect(data.trims[0]!.unitPrice).toBe(0.8);

    expect(data.bom.map(row => row.category)).toEqual(['面料', '印花', '明线', '辅料']);
    expect(data.bom.find(row => row.category === '印花')!.quantity).toBe(2);
    expect(data.bom.find(row => row.category === '明线')!.quantity).toBeCloseTo(1.2, 6);
    expect(data.bom.find(row => row.category === '辅料')!.amount).toBe(4);
  });

  it('leaves the production tables empty when nothing was placed', () => {
    const project = createDefaultProject();
    const data = buildTechPackData(project, {});
    expect(data.prints).toEqual([]);
    expect(data.topstitches).toEqual([]);
    expect(data.trims).toEqual([]);
    expect(data.bom).toEqual([]);
  });

  it('reports an empty project without laying out a marker', () => {
    const project = createDefaultProject();
    const data = buildTechPackData(project, {});
    expect(data.panels).toEqual([]);
    expect(data.seams).toEqual([]);
    expect(data.measurements).toEqual([]);
    expect(data.sizes).toEqual([]);
    expect(data.baseSizeLabel).toBeNull();
    expect(data.fabrics).toHaveLength(1);
    expect(data.marker.laidOut).toBe(false);
    expect(data.marker.note).toBe('无可见版片，未排料');
  });

  it('leaves the seam list empty when the pattern has no seams', () => {
    const project = createDefaultProject();
    project.pattern = buildSamplePattern();
    expect(buildTechPackData(project, {}).seams).toEqual([]);
  });

  it('summarises the starter garment with its template seams', () => {
    const project = createStarterProject();
    const data = buildTechPackData(project, { date: '2026-02-03' });
    expect(data.panels.length).toBeGreaterThan(0);
    expect(data.seams.length).toBeGreaterThan(0);
    expect(data.fabrics.length).toBe(1);
    expect(data.marker.laidOut).toBe(true);
    expect(data.marker.pieceCount).toBe(data.panels.length);
  });
});

describe('buildTechPackPdf', () => {
  it('writes an A4 PDF with the CJK font and one page for a short sheet', () => {
    const { project } = sampleProject();
    const pdf = decode(buildTechPackPdf(project, { date: '2026-02-03' }));
    expectValidPdf(pdf);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/STSong-Light');
    expect(pdf).toContain('/F2');
    expect(pdf).toContain('/Count 1');
    const text = decodedText(pdf);
    for (const label of [
      '工艺单', '工程名', '尺码表', '版片', '材质', '缝合清单', '印花', '明线', '辅料', '物料清单',
      '排料摘要', '版片测量',
    ]) {
      expect(text).toContain(label);
    }
    expect(text).toContain('测试工程');
  });

  it('paginates when the panel table overflows one page', () => {
    const pattern = createEmptyPattern();
    for (let i = 0; i < 60; i++) {
      addSquare(pattern, `p${i}`, (i % 10) * 30, Math.floor(i / 10) * 30, 20);
    }
    const project = createDefaultProject('多片工程');
    project.pattern = pattern;
    const pdf = decode(buildTechPackPdf(project, { date: '2026-02-03' }));
    expectValidPdf(pdf);
    const count = /\/Count (\d+)/.exec(pdf);
    expect(count).not.toBeNull();
    expect(Number(count![1])).toBeGreaterThanOrEqual(2);
  });
});
