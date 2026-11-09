/** Fixed full-screen programs: composite, tone mapping, present and texture blit. */

import * as THREE from 'three/webgpu';
import { mix, texture, uniform, uv, vec4 } from 'three/tsl';
import type { ToneMappingMode } from '@/render/common';
import type { Commands } from '@/render/backend/commands';
import type { TargetHandle, TextureHandle } from '@/render/backend/types';

/** Owns the full-screen materials the frame and the denoiser draw. */
export class ProgramLibrary {
  private readonly weight = uniform(0);
  private compositeMaterial: THREE.MeshBasicNodeMaterial | null = null;
  private compositeSources: readonly (THREE.Texture | null)[] = [null, null];
  private toneMaterial: THREE.MeshBasicNodeMaterial | null = null;
  private toneCurve: ToneMappingMode | null = null;
  private toneSource: THREE.Texture | null = null;
  private toneExposure: number | null = null;
  private presentMaterial: THREE.MeshBasicNodeMaterial | null = null;
  private presentSource: THREE.Texture | null = null;

  /** Merges the raster image with traced radiance, or copies the raster image aside. */
  composite(
    commands: Commands,
    raster: TextureHandle,
    radiance: TextureHandle | null,
    weight: number,
    target: TargetHandle,
  ): void {
    if (radiance && weight > 0) {
      if (!this.compositeMaterial
        || this.compositeSources[0] !== raster || this.compositeSources[1] !== radiance) {
        this.compositeMaterial?.dispose();
        const material = new THREE.MeshBasicNodeMaterial({
          depthTest: false, depthWrite: false, toneMapped: false,
        });
        material.colorNode = mix(
          texture(raster, uv().flipY()),
          texture(radiance, uv().flipY()),
          this.weight,
        );
        this.compositeMaterial = material;
        this.compositeSources = [raster, radiance];
      }
      this.weight.value = weight;
      commands.setTarget(target, true);
      commands.drawMaterial(this.compositeMaterial);
      return;
    }
    commands.copy(raster, target);
  }

  /** Applies exposure and the selected curve to the composite image. */
  toneMap(
    commands: Commands,
    source: TextureHandle,
    target: TargetHandle,
    curve: ToneMappingMode,
    exposure: number,
  ): void {
    if (!this.toneMaterial || this.toneCurve !== curve
      || this.toneSource !== source || this.toneExposure !== exposure) {
      this.toneMaterial?.dispose();
      const material = new THREE.MeshBasicNodeMaterial({
        depthTest: false, depthWrite: false, toneMapped: false,
      });
      const exposed = texture(source, uv().flipY()).rgb.mul(exposure);
      let mapped = exposed;
      if (curve === 'linear' || curve === 'none') {
        mapped = exposed.clamp(0, 1);
      } else if (curve === 'reinhard') {
        mapped = exposed.div(exposed.add(1)).clamp(0, 1);
      } else if (curve === 'aces') {
        const numerator = exposed.mul(exposed.mul(2.51).add(0.03));
        const denominator = exposed.mul(exposed.mul(2.43).add(0.59)).add(0.14);
        mapped = numerator.div(denominator).clamp(0, 1);
      }
      material.colorNode = vec4(mapped, 1);
      this.toneMaterial = material;
      this.toneCurve = curve;
      this.toneSource = source;
      this.toneExposure = exposure;
    }
    commands.setTarget(target, false);
    commands.drawMaterial(this.toneMaterial);
  }

  /** Blits a texture to the drawing surface. */
  present(commands: Commands, source: TextureHandle): void {
    if (this.presentMaterial && this.presentSource === source) {
      commands.setTarget(null, true);
      commands.drawMaterial(this.presentMaterial);
      return;
    }
    this.presentMaterial?.dispose();
    const material = new THREE.MeshBasicNodeMaterial({
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    material.colorNode = texture(source, uv().flipY());
    this.presentMaterial = material;
    this.presentSource = source;
    commands.setTarget(null, true);
    commands.drawMaterial(material);
  }

  /** Copies a denoised image into a target without tone mapping. */
  blit(commands: Commands, source: TextureHandle, target: TargetHandle): void {
    const material = new THREE.MeshBasicNodeMaterial({
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    material.colorNode = texture(source, uv().flipY());
    commands.setTarget(target, true);
    commands.drawMaterial(material);
    material.dispose();
  }

  dispose(): void {
    this.compositeMaterial?.dispose();
    this.toneMaterial?.dispose();
    this.presentMaterial?.dispose();
    this.compositeMaterial = null;
    this.toneMaterial = null;
    this.presentMaterial = null;
  }
}
