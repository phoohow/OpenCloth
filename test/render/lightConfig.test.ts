import { describe, expect, it } from 'vitest';
import type * as THREE from 'three/webgpu';
import { createDefaultLights, createLight } from '../../src/core/model/defaults';
import type { LightConfig, RenderConfig } from '../../src/core/model/types';
import type { RendererContext } from '../../src/render/renderer/rendererContext';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const three = await import('three/webgpu');
const { applyLightConfig } = await import('../../src/render/renderer/rendererContext');

/** A render context bare enough for lighting, without a real GPU backend. */
function stubCtx(): RendererContext {
  return {
    scene: new three.Scene(),
    renderer: { toneMapping: 0 },
    disposed: false,
  } as unknown as RendererContext;
}

const baseRender: RenderConfig = {
  mode: 'shaded', toneMapping: 'aces',
};

/** The lights the pass left in the scene's light container. */
function lightsOf(ctx: RendererContext): THREE.Light[] {
  const group = ctx.scene.getObjectByName('sceneLights');
  return (group?.children ?? []).filter(child => (child as THREE.Light).isLight) as THREE.Light[];
}

function apply(ctx: RendererContext, lights: LightConfig, render: RenderConfig = baseRender): void {
  applyLightConfig(ctx, lights, render);
}

function config(lights: LightConfig['lights'], iblEnabled = true, iblIntensity = 1): LightConfig {
  return { lights, iblEnabled, iblIntensity };
}

describe('applyLightConfig', () => {
  it('builds one scene light per project light, plus the environment fill', () => {
    const ctx = stubCtx();
    apply(ctx, config(createDefaultLights()));
    const built = lightsOf(ctx);
    expect(built.map(l => l.type)).toEqual(['AmbientLight', 'DirectionalLight', 'DirectionalLight']);
    expect(built[1].name).toBe('主光');
  });

  it('maps each light type to its three.js light', () => {
    const ctx = stubCtx();
    apply(ctx, config([
      createLight('directional', 1), createLight('point', 1), createLight('spot', 1),
    ]));
    expect(lightsOf(ctx).map(l => l.type).slice(1)).toEqual(['DirectionalLight', 'PointLight', 'SpotLight']);
  });

  it('keeps a disabled light in the scene but invisible', () => {
    const ctx = stubCtx();
    const lights = createDefaultLights().map((l, i) => ({ ...l, enabled: i === 0 }));
    apply(ctx, config(lights));
    const built = lightsOf(ctx).filter(l => l.type === 'DirectionalLight');
    expect(built.map(l => l.visible)).toEqual([true, false]);
  });

  it('rebuilds from scratch on every apply instead of stacking lights', () => {
    const ctx = stubCtx();
    apply(ctx, config(createDefaultLights()));
    apply(ctx, config([createLight('point', 1)]));
    expect(lightsOf(ctx).map(l => l.type)).toEqual(['AmbientLight', 'PointLight']);
  });

  it('applies position and target so aim edits reach the renderer', () => {
    const ctx = stubCtx();
    const light = { ...createLight('spot', 1), position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 1, z: 0 } };
    apply(ctx, config([light]));
    const spot = lightsOf(ctx).find(l => l.type === 'SpotLight') as THREE.SpotLight;
    expect(spot.position.toArray()).toEqual([1, 2, 3]);
    expect(spot.target.position.toArray()).toEqual([0, 1, 0]);
    expect(ctx.scene.getObjectByName('sceneLights')?.children).toContain(spot.target);
  });

  it('scales the environment contribution with the environment light', () => {
    const ctx = stubCtx();
    apply(ctx, config(createDefaultLights(), true, 2));
    expect(ctx.scene.environmentIntensity).toBe(2);
    expect((lightsOf(ctx)[0] as THREE.AmbientLight).intensity).toBeCloseTo(0.3, 5);
    apply(ctx, config(createDefaultLights(), false, 2));
    expect(ctx.scene.environmentIntensity).toBe(0);
    expect((lightsOf(ctx)[0] as THREE.AmbientLight).intensity).toBe(0);
  });

  it('writes the project tone mapping onto the renderer', () => {
    const ctx = stubCtx();
    apply(ctx, config(createDefaultLights()), { ...baseRender, toneMapping: 'linear' });
    expect(ctx.renderer.toneMapping).toBe(three.LinearToneMapping);
    apply(ctx, config(createDefaultLights()), { ...baseRender, toneMapping: 'none' });
    expect(ctx.renderer.toneMapping).toBe(three.NoToneMapping);
  });

  it('migrates a legacy key and fill config into two directional lights', () => {
    const ctx = stubCtx();
    const legacy = {
      keyLight: { direction: { x: 2, y: 4, z: 3 }, intensity: 3, color: '#ffffff', castShadow: true },
      fillLight: { direction: { x: -2, y: 2, z: -1 }, intensity: 1, color: '#cfe0ff' },
      iblIntensity: 1,
    } as unknown as LightConfig;
    apply(ctx, legacy);
    expect(lightsOf(ctx).map(l => l.name)).toEqual(['环境补光', '主光', '补光']);
  });
});
