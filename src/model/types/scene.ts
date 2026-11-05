/**
 * Everything around the garment: lights, rendering, the solver configuration, reference
 * objects and the saved camera.
 */

import type { ObjectTransform, Vec3 } from '@/model/types/geometry';
import type { RenderConfig, SimulationConfig, CameraConfig } from '@/model/schema/sceneSettings';

export * from '@/model/schema/sceneSettings';

// ============ Scene ============

/** Light kinds the viewport can render. */
export type LightType = 'directional' | 'point' | 'spot' | 'area';

/** One punctual light in the scene. */
export interface SceneLight {
  id: string;
  name: string;
  type: LightType;
  /** Off when false; the light stays in the project and in the outliner. */
  enabled: boolean;
  /** Brightness: lux-like for directional lights, candela-like for point and spot lights. */
  intensity: number;
  color: string;
  /** World position in meters; a directional light only uses its direction from the target. */
  position: Vec3;
  /** Point the light aims at; unused by point lights. */
  target: Vec3;
  /** Range in meters, 0 for unlimited. Point, spot and area lights. */
  distance: number;
  /** Full cone angle of a spot light, in degrees. */
  coneAngleDeg: number;
  /** Softness of a spot cone's edge, 0 is a hard edge. */
  penumbra: number;
  /** Emitter width and height in meters, for area lights. */
  width: number;
  height: number;
}

/** Scene lighting from the project's lights plus an environment image. */
export interface LightConfig {
  /** Punctual lights, in outliner order. */
  lights: SceneLight[];
  /** Outliner display name of the environment light; the image name stays in `iblName`. */
  iblLabel?: string;
  /** Url of an equirectangular environment image; absent selects the bundled default. */
  iblUrl?: string;
  /** Object-store key of an imported environment image. */
  iblObjectKey?: string;
  /** File name of the imported environment image. */
  iblName?: string;
  /** Off when false; the environment image stays selected for lighting and backdrop. */
  iblEnabled: boolean;
  /** Multiplier for the environment image's lighting contribution. */
  iblIntensity: number;
}

/** Persisted descriptor of an imported reference object. */
export interface ReferenceObjectRef {
  id: string;
  name: string;
  /** Blob key in the local object store; absent when the file is no longer available. */
  objectKey?: string;
  /** Embedded model data URL written on save; takes precedence over `objectKey`. */
  objectUrl?: string;
  visible: boolean;
  opacity: number;
  /** Scene placement; absent means the identity transform. */
  transform?: ObjectTransform;
}

/** Everything around the garment: lighting, rendering, solving and reference objects. */
export interface SceneConfig {
  lights: LightConfig;
  render: RenderConfig;
  simulation: SimulationConfig;
  referenceObjects?: ReferenceObjectRef[];
  /** Saved camera placement, restored when the project opens. */
  camera?: CameraConfig;
  /** Outliner display name of the viewport camera. */
  cameraName?: string;
}
