import type { CameraPreset } from '../core/engine/garmentEngine';
import type { CameraProjection, DenoiseModel, RenderMode, ToneMappingMode } from '../core/model/types';
import type { PropTab } from '../store/stores';
import type { IconName } from './icons';

/** One properties-editor tab: rail icon plus the Chinese label shared by rail and menu. */
export interface PropTabOption {
  key: PropTab;
  icon: IconName;
  label: string;
}

/** Properties-editor tabs in rail order; `prefs.ts` validates the persisted value against the same list. */
export const PROP_TAB_OPTIONS: PropTabOption[] = [
  { key: 'object', icon: 'cube', label: '对象' },
  { key: 'material', icon: 'droplet', label: '材质' },
  { key: 'physics', icon: 'atom', label: '物理' },
  { key: 'scene', icon: 'scene', label: '场景' },
  { key: 'render', icon: 'aperture', label: '渲染' },
];

/** One 3D camera preset: engine key, menu/rail label and the shortcut/menu id. */
export interface CameraPresetOption {
  value: CameraPreset;
  /** Shortcut and menu-item id, e.g. `cameraFront`. */
  menuId: string;
  label: string;
}

/** Six axis views first, then the four 45-degree corners; the menus and toolbar list them in this order. */
export const CAMERA_PRESETS: CameraPresetOption[] = [
  { value: 'front', menuId: 'cameraFront', label: '正视' },
  { value: 'back', menuId: 'cameraBack', label: '后视' },
  { value: 'left', menuId: 'cameraLeft', label: '左视' },
  { value: 'right', menuId: 'cameraRight', label: '右视' },
  { value: 'bottom', menuId: 'cameraBottom', label: '仰视' },
  { value: 'top', menuId: 'cameraTop', label: '俯视' },
  { value: 'frontLeft', menuId: 'cameraFrontLeft', label: '正左' },
  { value: 'frontRight', menuId: 'cameraFrontRight', label: '正右' },
  { value: 'backLeft', menuId: 'cameraBackLeft', label: '后左' },
  { value: 'backRight', menuId: 'cameraBackRight', label: '后右' },
];

/** One viewport camera projection: engine key, menu id and Chinese label. */
export interface CameraProjectionOption {
  value: CameraProjection;
  menuId: string;
  label: string;
}

export const CAMERA_PROJECTIONS: CameraProjectionOption[] = [
  { value: 'perspective', menuId: 'cameraProjectionPerspective', label: '透视' },
  { value: 'orthographic', menuId: 'cameraProjectionOrthographic', label: '正交' },
];

/** Viewport display modes offered by the menu and the render tab. */
export const RENDER_MODES: Array<{ value: RenderMode; label: string }> = [
  { value: 'shaded', label: '光栅化' },
  { value: 'raytraced', label: '光线追踪' },
  { value: 'wireframe', label: '线框' },
  { value: 'uvCheck', label: 'UV 检查' },
  { value: 'normalVis', label: '法线可视化' },
];

/** Tone-mapping modes offered by the menu and the render tab. */
export const TONE_MAPPING: Array<{ value: ToneMappingMode; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'aces', label: 'ACES' },
  { value: 'reinhard', label: 'Reinhard' },
  { value: 'linear', label: '线性' },
];

/** OIDN guided-denoise weight models offered by the render tab. */
export const DENOISE_MODELS: Array<{ value: DenoiseModel; label: string }> = [
  { value: 'small', label: '快速' },
  { value: 'base', label: '均衡' },
];
