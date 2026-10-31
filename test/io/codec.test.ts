import { describe, it, expect } from 'vitest';
import { projectCodec } from '../../src/io/codec';
import { createDefaultProject, createFabric } from '../../src/core/model/defaults';
import { generateTShirt, DEFAULT_TSHIRT_PARAMS } from '../../src/pattern/template/tShirtTemplate';
import { samplePanelOutline } from '../../src/pattern/panel/panelBuilder';

describe('projectCodec 往返', () => {
  it('默认工程 encode→decode 深度相等', () => {
    const project = createDefaultProject('测试工程');
    const json = projectCodec.encode(project);
    const decoded = projectCodec.decode(json);
    expect(decoded).toEqual(project);
  });

  it('保留版型、面料、人体、场景全部字段', () => {
    const project = createDefaultProject();
    project.pattern = generateTShirt(DEFAULT_TSHIRT_PARAMS, Object.keys(project.fabrics)[0]);
    const decoded = projectCodec.decode(projectCodec.encode(project));

    expect(Object.keys(decoded.pattern.panels).length).toBeGreaterThan(0);
    expect(Object.keys(decoded.pattern.seams).length).toBeGreaterThan(0);
    expect(Object.keys(decoded.fabrics).length).toBe(1);
    expect(decoded.avatar.params.heightCm).toBe(170);
    expect(decoded.scene.simulation.gravity.y).toBeCloseTo(-9.8, 5);
  });

  it('encode 输出为可解析的 JSON 字符串', () => {
    const project = createDefaultProject();
    const json = projectCodec.encode(project);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain('"meta"');
  });

  it('缺少必要字段时抛出错误', () => {
    expect(() => projectCodec.decode(JSON.stringify({ meta: {} })))
      .toThrow(/无效的工程文件/);
  });

  it('decode 结果与原始对象不共享引用', () => {
    const project = createDefaultProject();
    const decoded = projectCodec.decode(projectCodec.encode(project));
    decoded.meta.name = '已修改';
    expect(project.meta.name).not.toBe('已修改');
  });
});

describe('旧工程补全', () => {
  it('decode 为缺少 maps / uvTiling / uvOffset 的面料补默认值', () => {
    const project = createDefaultProject();
    const fabricId = Object.keys(project.fabrics)[0];
    const raw = JSON.parse(projectCodec.encode(project));
    delete raw.fabrics[fabricId].appearance.maps;
    delete raw.fabrics[fabricId].appearance.uvTiling;
    delete raw.fabrics[fabricId].appearance.uvOffset;

    const decoded = projectCodec.decode(JSON.stringify(raw));
    const appearance = decoded.fabrics[fabricId].appearance;
    expect(appearance.maps).toEqual({});
    expect(appearance.uvTiling).toEqual({ x: 1, y: 1 });
    expect(appearance.uvOffset).toEqual({ x: 0, y: 0 });
  });
});

describe('generateTShirt 模板', () => {
  it('生成前后片与双袖共 4 个版型片', () => {
    const pattern = generateTShirt();
    expect(Object.keys(pattern.panels).length).toBe(4);
  });

  it('生成缝合关系', () => {
    const pattern = generateTShirt();
    expect(Object.keys(pattern.seams).length).toBeGreaterThan(0);
  });

  it('所有版型片引用的点与边均存在', () => {
    const pattern = generateTShirt();
    for (const panel of Object.values(pattern.panels)) {
      for (const edgeId of panel.outlineEdgeIds) {
        expect(pattern.edges[edgeId]).toBeDefined();
        const edge = pattern.edges[edgeId];
        expect(pattern.points[edge.startPointId]).toBeDefined();
        expect(pattern.points[edge.endPointId]).toBeDefined();
      }
    }
  });

  it('缝合边引用的边均存在', () => {
    const pattern = generateTShirt();
    for (const seam of Object.values(pattern.seams)) {
      expect(pattern.edges[seam.a.edgeId]).toBeDefined();
      expect(pattern.edges[seam.b.edgeId]).toBeDefined();
    }
  });
});

describe('createFabric 预设', () => {
  it('不同预设具有不同物理参数', () => {
    const cotton = createFabric('cotton');
    const silk = createFabric('silk');
    expect(cotton.presetKey).toBe('cotton');
    expect(silk.physics.massPerArea).not.toBe(cotton.physics.massPerArea);
  });

  it('每次生成唯一 id', () => {
    expect(createFabric('cotton').id).not.toBe(createFabric('cotton').id);
  });
});

describe('工程编辑后往返', () => {
  it('改缝份 → 保存 → 再打开，几何一致', () => {
    const first = createDefaultProject();
    first.pattern = generateTShirt(DEFAULT_TSHIRT_PARAMS, Object.keys(first.fabrics)[0]);
    first.pattern.panels[Object.keys(first.pattern.panels)[0]].seamAllowanceCm = 1.5;
    const second = projectCodec.decode(projectCodec.encode(first));

    const outlineOf = (p: typeof first.pattern, panelId: string) =>
      samplePanelOutline(p, p.panels[panelId]).map(v => [v.x.toFixed(6), v.y.toFixed(6)].join(','));
    for (const panelId of Object.keys(first.pattern.panels)) {
      expect(outlineOf(second.pattern, panelId)).toEqual(outlineOf(first.pattern, panelId));
    }
    expect(Object.keys(second.pattern.seams).sort())
      .toEqual(Object.keys(first.pattern.seams).sort());
    expect(second.pattern.panels[Object.keys(second.pattern.panels)[0]].seamAllowanceCm).toBe(1.5);
  });
});
