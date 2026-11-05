import * as THREE from 'three/webgpu';
import type { LightConfig, RenderConfig, SceneLight } from '@/model/types';
import { iblStrength, normalizeLights } from '@/model';
import type { ViewportSurface } from '@/render/renderer/viewportSurface';

/** Inverse-square falloff for the punctual lights that have one. */
const PUNCTUAL_DECAY = 2;

/** Name of the scene container holding every project light. */
const LIGHT_GROUP_NAME = 'sceneLights';

/** Rebuilds the scene's lights and tone mapping from the project's lighting and render settings. */
export class LightRig {
  /** Whether the LTC textures a rect area light needs have been installed. */
  private areaLightSupported = false;
  private areaLoading: Promise<void> | null = null;
  /** Settings the scene lights were last built from, kept for the deferred area-light support. */
  private lightConfig?: LightConfig;
  /** Settings the tone mapping was last built from. */
  private renderConfig?: RenderConfig;

  constructor(
    private readonly surface: ViewportSurface,
    /** Tells the path tracer that lights or the environment changed. */
    private readonly invalidate: () => void,
  ) { }

  apply(cfg: LightConfig, renderCfg: RenderConfig): void {
    const { scene, renderer } = this.surface;
    this.lightConfig = cfg;
    this.renderConfig = renderCfg;
    const group = ensureLightGroup(scene);
    clearGroup(group);

    // Lifts the areas the environment image cannot reach.
    const ambient = new THREE.AmbientLight(0xffffff, iblStrength(cfg) * 0.15);
    ambient.name = '环境补光';
    group.add(ambient);

    scene.environmentIntensity = iblStrength(cfg);

    const lights = normalizeLights(cfg);
    for (const light of lights) {
      const object = this.lightToObject(light);
      if (!object) continue;
      object.name = light.name;
      object.visible = light.enabled;
      group.add(object);
      const target = (object as THREE.SpotLight).target;
      if (target) group.add(target);
    }
    if (lights.some(light => light.type === 'area') && !this.areaLightSupported && !this.areaLoading) {
      this.areaLoading = this.installAreaLightSupport().finally(() => { this.areaLoading = null; });
    }

    switch (renderCfg.toneMapping) {
      case 'aces': renderer.toneMapping = THREE.ACESFilmicToneMapping; break;
      case 'reinhard': renderer.toneMapping = THREE.ReinhardToneMapping; break;
      case 'linear': renderer.toneMapping = THREE.LinearToneMapping; break;
      default: renderer.toneMapping = THREE.NoToneMapping;
    }
    this.invalidate();
  }

  /** The three.js light matching one project light; null while area lights are unsupported. */
  private lightToObject(light: SceneLight): THREE.Light | null {
    const color = new THREE.Color(light.color);
    const position = new THREE.Vector3(light.position.x, light.position.y, light.position.z);
    const target = new THREE.Vector3(light.target.x, light.target.y, light.target.z);

    switch (light.type) {
      case 'directional': {
        const object = new THREE.DirectionalLight(color, light.intensity);
        object.position.copy(position);
        object.target.position.copy(target);
        return object;
      }
      case 'point': {
        const object = new THREE.PointLight(color, light.intensity, light.distance, PUNCTUAL_DECAY);
        object.position.copy(position);
        return object;
      }
      case 'spot': {
        const object = new THREE.SpotLight(
          color, light.intensity, light.distance, light.coneAngleDeg * Math.PI / 180, light.penumbra, PUNCTUAL_DECAY,
        );
        object.position.copy(position);
        object.target.position.copy(target);
        return object;
      }
      case 'area': {
        if (!this.areaLightSupported) return null;
        const object = new THREE.RectAreaLight(color, light.intensity, light.width, light.height);
        object.position.copy(position);
        object.lookAt(target);
        return object;
      }
      default:
        return null;
    }
  }

  /** Loads the LTC textures a rect area light needs, then rebuilds the scene lights with them. */
  private async installAreaLightSupport(): Promise<void> {
    try {
      const { RectAreaLightTexturesLib } = await import('three/examples/jsm/lights/RectAreaLightTexturesLib.js');
      (THREE as unknown as { RectAreaLightNode: { setLTC(lib: unknown): void } })
        .RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
      this.areaLightSupported = true;
      const cfg = this.lightConfig;
      const renderCfg = this.renderConfig;
      if (!this.surface.disposed && cfg && renderCfg) this.apply(cfg, renderCfg);
    } catch (error) {
      console.warn('Rect area light support unavailable:', error);
    }
  }
}

/** The scene's light container, created on first use. */
function ensureLightGroup(scene: THREE.Scene): THREE.Group {
  const existing = scene.getObjectByName(LIGHT_GROUP_NAME);
  if (existing instanceof THREE.Group) return existing;
  const group = new THREE.Group();
  group.name = LIGHT_GROUP_NAME;
  scene.add(group);
  return group;
}

/** Removes every child of the light container and frees its resources. */
function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    (child as THREE.Light).dispose?.();
  }
}
