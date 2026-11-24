import type { Commands } from '@/render/backend/commands';
import type { ProgramLibrary } from '@/render/backend/programs';
import type { SceneStore } from '@/render/backend/scene/sceneStore';
import type { CameraState, DenoiseModel } from '@/render/common';
import type { OIDNDenoiser } from 'three-gpu-pathtracer/webgpu';

import { bundledAssetUrl } from '@/base/platform/assetUrls';
import {
  asTargetHandle, asTextureHandle, type TargetHandle, type TextureHandle,
} from '@/render/backend/types';
import * as THREE from 'three/webgpu';

const OIDN_WEIGHTS_BASE = '/weights';

const OIDN_WEIGHTS: Record<DenoiseModel, string> = {
  small: `${OIDN_WEIGHTS_BASE}/rt_hdr_alb_nrm_small.tza`,
  base: `${OIDN_WEIGHTS_BASE}/rt_hdr_alb_nrm.tza`,
};

const OIDN_COLOR_WEIGHTS = `${OIDN_WEIGHTS_BASE}/rt_hdr.tza`;

const DENOISE_INTERVAL_FRAMES = 32;

const DENOISE_TIMEOUT_MS = 15000;

type InitUNetFromURL = (
  url: string,
  params: { device: GPUDevice },
  options: { aux?: boolean; hdr?: boolean; maxTileSize?: number | null; dynamicTile?: unknown },
) => Promise<unknown>;

export interface DenoiseFrame {
  readonly radiance: TargetHandle;
  readonly samples: number;
  readonly weight: number;
  readonly accumulating: boolean;
  readonly restarted: boolean;
}

export class DenoiseEngine {
  private denoiser: OIDNDenoiser | null = null;
  private loading: Promise<OIDNDenoiser | null> | null = null;
  private failedModel: DenoiseModel | null = null;
  private model: DenoiseModel = 'base';
  private frame = 0;
  private finishedAt = -1;
  private denoisedSamples = 0;
  private startedAt = 0;
  private completedCount = 0;
  private output: THREE.RenderTarget | null = null;
  private disposed = false;
  private generation = 0;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly commands: Commands,
    private readonly programs: ProgramLibrary,
    private readonly onFailure?: (message: string) => void,
  ) {}

  configure(model: DenoiseModel): void {
    if (this.model === model) return;
    this.model = model;
    this.failedModel = null;
    this.generation += 1;
    this.loading = null;
    this.denoiser?.dispose();
    this.denoiser = null;
    this.finishedAt = -1;
    this.denoisedSamples = 0;
    this.startedAt = 0;
    this.completedCount = 0;
    this.clearOutput();
  }

  retry(): void {
    this.failedModel = null;
  }

  get completedPasses(): number {
    return this.completedCount;
  }

  reset(): void {
    this.denoiser?.reset();
    this.frame = 0;
    this.finishedAt = -1;
    this.denoisedSamples = 0;
    this.startedAt = 0;
    this.completedCount = 0;
    this.clearOutput();
  }

  run(
    scene: SceneStore,
    camera: CameraState,
    frame: DenoiseFrame,
  ): TextureHandle | null {
    if (this.failedModel === this.model) return this.heldTexture();
    if (frame.restarted) {
      this.reset();
      return null;
    }

    const denoiser = this.denoiser;
    if (!denoiser) {
      this.ensure();
      return null;
    }

    if (!denoiser.running && denoiser.complete) {
      const cleaned = denoiser.texture;
      if (cleaned) {
        this.publish(cleaned, frame.radiance);
        this.completedCount += 1;
      }

      denoiser.reset();
      this.finishedAt = this.frame;
      this.startedAt = 0;
      return this.heldTexture();
    }

    this.frame += 1;
    if (denoiser.running) return this.checkTimeout(denoiser);

    if (this.due(frame)) {
      denoiser.reset();
      this.denoisedSamples = frame.samples;
      this.startedAt = performance.now();
      this.apply(scene, camera, frame.radiance);
    }

    return this.heldTexture();
  }

  private checkTimeout(denoiser: OIDNDenoiser): TextureHandle | null {
    if (this.startedAt === 0 || performance.now() - this.startedAt <= DENOISE_TIMEOUT_MS) {
      return this.heldTexture();
    }

    this.startedAt = 0;
    this.failedModel = this.model;
    this.denoiser = null;
    denoiser.dispose();
    this.clearOutput();
    this.onFailure?.('OIDN 降噪未能启动，已改用无降噪渲染；关闭再开启降噪可重试。');
    return this.heldTexture();
  }

  private heldTexture(): TextureHandle | null {
    return this.output ? asTextureHandle(this.output.texture) : null;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.denoiser?.dispose();
    this.denoiser = null;
    this.loading = null;
    this.clearOutput();
  }

  private due(frame: DenoiseFrame): boolean {
    const denoiser = this.denoiser;
    if (!denoiser || denoiser.running) return false;
    if (frame.weight < 1) return false;
    if (frame.samples <= this.denoisedSamples) return false;
    if (this.finishedAt < 0) return true;
    if (!frame.accumulating) return true;
    return this.frame - this.finishedAt >= DENOISE_INTERVAL_FRAMES;
  }

  private publish(source: THREE.Texture, radiance: TargetHandle): void {
    this.output = this.fitOutput(radiance);
    this.programs.blit(this.commands, asTextureHandle(source), asTargetHandle(this.output));
  }

  private fitOutput(radiance: TargetHandle): THREE.RenderTarget {
    const current = this.output;
    if (current && current.width === radiance.width && current.height === radiance.height) {
      return current;
    }

    this.clearOutput();
    const output = new THREE.RenderTarget(radiance.width, radiance.height, {
      type: radiance.texture.type,
      depthBuffer: false,
    });
    output.texture.colorSpace = radiance.texture.colorSpace;
    this.output = output;
    return output;
  }

  private clearOutput(): void {
    this.output?.dispose();
    this.output = null;
  }

  private apply(scene: SceneStore, camera: CameraState, radiance: TargetHandle): THREE.Texture | null {
    const denoiser = this.denoiser;
    if (!denoiser) {
      this.ensure();
      return null;
    }

    denoiser.setScene(scene.traceSceneRoot, this.commands.cameraFor(camera));
    return denoiser.update(radiance.texture) ?? null;
  }

  private ensure(): void {
    if (this.disposed || this.loading || this.failedModel === this.model) return;
    const generation = this.generation;
    const model = this.model;
    const loading: Promise<OIDNDenoiser | null> = Promise.all([
      import('oidn-webgpu'),
      import('three-gpu-pathtracer/webgpu'),
    ]).then(([oidn, pathtracer]) => {
      const initUNet = oidn.initUNetFromURL as unknown as InitUNetFromURL;
      const denoiser = new pathtracer.OIDNDenoiser({
        initUNetFromURL: initUNet,
        auxWeightsUrl: bundledAssetUrl(OIDN_WEIGHTS[model]),
        colorWeightsUrl: bundledAssetUrl(OIDN_COLOR_WEIGHTS),
      });
      if (this.disposed || generation !== this.generation) {
        denoiser.dispose();
        return null;
      }

      denoiser.init(this.renderer);
      this.denoiser = denoiser;
      return denoiser;
    }).catch((error: unknown) => {
      if (this.disposed || generation !== this.generation) return null;
      this.failedModel = model;
      console.warn('OIDN denoiser unavailable:', error);
      this.onFailure?.('OIDN 降噪权重加载失败，已改用无降噪渲染；关闭再开启降噪可重试。');
      return null;
    });
    this.loading = loading;
    void loading.finally(() => {
      if (this.loading === loading) this.loading = null;
    });
  }
}
