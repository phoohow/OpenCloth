import { describe, it, expect } from 'vitest';
import { buildRegistry } from '../../../src/core/build/buildRegistry';
import { buildPanelMesh, samplePanelOutline } from '../../../src/pattern/panel/panelBuilder';
import { DEFAULT_TSHIRT_PARAMS, generateTShirt } from '../../../src/pattern/template/tShirtTemplate';
import type { Panel, Pattern } from '../../../src/core/model/types';

const frontPanel = (pattern: Pattern): Panel =>
  Object.values(pattern.panels).find(p => p.name === '前片')!;

describe('BuildRegistry 共享网格缓存', () => {
  const pattern = generateTShirt(DEFAULT_TSHIRT_PARAMS);
  const panel = frontPanel(pattern);
  const simulation = { meshResolutionCm: 1.5, meshSampling: 'lattice' as const };

  it('输入不变时命中缓存，返回同一份网格', () => {
    const first = buildRegistry.meshOf(pattern, panel.id, undefined, simulation);
    const again = buildRegistry.meshOf(pattern, panel.id, undefined, simulation);
    expect(first).not.toBeNull();
    expect(again).toBe(first);
  });

  it('引擎不传边长与 2D 传片字段值得到同一份实例', () => {
    const fromEngine = buildRegistry.meshOf(pattern, panel.id, undefined, simulation);
    const from2D = buildRegistry.meshOf(pattern, panel.id, panel.meshResolutionCm, simulation);
    expect(from2D).toBe(fromEngine);
  });

  it('网格边长变化时重建，与直接构建一致', () => {
    const coarse = buildRegistry.meshOf(pattern, panel.id, 2.5, simulation)!;
    const finer = buildRegistry.meshOf(pattern, panel.id, 1, simulation)!;
    expect(finer).not.toBe(coarse);
    expect(finer.vertexCount).toBeGreaterThan(coarse.vertexCount);
    const direct = buildPanelMesh(pattern, panel.id, 1, 'lattice')!;
    expect(direct.vertexCount).toBe(finer.vertexCount);
    expect(Array.from(direct.indices)).toEqual(Array.from(finer.indices));
  });

  it('生成方式变化时重建', () => {
    const lattice = buildRegistry.meshOf(pattern, panel.id, undefined, simulation)!;
    const blueNoise = buildRegistry.meshOf(pattern, panel.id, undefined, { ...simulation, meshSampling: 'blueNoise' })!;
    expect(blueNoise).not.toBe(lattice);
    expect(Array.from(blueNoise.indices)).not.toEqual(Array.from(lattice.indices));
  });

  it('缝份变化时重建', () => {
    const before = buildRegistry.meshOf(pattern, panel.id, undefined, simulation)!;
    const wider: Pattern = {
      ...pattern,
      panels: { ...pattern.panels, [panel.id]: { ...panel, seamAllowanceCm: panel.seamAllowanceCm + 1 } },
    };
    const after = buildRegistry.meshOf(wider, panel.id, undefined, simulation)!;
    expect(after).not.toBe(before);
    expect(Array.from(after.positions2D)).not.toEqual(Array.from(before.positions2D));
  });

  it('轮廓采样点全部进入网格边界', () => {
    const outline = samplePanelOutline(pattern, panel);
    const mesh = buildRegistry.meshOf(pattern, panel.id, undefined, simulation)!;
    expect(mesh!.vertexCount).toBeGreaterThan(outline.length);
  });
});
