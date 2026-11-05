import { describe, expect, it } from 'vitest';
import {
  builtInFabricAssets, builtInTrimAssets, fabricAssetFrom, fabricAssetSummary, fabricFromAsset,
  trimAssetFrom,
} from '../../../src/core/model/assetLibrary';
import { createFabric, createDefaultProject, FABRIC_PRESET_KEYS } from '../../../src/core/model/defaults';

describe('built-in asset library', () => {
  it('lists one material card per fabric preset', () => {
    const assets = builtInFabricAssets();
    expect(assets.map(asset => asset.presetKey)).toEqual(FABRIC_PRESET_KEYS);
    expect(assets.every(asset => asset.source === 'preset')).toBe(true);
    expect(assets[0]!.id).toBe('preset:fabric:cotton');
  });

  it('lists one trim card per kind with the default size and colour', () => {
    const assets = builtInTrimAssets();
    expect(assets).toHaveLength(4);
    expect(assets.every(asset => asset.source === 'preset')).toBe(true);
    expect(assets[0]!.sizeMm).toBe(12);
  });

  it('summarises physics for the material card', () => {
    const cotton = builtInFabricAssets()[0]!;
    expect(fabricAssetSummary(cotton)).toContain('g/m²');
  });
});

describe('saved assets', () => {
  it('copies the source material instead of aliasing it', () => {
    const fabric = createFabric('silk', '我的丝绸');
    const asset = fabricAssetFrom(fabric);
    expect(asset.source).toBe('user');
    expect(asset.name).toBe('我的丝绸');
    expect(asset.id).not.toBe(fabric.id);
    asset.fabric.physics.stretchStiffness = 0.1;
    expect(fabric.physics.stretchStiffness).not.toBe(0.1);
  });

  it('clones an asset into the project with a unique name', () => {
    const project = createDefaultProject();
    const asset = fabricAssetFrom(Object.values(project.fabrics)[0]!, '棉');
    const cloned = fabricFromAsset(project, asset);
    expect(Object.keys(project.fabrics)).not.toContain(cloned.id);
    expect(cloned.name).toBe('棉 2');
  });

  it('stamps trim assets with an id, source and timestamp', () => {
    const asset = trimAssetFrom({ name: '大纽扣', kind: 'button', sizeMm: 18, color: '#222222', qty: 2 });
    expect(asset.id).toMatch(/^asset_/);
    expect(asset.source).toBe('user');
    expect(asset.createdAt).toBeTruthy();
  });
});
