/** Ports the GPU implements and the viewport consumes; none of them mention three. */

import type {
  AssetKey, Bounds, ExportFormat, MeshData, MaterialData, Ray, SceneSnapshot, Transform,
} from '@/render/common/types';

export type TextureColorSpace = 'srgb' | 'linear';

export interface TextureOptions {
  readonly colorSpace?: TextureColorSpace;
  readonly tiling?: { readonly x: number; readonly y: number };
  readonly offset?: { readonly x: number; readonly y: number };
}

/** Placement of one print rectangle in a panel's normalised UV square. */
export interface PrintPlacement {
  /** Rectangle centre, u right and v up, in 0..1. */
  readonly center: { readonly x: number; readonly y: number };
  /** Rectangle size as a fraction of the panel's UV box. */
  readonly width: number;
  readonly height: number;
  readonly angleDeg: number;
  readonly opacity: number;
  readonly repeat: { readonly x: number; readonly y: number };
  readonly imageUrl: string;
}

/** One repaint of a composed panel texture. */
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
}

export interface TexturePort {
  load(key: string, url: string, options?: TextureOptions): void;
  paint(key: string, commands: readonly PaintCommand[]): void;
  release(key: string): void;
  readonly version: number;
}

/** GPU device the domain simulation binds its own pipelines to; carries no three type. */
export interface DevicePort {
  device(): GPUDevice;
}

/** One mesh a procedural asset source carries. */
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
  };

export interface AssetAnimation {
  readonly name: string;
  readonly duration: number;
}

export interface AssetPlayback {
  readonly clip: number;
  readonly timeSeconds: number;
  readonly playing: boolean;
}

export type AssetDisplay = 'visible' | 'hidden' | 'translucent';

export interface AssetAppearance {
  readonly color?: string;
  readonly roughness?: number;
  readonly clearcoat?: number;
  /** Surface opacity, 1 for an opaque body. */
  readonly opacity?: number;
}

export interface AssetHit {
  readonly distance: number;
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
}

/** Triangles of the asset body in its local frame, used by the cloth collider. */
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
  playback(): AssetPlayback;
  play(clip: number, loop?: boolean): boolean;
  seek(seconds: number): void;
  setPlaying(playing: boolean): void;
  advance(dtSeconds: number): boolean;
  raycast(ray: Ray): AssetHit | null;
  collision(): AssetCollision | null;
  /** Presses the body inward under cloth contact; false when the asset stays rigid. */
  deform?(positions: Float32Array, contact: Float32Array | null): boolean;
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
