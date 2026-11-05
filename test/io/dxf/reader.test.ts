import { describe, it, expect } from 'vitest';
import { parsePatternDxf } from '@/io/dxf/reader';
import { samplePanelOutline } from '@/pattern/panel/panelBuilder';

const rows = (items: (string | number)[][]): string => items.map(r => r.join('\n')).join('\n');

/** Closed LWPOLYLINE pair lines in drawing units. */
function loop(layer: string, pts: [number, number][], closed = true): (string | number)[][] {
  const flat: (string | number)[] = ['0', 'LWPOLYLINE', '8', layer, '70', closed ? '1' : '0'];
  for (const [x, y] of pts) flat.push('10', x, '20', y);
  return [[...flat]];
}

function line(layer: string, ax: number, ay: number, bx: number, by: number): (string | number)[] {
  return ['0', 'LINE', '8', layer, '10', ax, '20', ay, '11', bx, '21', by];
}

function text(layer: string, x: number, y: number, height: number, value: string): (string | number)[] {
  return ['0', 'TEXT', '8', layer, '10', x, '20', y, '40', height, '1', value];
}

function block(name: string, entityRows: (string | number)[][]): string {
  return rows([['0', 'SECTION', '2', 'BLOCKS'], ['0', 'BLOCK', '8', '0', '2', name], ...entityRows, ['0', 'ENDBLK'], ['0', 'ENDSEC']]);
}

function rootOnly(entityRows: (string | number)[][]): string {
  return rows([['0', 'SECTION', '2', 'ENTITIES'], ...entityRows, ['0', 'ENDSEC'], ['0', 'EOF']]);
}

const RECT: [number, number][] = [[0, 0], [400, 0], [400, 600], [0, 600]];

describe('parsePatternDxf', () => {
  it('毫米单位的闭合轮廓转为版片并换算为厘米', () => {
    const pattern = parsePatternDxf(block('前片', [...loop('001-OUTLINE', RECT)]));
    const panel = Object.values(pattern.panels)[0];
    expect(panel.name).toBe('前片');
    expect(panel.outlineEdgeIds.length).toBe(4);
    const outline = samplePanelOutline(pattern, panel);
    expect(Math.max(...outline.map(p => p.x))).toBeCloseTo(40, 6);
    expect(Math.max(...outline.map(p => p.y))).toBeCloseTo(60, 6);
    expect(Object.values(pattern.edges).every(e => e.type === 'line')).toBe(true);
  });

  it('cm 与 inch 单位换算', () => {
    const inCm = parsePatternDxf(block('P', [...loop('001-OUTLINE', RECT)]), { units: 'cm' });
    expect(Math.max(...Object.values(inCm.points).map(p => p.pos.x))).toBeCloseTo(400, 6);
    const inInch = parsePatternDxf(block('P', [...loop('001-OUTLINE', [[0, 0], [40, 0], [40, 60], [0, 60]])]), { units: 'inch' });
    expect(Math.max(...Object.values(inInch.points).map(p => p.pos.x))).toBeCloseTo(101.6, 4);
  });

  it('bulge 弧段离散化后偏离弦线', () => {
    const src = rows([
      ['0', 'SECTION', '2', 'BLOCKS'], ['0', 'BLOCK', '8', '0', '2', '弧形片'],
      ['0', 'LWPOLYLINE', '8', '001-OUTLINE', '70', '1',
        '10', 0, '20', 0, '42', 1,
        '10', 200, '20', 0,
        '10', 200, '20', 200, '10', 0, '20', 200],
      ['0', 'ENDBLK'], ['0', 'ENDSEC'],
    ]);
    const pattern = parsePatternDxf(src);
    const panel = Object.values(pattern.panels)[0];
    const outline = samplePanelOutline(pattern, panel);
    expect(outline.some(p => p.y < -1)).toBe(true);
  });

  it('离散 LINE/ARC 实体焊接为闭合轮廓', () => {
    const src = rows([
      ['0', 'SECTION', '2', 'BLOCKS'], ['0', 'BLOCK', '8', '0', '2', '焊接片'],
      line('001-OUTLINE', 0, 0, 100, 0),
      ['0', 'ARC', '8', '001-OUTLINE', '10', 50, '20', 0, '40', 50, '50', 0, '51', 180],
      ['0', 'ENDBLK'], ['0', 'ENDSEC'],
    ]);
    const pattern = parsePatternDxf(src);
    const panel = Object.values(pattern.panels)[0];
    expect(panel).toBeDefined();
    expect(panel.outlineEdgeIds.length).toBeGreaterThan(4);
  });

  it('内部线、省道、布纹线、刀眼、文字各归其位', () => {
    const pattern = parsePatternDxf(block('前片', [
      ...loop('001-OUTLINE', RECT),
      ...loop('028-INTERNAL', [[50, 50], [350, 50]], false),
      ...loop('018-DART', [[100, 300], [200, 380], [300, 300]], false),
      line('031-GRAINLINE', 200, 100, 200, 500),
      line('040-NOTCH', 200, 30, 200, -20),
      ['0', 'CIRCLE', '8', '042-DRILL', '10', 100, '20', 20, '40', 1.5],
      text('070-TEXT', 200, 300, 10, '前片'),
    ]));
    const panel = Object.values(pattern.panels)[0];

    const decor = Object.values(pattern.internalLines).find(l => l.kind === 'decor');
    expect(decor).toBeDefined();
    expect(decor!.points[0].x).toBeCloseTo(5, 6);
    const split = Object.values(pattern.internalLines).find(l => l.kind === 'split');
    expect(split).toBeDefined();
    expect(panel.internalLineIds.length).toBe(2);

    expect(panel.grainAngleDeg).toBeCloseTo(90, 6);
    expect(panel.grainLengthCm).toBeCloseTo(40, 6);
    expect(panel.grainOffset).toBeUndefined();

    const notch = Object.values(pattern.notches).find(n => n.style === 'v');
    expect(notch).toBeDefined();
    expect(notch!.t).toBeCloseTo(0.5, 2);
    expect(panel.outlineEdgeIds).toContain(notch!.edgeId);
    const drill = Object.values(pattern.notches).find(n => n.style === 'drill');
    expect(drill!.widthMm).toBeCloseTo(3, 6);

    const annotation = Object.values(pattern.annotations)[0];
    expect(annotation.text).toBe('前片');
    expect(annotation.sizeMm).toBe(10);
    expect(annotation.pos.x).toBeCloseTo(20, 6);
    expect(annotation.panelId).toBe(panel.id);
  });

  it('套内轮廓转为版片洞', () => {
    const pattern = parsePatternDxf(block('口袋', [
      ...loop('001-OUTLINE', RECT),
      ...loop('001-OUTLINE', [[100, 100], [200, 100], [200, 200], [100, 200]]),
    ]));
    const panel = Object.values(pattern.panels)[0];
    expect(panel.holes!.length).toBe(1);
    expect(panel.holes![0].length).toBe(4);
  });

  it('缝份线环估算 seamAllowanceCm', () => {
    const pattern = parsePatternDxf(block('前片', [
      ...loop('001-OUTLINE', RECT),
      ...loop('002-SEAMLNE', [[-50, -50], [450, -50], [450, 650], [-50, 650]]),
    ]));
    const panel = Object.values(pattern.panels)[0];
    expect(panel.seamAllowanceCm).toBeCloseTo(5, 2);
    expect(panel.outlineEdgeIds.length).toBe(4);
  });

  it('根层实体也生成版片，多个块各自成片', () => {
    const twoBlocks = rows([
      ['0', 'SECTION', '2', 'BLOCKS'],
      ['0', 'BLOCK', '8', '0', '2', '左片'], ...loop('001-OUTLINE', RECT), ['0', 'ENDBLK'],
      ['0', 'BLOCK', '8', '0', '2', '右片'],
      ...loop('001-OUTLINE', [[0, 0], [100, 0], [100, 100], [0, 100]]), ['0', 'ENDBLK'],
      ['0', 'ENDSEC'],
    ]);
    const pattern = parsePatternDxf(twoBlocks);
    expect(Object.values(pattern.panels).map(p => p.name)).toEqual(['左片', '右片']);

    const root = parsePatternDxf(rootOnly([...loop('001-OUTLINE', RECT), line('0', 0, 0, 1, 1)]));
    expect(Object.values(root.panels)[0].name).toMatch(/版片/);
  });

  it('布纹线的偏移与长度从线的中点和长度解析', () => {
    const pattern = parsePatternDxf(block('前片', [
      ...loop('001-OUTLINE', RECT),
      line('031-GRAINLINE', 260, 200, 260, 400),
    ]));
    const panel = Object.values(pattern.panels)[0];
    expect(panel.grainAngleDeg).toBeCloseTo(90, 6);
    expect(panel.grainOffset).toEqual({ x: 6, y: 0 });
    expect(panel.grainLengthCm).toBeCloseTo(20, 6);
  });

  it('ASTM 层名约定同样可解析', () => {
    const pattern = parsePatternDxf(block('P', [
      ...loop('OUTLINE', RECT),
      line('GRAIN-LINE', 200, 100, 200, 500),
    ]), { convention: 'ASTM' });
    expect(Object.values(pattern.panels)[0].grainAngleDeg).toBeCloseTo(90, 6);
  });

  it('无有效轮廓时抛出中文错误', () => {
    expect(() => parsePatternDxf(rootOnly([line('99-UNKNOWN', 0, 0, 1, 1)])))
      .toThrow(/未找到有效的版片轮廓/);
    expect(() => parsePatternDxf('')).toThrow(/未找到有效的版片轮廓/);
  });
});
