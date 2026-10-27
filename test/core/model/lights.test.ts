import { describe, expect, it } from 'vitest';
import {
  createDefaultLights, createLight, iblStrength, normalizeLightConfig, normalizeLights,
} from '../../../src/core/model/defaults';
import { vec3, type LegacyLightConfig, type SceneLight } from '../../../src/core/model/types';
import { projectCodec } from '../../../src/io/codec';
import { createDefaultProject } from '../../../src/core/model/defaults';

/** Directional lights saved in the pre-list shape. */
const LEGACY: LegacyLightConfig = {
  keyLight: { direction: vec3(2, 4, 3), intensity: 3, color: '#ffffff', castShadow: true },
  fillLight: { direction: vec3(-2, 2, -1), intensity: 1, color: '#cfe0ff' },
  iblIntensity: 0.8,
};

describe('normalizeLights', () => {
  it('migrates a legacy key and fill light into directional lights', () => {
    const lights = normalizeLights(LEGACY);
    expect(lights.map(l => l.name)).toEqual(['主光', '补光']);
    expect(lights.map(l => l.type)).toEqual(['directional', 'directional']);
    expect(lights[0].position).toEqual(vec3(2, 4, 3));
    expect(lights[0].target).toEqual(vec3(0, 0, 0));
    expect(lights[1].color).toBe('#cfe0ff');
    expect(lights.every(l => l.enabled)).toBe(true);
  });

  it('keeps a stored list and fills in what an older entry lacks', () => {
    const stored = [{ id: 'l1', name: '顶部', type: 'spot', intensity: 40 }] as unknown as SceneLight[];
    const lights = normalizeLights({ lights: stored, iblIntensity: 1 });
    expect(lights).toHaveLength(1);
    expect(lights[0].id).toBe('l1');
    expect(lights[0].coneAngleDeg).toBe(40);
    expect(lights[0].enabled).toBe(true);
  });

  it('clamps out-of-range values and drops unknown types', () => {
    const [light] = normalizeLights({
      lights: [{ id: 'l1', type: 'laser', intensity: 9000, coneAngleDeg: 400 } as unknown as SceneLight],
    });
    expect(light.type).toBe('directional');
    expect(light.intensity).toBe(500);
    expect(light.coneAngleDeg).toBe(178);
  });

  it('starts a fresh project with the two directional lights', () => {
    expect(normalizeLights(createDefaultProject().scene.lights).map(l => l.name))
      .toEqual(['主光', '补光']);
    expect(createDefaultLights()[0].position).toEqual(vec3(2, 4, 3));
    expect(createLight('area', 1).name).toBe('面积光 1');
  });
});

describe('iblStrength', () => {
  it('is zero while the environment light is off', () => {
    const lights = { ...createDefaultProject().scene.lights, iblIntensity: 1.4 };
    expect(iblStrength(lights)).toBe(1.4);
    expect(iblStrength({ ...lights, iblEnabled: false })).toBe(0);
    expect(iblStrength(LEGACY)).toBe(0.8);
  });
});

describe('normalizeLightConfig', () => {
  it('defaults the environment light to on and its strength to 1', () => {
    const config = normalizeLightConfig(LEGACY);
    expect(config.iblEnabled).toBe(true);
    expect(config.iblIntensity).toBe(0.8);
    expect(config.lights).toHaveLength(2);
  });
});

describe('projectCodec with lights', () => {
  it('migrates a file saved before the light list existed', () => {
    const project = createDefaultProject();
    const legacy = { ...project, scene: { ...project.scene, lights: LEGACY } };
    const decoded = projectCodec.decode(JSON.stringify(legacy));
    expect(decoded.scene.lights.lights.map(l => l.name)).toEqual(['主光', '补光']);
    expect(decoded.scene.lights.iblEnabled).toBe(true);
  });

  it('round-trips a light list', () => {
    const project = createDefaultProject();
    project.scene.lights.lights.push(createLight('point', 1));
    const decoded = projectCodec.decode(projectCodec.encode(project));
    expect(decoded.scene.lights.lights.map(l => l.type)).toEqual(['directional', 'directional', 'point']);
  });
});
