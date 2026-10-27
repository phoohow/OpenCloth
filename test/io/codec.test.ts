import { describe, it, expect } from 'vitest';
import { projectCodec } from '../../src/io/codec';
import { createDefaultProject, createFabric } from '../../src/core/model/defaults';
import { generateTShirt, DEFAULT_TSHIRT_PARAMS } from '../../src/pattern/template/tShirtTemplate';

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

    expect(decoded.meta.dataVersion).toBe(1);
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
    expect(() => projectCodec.decode(JSON.stringify({ meta: { dataVersion: 1 } })))
      .toThrow(/无效的工程文件/);
  });

  it('不支持的版本号抛出错误', () => {
    const bad = {
      meta: { dataVersion: 99 },
      pattern: {}, fabrics: {}, avatar: {}, scene: {},
    };
    expect(() => projectCodec.decode(JSON.stringify(bad))).toThrow(/不支持的工程版本/);
  });

  it('decode 结果与原始对象不共享引用', () => {
    const project = createDefaultProject();
    const decoded = projectCodec.decode(projectCodec.encode(project));
    decoded.meta.name = '已修改';
    expect(project.meta.name).not.toBe('已修改');
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
      expect(pattern.edges[seam.edgeAId]).toBeDefined();
      expect(pattern.edges[seam.edgeBId]).toBeDefined();
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
