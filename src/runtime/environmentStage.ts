/** Environment image and punctual lights, written through the texture and world ports. */

import { getModelBlob } from '@/io/storage';
import { iblStrength, normalizeLights, type LightConfig } from '@/model';
import type { PresenterHost } from '@/runtime/presenters/host';

/** Bundled equirectangular environment used when the project selects none. */
const DEFAULT_ENV_URL = '/env/royal_esplanade_1k.hdr';

/** Flat backdrop while no environment image is loaded. */
const FALLBACK_BACKGROUND = '#2a2a2e';

/** Texture key the environment image is registered under. */
const ENV_TEXTURE_KEY = 'environment';

/** Owns the environment image key and the project's lights. */
export class EnvironmentStage {
  private objectKey: string | null = null;
  private objectUrl: string | null = null;
  private textureUrl = '';
  private pending: Promise<void> = Promise.resolve();

  /** Applies the project's environment image as backdrop and lighting source, and its lights. */
  apply(host: PresenterHost, lights: LightConfig): Promise<void> {
    this.pending = this.resolveUrl(lights)
      .then(target => this.loadEnvironment(host, target.url))
      .finally(() => this.applyLights(host, lights));
    return this.pending;
  }

  /** Drops the loaded environment image and its object url. */
  release(host: PresenterHost): void {
    host.textures.release(ENV_TEXTURE_KEY);
    this.textureUrl = '';
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.objectKey = null;
    host.writer.setEnvironment({
      background: 'color', color: FALLBACK_BACKGROUND, textureKey: null, url: '',
    });
  }

  /** Writes every punctual light into the world and rebuilds the environment intensity. */
  private applyLights(host: PresenterHost, lights: LightConfig): void {
    const writer = host.writer;
    writer.clearLights();
    for (const light of normalizeLights(lights)) {
      writer.addLight({
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
      });
    }
    writer.setEnvironment({ intensity: iblStrength(lights) });
  }

  /** Loads the image into the texture port and points the world environment at it. */
  private async loadEnvironment(host: PresenterHost, url: string): Promise<void> {
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
    const name = lights.iblName ?? 'environment.hdr';
    const key = lights.iblObjectKey;
    const blob = key ? await getModelBlob(key) : null;
    if (!key || !blob) {
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
        this.objectKey = null;
      }
      return { url: DEFAULT_ENV_URL };
    }
    if (this.objectKey !== key || !this.objectUrl) {
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = URL.createObjectURL(blob instanceof File ? blob : new File([blob], name));
      this.objectKey = key;
    }
    return { url: this.objectUrl };
  }
}
