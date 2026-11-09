/** Branded handles and frame sizes the backend hands out instead of three objects. */

import type * as THREE from 'three/webgpu';
import type { DrawStage } from '@/render/common';

/** Options the application entry passes to the backend. */
export interface BackendOptions {
  readonly canvas: HTMLCanvasElement;
  readonly antialias?: boolean;
  /** Called when the GPU device is lost; the viewport rebuilds its GPU. */
  readonly onDeviceLost?: (reason: string) => void;
  /** Called when the OIDN weights fail to load. */
  readonly onDenoiseFailure?: (message: string) => void;
}

/** Pixel sizes one frame needs; defined by Contract. */
export type { FrameSize } from '@/render/common';

/** Opaque render-target handle. */
declare const targetBrand: unique symbol;
export type TargetHandle = THREE.RenderTarget & { readonly [targetBrand]: true };

/** Opaque texture handle. */
declare const textureBrand: unique symbol;
export type TextureHandle = THREE.Texture & { readonly [textureBrand]: true };

/** Brands an internal render target as an opaque handle. */
export function asTargetHandle(target: THREE.RenderTarget): TargetHandle {
  return target as TargetHandle;
}

/** Brands an internal texture as an opaque handle. */
export function asTextureHandle(texture: THREE.Texture): TextureHandle {
  return texture as TextureHandle;
}

/** Opaque full-screen program handle. */
export type ProgramHandle = string;

/** Opaque raster or trace scene root handle. */
export interface SceneHandle {
  readonly id: 'raster' | 'trace';
  readonly revision: number;
  readonly geometryRevision: number;
  readonly materialRevision: number;
  readonly stage: DrawStage;
}

/** An opaque GPU object registered under a stable asset key. */
export interface AssetRecord {
  readonly key: string;
  readonly object: THREE.Object3D;
  dispose(): void;
}
