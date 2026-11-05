import { describe, expect, it } from 'vitest';
import type { Pattern, Project } from '@/model/types';
import { createDefaultProject, createEmptyPattern, createFabric } from '@/model/defaults';
import { bomCsv, bomQuantityText, bomTotals, buildBom, panelAreas } from '@/pattern/bom';
import { addSquare } from '../core/command/fixtures';

/** Project with one 10 × 10 cm square on fabric `f`. */
function squareProject(name = '物料工程'): { project: Project; pattern: Pattern; panelId: string; edgeId: string } {
  const pattern = createEmptyPattern();
  const panelId = addSquare(pattern, 'sq', 0, 0, 10);
  const project = createDefaultProject(name);
  project.pattern = pattern;
  const fabric = createFabric('cotton', '棉布');
  fabric.id = 'f';
  project.fabrics = { f: fabric };
  return { project, pattern, panelId, edgeId: pattern.panels[panelId].outlineEdgeIds[0]! };
}

/** Adds one print, one topstitch and one trim to the square. */
function addProduction(pattern: Pattern, panelId: string, edgeId: string): void {
  pattern.prints['pr1'] = {
    id: 'pr1', panelId, imageUrl: 'data:image/png;base64,AAAA', imageName: 'logo.png',
    center: { x: 0, y: 0 }, widthCm: 10, heightCm: 10, angleDeg: 0, opacity: 1,
    repeat: { x: 2, y: 1 }, visible: true,
  };
  pattern.topstitches['ts1'] = {
    id: 'ts1', panelId, edgeId, t0: 0.2, t1: 0.8, offsetMm: 3, spacingMm: 4, rows: 2,
    color: '#d9a441', stitchMm: 3, gapMm: 2, visible: true,
  };
  pattern.trims['tr1'] = {
    id: 'tr1', panelId, kind: 'button', pos: { x: 5, y: 5 }, sizeMm: 10,
    color: '#b08d57', qty: 4, unitPrice: 2.5, visible: true,
  };
}

describe('panelAreas', () => {
  it('returns the net area of the outline', () => {
    const { pattern, panelId } = squareProject();
    const panel = pattern.panels[panelId]!;
    expect(panelAreas(pattern, panel).netAreaM2).toBeCloseTo(0.01, 8);
  });
});

describe('buildBom', () => {
  it('collates fabric, print, topstitch and trim rows from visible records', () => {
    const { project, pattern, panelId, edgeId } = squareProject();
    addProduction(pattern, panelId, edgeId);
    const rows = buildBom(project);

    expect(rows).toHaveLength(4);
    const fabric = rows.find(row => row.category === '面料')!;
    expect(fabric.name).toBe('棉布');
    expect(fabric.unit).toBe('m²');
    expect(fabric.quantity).toBe(0.01);
    expect(fabric.unitPrice).toBeNull();

    const print = rows.find(row => row.category === '印花')!;
    expect(print.name).toBe('logo.png');
    expect(print.unit).toBe('张');
    expect(print.quantity).toBe(2);
    expect(print.note).toBe('sq');
    expect(print.spec).toContain('平铺 2×1');

    const stitch = rows.find(row => row.category === '明线')!;
    expect(stitch.unit).toBe('米');
    expect(stitch.quantity).toBe(0.12);

    const trim = rows.find(row => row.category === '辅料')!;
    expect(trim.unit).toBe('个');
    expect(trim.quantity).toBe(4);
    expect(trim.unitPrice).toBe(2.5);
    expect(trim.amount).toBe(10);
  });

  it('leaves hidden panels, hidden records and empty topstitches out', () => {
    const { project, pattern, panelId, edgeId } = squareProject();
    addProduction(pattern, panelId, edgeId);
    pattern.panels[panelId].visible = false;
    expect(buildBom(project)).toEqual([]);

    pattern.panels[panelId].visible = true;
    pattern.prints['pr1']!.visible = false;
    pattern.topstitches['ts1']!.visible = false;
    pattern.trims['tr1']!.visible = false;
    expect(buildBom(project).map(row => row.category)).toEqual(['面料']);
  });

  it('skips a topstitch whose edge no longer exists', () => {
    const { project, pattern, panelId, edgeId } = squareProject();
    addProduction(pattern, panelId, edgeId);
    delete pattern.edges[edgeId];
    const rows = buildBom(project);
    expect(rows.some(row => row.category === '明线')).toBe(false);
  });

  it('groups panel areas by fabric', () => {
    const { project, pattern } = squareProject();
    addSquare(pattern, 'sq2', 20, 0, 10);
    const rows = buildBom(project);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe(0.02);
  });
});

describe('bomTotals', () => {
  it('sums priced rows and counts them', () => {
    const { project, pattern, panelId, edgeId } = squareProject();
    addProduction(pattern, panelId, edgeId);
    const totals = bomTotals(buildBom(project));
    expect(totals.amount).toBe(10);
    expect(totals.pricedRows).toBe(1);
  });

  it('reports no priced rows when nothing has a unit price', () => {
    const { project } = squareProject();
    expect(bomTotals(buildBom(project))).toEqual({ amount: 0, pricedRows: 0 });
  });
});

describe('bomCsv', () => {
  it('writes a UTF-8 BOM, the fixed header and every row', () => {
    const { project, pattern, panelId, edgeId } = squareProject();
    addProduction(pattern, panelId, edgeId);
    const csv = bomCsv(buildBom(project));
    expect(csv.startsWith('\ufeff')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('类别,名称,规格,单位,数量,单价,金额,备注');
    expect(lines).toHaveLength(5);
    expect(lines.some(line => line.startsWith('辅料,纽扣,纽扣，直径'))).toBe(true);
    expect(lines.some(line => line.endsWith(',10.00,sq'))).toBe(true);
  });

  it('keeps unpriced amounts empty', () => {
    const { project } = squareProject();
    const csv = bomCsv(buildBom(project));
    const fabricLine = csv.split('\r\n')[1]!;
    expect(fabricLine).toBe('面料,棉布,面密度 180 g/m²,m²,0.01,,,');
  });

  it('quotes cells holding a comma or a quote', () => {
    const rows = [{
      category: '辅料' as const, name: 'A, B', spec: 'say "hi"', unit: '个' as const,
      quantity: 1, unitPrice: 2, amount: 2, note: '',
    }];
    const line = bomCsv(rows).split('\r\n')[1]!;
    expect(line).toContain('"A, B"');
    expect(line).toContain('"say ""hi"""');
  });
});

describe('bomQuantityText', () => {
  it('keeps integers whole and rounds fractions to two decimals', () => {
    expect(bomQuantityText(4)).toBe('4');
    expect(bomQuantityText(0.12)).toBe('0.12');
    expect(bomQuantityText(0.016)).toBe('0.02');
  });
});
