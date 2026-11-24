import type { LightDesc, LightPatch } from '@/render/world';
import type { PresenterHost } from '@/runtime/world/presenters/host';

import { bundledAssetUrl } from '@/base/platform/assetUrls';
import { getModelBlob } from '@/io/storage';
import { environmentSource, iblStrength, normalizeLights, type LightConfig, type SceneLight } from '@/model';

export const BUNDLED_ENVIRONMENT_URL = bundledAssetUrl('/env/royal_esplanade_1k.hdr');

const FALLBACK_BACKGROUND = '#2a2a2e';

const ENV_TEXTURE_KEY = 'environment';

export interface LightChange {
  ids: ReadonlySet<string>;
  structure: boolean;
}

export class EnvironmentStage {
  private textureUrl = '';
  private pending: Promise<void> = Promise.resolve();
  private generation = 0;
  private readonly urlCache = new Map<string, string>();
  private readonly slots = new Map<string, number>();

  applyAll(host: PresenterHost, lights: LightConfig): Promise<void> {
    const run = this.applyEnvironment(host, lights);
    const generation = this.generation;
    this.pending = run.then(() => {
      if (generation === this.generation) this.applyLights(host, lights);
    });
    return this.pending;
  }

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

  moveLight(host: PresenterHost, light: SceneLight): void {
    const slot = this.slots.get(light.id);
    if (slot === undefined) return;
    host.writer.updateLight(slot, lightDesc(light) as LightPatch);
  }

  release(host: PresenterHost): void {
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

  private async loadEnvironment(host: PresenterHost, url: string, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    if (this.textureUrl === url) return;
    host.textures.load(ENV_TEXTURE_KEY, url, { colorSpace: 'linear' });
    this.textureUrl = url;
    host.writer.setEnvironment({
      background: 'texture', textureKey: ENV_TEXTURE_KEY, url,
    });
  }

  private async resolveUrl(lights: LightConfig): Promise<{ url: string }> {
    if (environmentSource(lights) === 'builtin') return { url: BUNDLED_ENVIRONMENT_URL };
    if (lights.iblUrl) return { url: lights.iblUrl };
    const key = lights.iblObjectKey;
    if (!key) return { url: BUNDLED_ENVIRONMENT_URL };
    const cached = this.urlCache.get(key);
    if (cached) return { url: cached };
    const blob = await getModelBlob(key);
    if (!blob) return { url: BUNDLED_ENVIRONMENT_URL };
    const live = this.urlCache.get(key);
    if (live) return { url: live };
    const name = lights.iblName ?? 'environment.hdr';
    const url = URL.createObjectURL(blob instanceof File ? blob : new File([blob], name));
    this.urlCache.set(key, url);
    return { url };
  }
}

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
