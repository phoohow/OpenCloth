import { describe, it, expect } from 'vitest';
import type { SizeDef, Vec2 } from '../../../src/core/model/types';
import { writeMarkerDxf, writePatternDxf } from '../../../src/io/dxf/writer';
import { parsePatternDxf } from '../../../src/io/dxf/reader';
import { resolveSize } from '../../../src/core/command/gradingCommands';
import { buildSamplePattern, finePolygon, hausdorff, parsedOutline } from './samplePattern';
import { samplePanelOutline } from '../../../src/pattern/panel/panelBuilder';
import { validatePattern } from '../../../src/core/model/validatePattern';

describe('writePatternDxf 输出结构', () => {
  const pattern = buildSamplePattern();
  const dxf = writePatternDxf(pattern, { includeSeamAllowance: true });

  it('两次写出的文本完全一致（确定性）', () => {
    expect(dxf).toBe(writePatternDxf(pattern, { includeSeamAllowance: true }));
  });

  it('每个图层都出现，坐标按毫米写', () => {
    for (const layer of ['001-OUTLINE', '002-SEAMLNE', '029-FOLD', '031-GRAINLINE', '040-NOTCH', '070-TEXT']) {
      expect(dxf).toContain(layer);
    }
    // 前片底边 40 cm → 400 mm
    expect(dxf).toContain('400.0000');
  });

  it('闭合轮廓数量等于轮廓环加内孔环', () => {
    const loops = Object.values(pattern.panels).reduce(
      (n, panel) => n + 1 + (panel.holes ?? []).length, 0);
    expect((dxf.match(/70\n1\n/g) ?? []).length).toBe(loops + 1);
  });
});

describe('writePatternDxf → parsePatternDxf 往返', () => {
  const pattern = buildSamplePattern();

  it('写出可被读回且轮廓几何误差小于 0.01cm', () => {
    const dxf = writePatternDxf(pattern, { includeSeamAllowance: true });
    const parsed = parsePatternDxf(dxf);

    expect(validatePattern(parsed)).toEqual([]);
    const names = Object.values(parsed.panels).map(p => p.name);
    expect(names).toEqual(['前片', '袖片', '口袋']);

    for (const original of Object.values(pattern.panels)) {
      const copy = Object.values(parsed.panels).find(p => p.name === original.name)!;
      expect(copy).toBeDefined();
      expect(hausdorff(parsedOutline(parsed, copy.id), finePolygon(pattern, original.outlineEdgeIds)))
        .toBeLessThan(0.01);
    }
  });

  it('布纹线、刀眼、孔位、注释与缝份同步往返', () => {
    const parsed = parsePatternDxf(writePatternDxf(pattern, { includeSeamAllowance: true }));
    const front = Object.values(parsed.panels).find(p => p.name === '前片')!;
    const pocket = Object.values(parsed.panels).find(p => p.name === '口袋')!;

    expect(front.grainAngleDeg).toBeCloseTo(90, 1);
    expect(front.seamAllowanceCm).toBeCloseTo(1, 1);
    expect(pocket.holes!.length).toBe(1);
    expect(hausdorff(finePolygon(parsed, pocket.holes![0]), finePolygon(pattern, pattern.panels.pocket.holes![0])))
      .toBeLessThan(0.01);

    const texts = Object.values(parsed.annotations).map(a => a.text).sort();
    expect(texts).toEqual(['前片', '袖片']);
    expect(Object.keys(parsed.notches).length).toBe(2);
    expect(Object.values(parsed.notches).some(n => n.style === 'drill')).toBe(true);

    const fold = Object.values(parsed.internalLines).find(l => l.kind === 'fold');
    expect(fold).toBeDefined();
    expect(fold!.points[0].x).toBeCloseTo(5, 2);
  });

  it('布纹线位置与长度随 DXF 往返', () => {
    const styled = buildSamplePattern();
    styled.panels.front.grainAngleDeg = 60;
    styled.panels.front.grainOffset = { x: 3, y: -2 };
    styled.panels.front.grainLengthCm = 18;
    const parsed = parsePatternDxf(writePatternDxf(styled, { includeSeamAllowance: false }));
    const front = Object.values(parsed.panels).find(p => p.name === '前片')!;
    expect(front.grainAngleDeg).toBeCloseTo(60, 1);
    expect(front.grainOffset).toEqual({ x: 3, y: -2 });
    expect(front.grainLengthCm).toBeCloseTo(18, 1);
  });

  it('includeSeamAllowance=false 时不写缝份层', () => {
    const plain = writePatternDxf(pattern, { includeSeamAllowance: false });
    expect(plain).not.toContain('002-SEAMLNE');
    const parsed = parsePatternDxf(plain);
    expect(Object.values(parsed.panels).find(p => p.name === '前片')!.seamAllowanceCm).toBe(0);
  });

  it('ASTM 约定往返保持几何', () => {
    const dxf = writePatternDxf(pattern, { includeSeamAllowance: true, convention: 'ASTM' });
    expect(dxf).toContain('OUTLINE');
    const parsed = parsePatternDxf(dxf, { convention: 'ASTM' });
    const front = Object.values(parsed.panels).find(p => p.name === '前片')!;
    expect(hausdorff(parsedOutline(parsed, front.id), finePolygon(pattern, pattern.panels.front.outlineEdgeIds)))
      .toBeLessThan(0.01);
  });

  it('sizeLabels 以文字形式写入', () => {
    const dxf = writePatternDxf(pattern, { includeSeamAllowance: false, sizeLabels: ['M', 'L'] });
    expect(dxf).toContain('M');
    expect(dxf).toContain('L');
  });

  it('R12 结构完整：BLOCKS、ENTITIES、INSERT 与 EOF', () => {
    const dxf = writePatternDxf(pattern, { includeSeamAllowance: true });
    expect(dxf).toContain('SECTION\n2\nBLOCKS');
    expect(dxf).toContain('SECTION\n2\nENTITIES');
    expect(dxf).toMatch(/0\nINSERT\n8\n0\n2\n前片/);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('写出的轮廓为 Y 向上、厘米转毫米', () => {
    const dxf = writePatternDxf(pattern, { includeSeamAllowance: false });
    expect(dxf).toContain('400.0000');
    const parsed = parsePatternDxf(dxf);
    const front = Object.values(parsed.panels).find(p => p.name === '前片')!;
    const box = samplePanelOutline(parsed, front);
    expect(Math.max(...box.map(p => p.x))).toBeCloseTo(40, 6);
  });
});

describe('writePatternDxf 多码导出', () => {
  const chart: SizeDef[] = [
    { id: 's', label: 'S', seq: 1, isBase: true },
    { id: 'l', label: 'L', seq: 2 },
  ];

  /** Sample pattern with a 5% L grade written straight onto every point. */
  const gradedPattern = (): ReturnType<typeof buildSamplePattern> => {
    const pattern = buildSamplePattern();
    for (const point of Object.values(pattern.points)) {
      point.grading = { l: { x: point.pos.x * 0.05, y: point.pos.y * 0.05 } };
    }
    return pattern;
  };

  /** Drops the per-size layout offset so only the shape is compared. */
  const alignX = (pts: Vec2[]): Vec2[] => {
    const minX = Math.min(...pts.map(p => p.x));
    return pts.map(p => ({ x: p.x - minX, y: p.y }));
  };

  const sizeOf = (name: string): string => name.slice(name.lastIndexOf('-') + 1);

  const base = gradedPattern();
  const dxf = writePatternDxf(base, {
    includeSeamAllowance: true,
    sizes: { chart, gapCm: 12 },
  });
  const parsed = parsePatternDxf(dxf);

  it('每个尺码的每片都被读回', () => {
    const names = Object.values(parsed.panels).map(p => p.name).sort();
    expect(names).toEqual(['前片-L', '前片-S', '口袋-L', '口袋-S', '袖片-L', '袖片-S']);
    expect(validatePattern(parsed)).toEqual([]);
  });

  it('每个尺码的轮廓与放码结果误差小于 0.01cm', () => {
    for (const size of chart) {
      const resolved = resolveSize(base, undefined, size.id);
      for (const original of Object.values(resolved.panels)) {
        const copy = Object.values(parsed.panels).find(p => p.name === `${original.name}-${size.label}`)!;
        expect(copy).toBeDefined();
        expect(hausdorff(alignX(parsedOutline(parsed, copy.id)), alignX(finePolygon(resolved, original.outlineEdgeIds))))
          .toBeLessThan(0.01);
        const holes = copy.holes ?? [];
        expect(holes.length).toBe((original.holes ?? []).length);
        holes.forEach((loop, i) => {
          expect(hausdorff(alignX(finePolygon(parsed, loop)), alignX(finePolygon(resolved, original.holes![i]))))
            .toBeLessThan(0.01);
        });
      }
    }
  });

  it('尺码按 X 排列且互不重叠', () => {
    const ranges = new Map<string, { min: number; max: number }>();
    for (const panel of Object.values(parsed.panels)) {
      const xs = parsedOutline(parsed, panel.id).map(p => p.x);
      const range = ranges.get(sizeOf(panel.name)) ?? { min: Infinity, max: -Infinity };
      range.min = Math.min(range.min, Math.min(...xs));
      range.max = Math.max(range.max, Math.max(...xs));
      ranges.set(sizeOf(panel.name), range);
    }
    expect(ranges.get('S')!.max).toBeLessThan(ranges.get('L')!.min);
  });

  it('多码输出确定：两次写出文本一致', () => {
    expect(dxf).toBe(writePatternDxf(gradedPattern(), {
      includeSeamAllowance: true,
      sizes: { chart, gapCm: 12 },
    }));
  });
});

describe('writePatternDxf 编码选择', () => {
  const pattern = buildSamplePattern();

  it('ascii 码无 0x7F 以上字节且读回中文名', () => {
    const dxf = writePatternDxf(pattern, { includeSeamAllowance: true, encoding: 'ascii' });
    expect(/[^\x00-\x7F]/.test(dxf)).toBe(false);
    expect(Buffer.byteLength(dxf, 'utf8')).toBe(dxf.length);
    expect(dxf).toContain('\\U+524D\\U+7247');

    const parsed = parsePatternDxf(dxf);
    expect(Object.values(parsed.panels).map(p => p.name)).toEqual(['前片', '袖片', '口袋']);
    expect(Object.values(parsed.annotations).map(a => a.text).sort()).toEqual(['前片', '袖片']);
    const front = Object.values(parsed.panels).find(p => p.name === '前片')!;
    expect(hausdorff(parsedOutline(parsed, front.id), finePolygon(pattern, pattern.panels.front.outlineEdgeIds)))
      .toBeLessThan(0.01);
  });

  it('utf-8 码保留原始中文', () => {
    const dxf = writePatternDxf(pattern, { includeSeamAllowance: true, encoding: 'utf-8' });
    expect(dxf).toContain('前片');
    expect(dxf).not.toContain('\\U+');
    expect(dxf).toBe(writePatternDxf(pattern, { includeSeamAllowance: true }));
  });

  it('多码 ascii 仍按尺码归组', () => {
    const chart: SizeDef[] = [{ id: 'm', label: 'M', seq: 1 }];
    const dxf = writePatternDxf(pattern, { includeSeamAllowance: false, encoding: 'ascii', sizes: { chart } });
    expect(/[^\x00-\x7F]/.test(dxf)).toBe(false);
    expect(Object.values(parsePatternDxf(dxf).panels).map(p => p.name)).toEqual(['前片-M', '袖片-M', '口袋-M']);
  });

  it('唛架 ascii 同样转义版片名', () => {
    const dxf = writeMarkerDxf(pattern, { fabricWidthCm: 150, encoding: 'ascii' });
    expect(/[^\x00-\x7F]/.test(dxf)).toBe(false);
    const parsed = parsePatternDxf(dxf);
    expect(Object.keys(parsed.panels)).toHaveLength(3);
    expect(Object.values(parsed.annotations).map(a => a.text).sort()).toEqual(['前片', '口袋', '袖片']);
  });
});

describe('writeMarkerDxf 唛架', () => {
  const pattern = buildSamplePattern();

  it('门幅写入边界且各片落在幅宽内', () => {
    const dxf = writeMarkerDxf(pattern, { fabricWidthCm: 100, gapCm: 2 });
    expect(dxf).toContain('1000.0000');
    const parsed = parsePatternDxf(dxf);
    for (const panel of Object.values(parsed.panels)) {
      const outline = parsedOutline(parsed, panel.id);
      expect(Math.min(...outline.map(p => p.x))).toBeGreaterThanOrEqual(-1e-6);
      expect(Math.max(...outline.map(p => p.x))).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  it('每个版片一条闭合轮廓、布纹线与名称文字', () => {
    const dxf = writeMarkerDxf(pattern, { fabricWidthCm: 150 });
    expect(dxf).toContain('SECTION\n2\nENTITIES');
    expect((dxf.match(/70\n1\n/g) ?? []).length).toBe(Object.keys(pattern.panels).length + 1);
    for (const panel of Object.values(pattern.panels)) {
      expect(dxf).toContain(`1\n${panel.name}`);
    }
    expect(dxf).toContain('031-GRAINLINE');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('输出确定：两次写出文本一致', () => {
    const opts = { fabricWidthCm: 120, gapCm: 1, shrinkPercent: 3, allowRotate: true };
    expect(writeMarkerDxf(pattern, opts)).toBe(writeMarkerDxf(pattern, opts));
  });

  it('缩率放大每片，用料随之增加', () => {
    const plain = writeMarkerDxf(pattern, { fabricWidthCm: 150, allowRotate: false });
    const shrunk = writeMarkerDxf(pattern, { fabricWidthCm: 150, allowRotate: false, shrinkPercent: 20 });
    const lengthOf = (dxf: string): number =>
      Math.max(...(dxf.match(/\n20\n([0-9.]+)/g) ?? []).map(m => Number(m.slice(4))));
    expect(lengthOf(shrunk)).toBeGreaterThan(lengthOf(plain));
  });
});
