import type { Vec3Tuple } from '@/base/math';
import type {
  AssetKey, Bounds, ExportFormat, MeshData, MaterialData, Ray, SceneSnapshot, Transform,
} from '@/render/common/types';

export type TextureColorSpace = 'srgb' | 'linear';

export interface TextureOptions {
  readonly colorSpace?: TextureColorSpace;
  readonly tiling?: { readonly x: number; readonly y: number };
  readonly offset?: { readonly x: number; readonly y: number };
}

export interface PrintPlacement {
  readonly center: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
  readonly angleDeg: number;
  readonly opacity: number;
  readonly repeat: { readonly x: number; readonly y: number };
  readonly imageUrl: string;
}

export interface PaintCommand {
  readonly width: number;
  readonly height: number;
  readonly baseColor: string;
  readonly albedo?: {
    readonly url: string;
    readonly tiling?: { readonly x: number; readonly y: number };
    readonly offset?: { readonly x: number; readonly y: number };
  };
  readonly panelSizeCm?: { readonly x: number; readonly y: number };
  readonly prints?: readonly PrintPlacement[];
  readonly uv?: {
    readonly repeat: { readonly x: number; readonly y: number };
    readonly offset: { readonly x: number; readonly y: number };
  };
}

export interface TexturePort {
  load(key: string, url: string, options?: TextureOptions): void;
  paint(key: string, commands: readonly PaintCommand[]): void;
  release(key: string): void;
  readonly version: number;
}

export interface DevicePort {
  device(): GPUDevice;
}

export interface AssetMesh {
  readonly name: string;
  readonly mesh: MeshData;
  readonly material?: MaterialData;
  readonly transform?: Transform;
}

export type AssetSource =
  | {
    readonly kind: 'model';
    readonly fileName?: string;
    readonly targetHeight?: number;
  } & (
    | { readonly url: string; readonly data?: never }
    | { readonly url?: never; readonly data: ArrayBuffer }
  )
  | {
    readonly kind: 'meshes';
    readonly meshes: readonly AssetMesh[];
    readonly motion?: ProceduralMotion;
    readonly motionMesh?: string;
  };

export interface MotionTrack {
  readonly region: number;
  readonly times: readonly number[];
  readonly values: readonly Vec3Tuple[];
}

export interface ProceduralClip {
  readonly name: string;
  readonly duration: number;
  readonly tracks: readonly MotionTrack[];
}

export interface ProceduralMotion {
  readonly regions: readonly string[];
  readonly pivots: readonly Vec3Tuple[];
  readonly parents: readonly number[];
  readonly weights: Float32Array;
  readonly clips: readonly ProceduralClip[];
}

export interface AssetAnimation {
  readonly name: string;
  readonly duration: number;
}

export interface AssetPlayback {
  readonly clip: number;
  readonly timeSeconds: number;
  readonly playing: boolean;
}

export interface AssetRegionPose {
  readonly region: string;
  readonly matrix: ArrayLike<number>;
}

export type AssetDisplay = 'visible' | 'hidden' | 'translucent';

export interface AssetAppearance {
  readonly color?: string;
  readonly roughness?: number;
  readonly clearcoat?: number;
  readonly opacity?: number;
}

export interface AssetHit {
  readonly distance: number;
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
}

export interface AssetCollision {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
}

export interface AssetHandle {
  readonly revision: number;
  readonly bounds: Bounds;
  pose(transform: Transform): void;
  setAppearance(appearance: AssetAppearance): void;
  setDisplay(display: AssetDisplay): void;
  setHighlighted(on: boolean): void;
  animations(): readonly AssetAnimation[];
  regionPoses(): readonly AssetRegionPose[];
  playback(): AssetPlayback;
  play(clip: number, loop?: boolean): boolean;
  select(clip: number): boolean;
  seek(seconds: number): void;
  setPlaying(playing: boolean): void;
  advance(dtSeconds: number): boolean;
  raycast(ray: Ray): AssetHit | null;
  collision(): AssetCollision | null;
  deform?(positions: Float32Array, contact: Float32Array | null): boolean;
  setSoftBody?(enabled: boolean): void;
  restore?(): void;
  export(format: ExportFormat): Promise<ArrayBuffer>;
  dispose(): void;
}

export interface AssetPort {
  load(key: AssetKey, source: AssetSource): Promise<AssetHandle>;
  handle(key: AssetKey): AssetHandle | null;
  release(key: AssetKey): void;
}

export interface ExportPort {
  export(
    snapshot: SceneSnapshot,
    assets: readonly AssetHandle[],
    format: ExportFormat,
  ): Promise<ArrayBuffer>;
}
