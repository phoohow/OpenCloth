/** Environment image and punctual lights, written through the texture and world ports. */

import { getModelBlob } from '@/io/storage';
import { iblStrength, normalizeLights, type LightConfig, type SceneLight } from '@/model';
import type { LightDesc, LightPatch } from '@/render/world';
import type { PresenterHost } from '@/runtime/presenters/host';

/** Bundled equirectangular environment used when the project selects none. */
export const BUNDLED_ENVIRONMENT_URL = '/env/royal_esplanade_1k.hdr';

/** Flat backdrop while no environment image is loaded. */
const FALLBACK_BACKGROUND = '#2a2a2e';

/** Texture key the environment image is registered under. */
const ENV_TEXTURE_KEY = 'environment';

/** Which lights one update has to touch. */
export interface LightChange {
  /** Project ids of the lights whose fields changed. */
  ids: ReadonlySet<string>;
  /** True when a light was added, removed or switched type, so its slot is rebuilt. */
  structure: boolean;
}

/** Owns the environment image key and the project's lights. */
export class EnvironmentStage {
  private textureUrl = '';
  private pending: Promise<void> = Promise.resolve();
  /** Bumped by every environment apply, so a superseded read writes nothing. */
  private generation = 0;
  /** Object urls already handed out, per stored key, so a re-apply reads no blob again. */
  private readonly urlCache = new Map<string, string>();
  /** Runtime light slot behind each project light id. */
  private readonly slots = new Map<string, number>();

  /** Applies the project's environment image and every light; used when the scene is rebuilt. */
  applyAll(host: PresenterHost, lights: LightConfig): Promise<void> {
    const run = this.applyEnvironment(host, lights);
    // `applyEnvironment` claims its generation synchronously, so this one identifies the pair.
    const generation = this.generation;
    this.pending = run.then(() => {
      if (generation === this.generation) this.applyLights(host, lights);
    });
    return this.pending;
  }

  /** Applies the environment image as backdrop and lighting source. */
  async applyEnvironment(host: PresenterHost, lights: LightConfig): Promise<void> {
    const generation = ++this.generation;
    const run = this.pending
      .then(() => this.resolveUrl(lights))
      .then(target => this.loadEnvironment(host, target.url, generation));
    this.pending = run.catch(() => undefined);
    await run;
    if (generation !== this.generation) return;
    host.writer.setEnvironment({ intensity: iblStrength(lights) });
  }

  /**
   * Writes the punctual lights. A change that only names a few lights patches those slots;
   * anything else rebuilds the whole list.
   */
  applyLights(host: PresenterHost, lights: LightConfig, change?: LightChange): void {
    const writer = host.writer;
    const wanted = normalizeLights(lights);
    if (!change || change.structure) {
      writer.clearLights();
      this.slots.clear();
      for (const light of wanted) this.slots.set(light.id, writer.addLight(lightDesc(light)));
      return;
    }
    for (const light of wanted) {
      if (!change.ids.has(light.id)) continue;
      const slot = this.slots.get(light.id);
      if (slot === undefined) this.slots.set(light.id, writer.addLight(lightDesc(light)));
      else writer.updateLight(slot, lightDesc(light) as LightPatch);
    }
  }

  /**
   * Moves one light's slot without touching the list, for a live drag preview.
   */
  moveLight(host: PresenterHost, light: SceneLight): void {
    const slot = this.slots.get(light.id);
    if (slot === undefined) return;
    host.writer.updateLight(slot, lightDesc(light) as LightPatch);
  }

  /** Drops the loaded environment image and its object url. */
  release(host: PresenterHost): void {
    // An apply still in flight must not put the released image back into the world.
    this.generation += 1;
    host.textures.release(ENV_TEXTURE_KEY);
    this.textureUrl = '';
    for (const url of this.urlCache.values()) URL.revokeObjectURL(url);
    this.urlCache.clear();
    this.slots.clear();
    host.writer.setEnvironment({
      background: 'color', color: FALLBACK_BACKGROUND, textureKey: null, url: '',
    });
  }

  /** Loads the image into the texture port and points the world environment at it. */
  private async loadEnvironment(host: PresenterHost, url: string, generation: number): Promise<void> {
    // A newer apply or a release owns the environment now; this read is stale.
    if (generation !== this.generation) return;
    if (this.textureUrl === url) return;
    host.textures.load(ENV_TEXTURE_KEY, url, { colorSpace: 'linear' });
    this.textureUrl = url;
    host.writer.setEnvironment({
      background: 'texture', textureKey: ENV_TEXTURE_KEY, url,
    });
  }

  /** Environment url for these lights, keeping one object url per stored key. */
  private async resolveUrl(lights: LightConfig): Promise<{ url: string }> {
    if (lights.iblUrl) return { url: lights.iblUrl };
    const key = lights.iblObjectKey;
    if (!key) return { url: BUNDLED_ENVIRONMENT_URL };
    const cached = this.urlCache.get(key);
    if (cached) return { url: cached };
    const blob = await getModelBlob(key);
    if (!blob) return { url: BUNDLED_ENVIRONMENT_URL };
    // A second apply may have resolved the same key while the blob was being read.
    const live = this.urlCache.get(key);
    if (live) return { url: live };
    const name = lights.iblName ?? 'environment.hdr';
    const url = URL.createObjectURL(blob instanceof File ? blob : new File([blob], name));
    this.urlCache.set(key, url);
    return { url };
  }
}

/** World description of one project light. */
function lightDesc(light: SceneLight): LightDesc {
  return {
    type: light.type,
    name: light.name,
    color: light.color,
    intensity: light.intensity,
    position: light.position,
    target: light.target,
    distance: light.distance,
    coneAngleDeg: light.coneAngleDeg,
    penumbra: light.penumbra,
    width: light.width,
    height: light.height,
    enabled: light.enabled,
  };
}
