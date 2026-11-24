import type { DrawStage } from '@/render/common';
import type * as THREE from 'three/webgpu';

export type { FrameSize } from '@/render/common';

declare const targetBrand: unique symbol;

declare const textureBrand: unique symbol;

export interface BackendOptions {
  readonly antialias?: boolean;
  readonly onDeviceLost?: (reason: string) => void;
  readonly onDenoiseFailure?: (message: string) => void;
}

export type TargetHandle = THREE.RenderTarget & { readonly [targetBrand]: true };

export type TextureHandle = THREE.Texture & { readonly [textureBrand]: true };

export type ProgramHandle = string;

export interface SceneHandle {
  readonly id: 'raster' | 'trace' | 'wire';
  readonly revision: number;
  readonly geometryRevision: number;
  readonly materialRevision: number;
  readonly stage: DrawStage;
}

export function asTargetHandle(target: THREE.RenderTarget): TargetHandle {
  return target as TargetHandle;
}

export function asTextureHandle(texture: THREE.Texture): TextureHandle {
  return texture as TextureHandle;
}
