import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedMaterial } from '@/render/common';
import { MaterialCompiler } from '@/render/backend/scene/materialCompiler';
import type { TextureCache } from '@/render/backend/textures';

/** Surface variant of one world material at a revision. */
function surface(id: number, revision: number, albedo?: string): ResolvedMaterial {
  return {
    technique: 'surface',
    data: { kind: 'surface', color: '#ffffff', maps: albedo ? { albedo } : undefined },
    source: { kind: 'material', id },
    revision,
  };
}

/** Minimal texture cache standing in for the GPU one. */
function cache(version: number, texture: THREE.Texture | null = null): TextureCache {
  return { version, get: () => texture } as unknown as TextureCache;
}

describe('MaterialCompiler', () => {
  it('reuses the material of an unchanged revision and evicts the old one on a new revision', () => {
    const compiler = new MaterialCompiler();
    const first = compiler.get(surface(1, 1), cache(0));
    const dispose = vi.spyOn(first, 'dispose');

    expect(compiler.get(surface(1, 1), cache(0))).toBe(first);
    const next = compiler.get(surface(1, 2), cache(0));
    expect(next).not.toBe(first);
    expect(dispose).toHaveBeenCalledTimes(1);

    compiler.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps materials of different sources apart at equal revisions', () => {
    const compiler = new MaterialCompiler();
    expect(compiler.get(surface(1, 1), cache(0))).not.toBe(compiler.get(surface(2, 1), cache(0)));
    compiler.dispose();
  });

  it('keys view-generated variants by content', () => {
    const compiler = new MaterialCompiler();
    const wire = (color: string): ResolvedMaterial => ({
      technique: 'wire',
      data: { kind: 'wire', color },
      source: { kind: 'material', id: -1 },
    });
    const first = compiler.get(wire('#66ccff'), cache(0));
    expect(compiler.get(wire('#66ccff'), cache(0))).toBe(first);
    expect(compiler.get(wire('#ff0000'), cache(0))).not.toBe(first);
    compiler.dispose();
  });

  it('invalidates only texture-bound materials when the texture version changes', () => {
    const compiler = new MaterialCompiler();
    const plain = surface(1, 1);
    const textured = surface(2, 1, 'fabric');
    const first = compiler.get(plain, cache(0, new THREE.Texture()));
    const bound = compiler.get(textured, cache(0, new THREE.Texture()));
    const dispose = vi.spyOn(bound, 'dispose');

    const nextTexture = new THREE.Texture();
    expect(compiler.get(plain, cache(1, nextTexture))).toBe(first);
    const rebuilt = compiler.get(textured, cache(1, nextTexture));
    expect(rebuilt).not.toBe(bound);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect((rebuilt as THREE.MeshPhysicalMaterial).map).toBe(nextTexture);

    compiler.dispose();
  });
});