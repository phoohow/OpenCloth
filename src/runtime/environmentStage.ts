import type { LightConfig } from '@/model/types';
import { iblStrength } from '@/model';
import { applySceneEnvironment, releaseSceneEnvironment, DEFAULT_ENV_URL, type RendererContext } from '@/render/renderer';
import { getModelBlob } from '@/io/storage';

/** The scene's environment image: backdrop, lighting source and the object url serving it. */
export class EnvironmentStage {
  private objectKey: string | null = null;
  private objectUrl: string | null = null;

  constructor(private ctx: RendererContext) { }

  /** Applies the project's environment image as backdrop and lighting source. */
  async apply(lights: LightConfig): Promise<void> {
    const target = await this.resolveUrl(lights);
    await applySceneEnvironment(this.ctx.surface.scene, target.url, target.name);
    this.ctx.surface.scene.environmentIntensity = iblStrength(lights);
    this.ctx.ray.tracer?.invalidateEnvironment();
  }

  /** Revokes the live object url and frees the texture loaded from it. */
  release(): void {
    if (!this.objectUrl) return;
    releaseSceneEnvironment(this.ctx.surface.scene, this.objectUrl);
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.objectKey = null;
  }

  /** Environment url for these lights, keeping one object url per stored key. */
  private async resolveUrl(lights: LightConfig): Promise<{ url: string; name: string }> {
    if (lights.iblUrl) return { url: lights.iblUrl, name: lights.iblUrl };
    const name = lights.iblName ?? 'environment.hdr';
    const key = lights.iblObjectKey;
    const blob = key ? await getModelBlob(key) : null;
    if (!key || !blob) {
      this.release();
      return { url: DEFAULT_ENV_URL, name: DEFAULT_ENV_URL };
    }
    if (this.objectKey !== key || !this.objectUrl) {
      this.release();
      this.objectUrl = URL.createObjectURL(blob instanceof File ? blob : new File([blob], name));
      this.objectKey = key;
    }
    return { url: this.objectUrl, name };
  }
}
