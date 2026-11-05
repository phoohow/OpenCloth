import type { CameraPreset } from '../core/engine/garmentEngine';
import type { CameraProjection, DenoiseModel, EditPreviewTier, MeshSampling, RenderMode, ToneMappingMode } from '../core/model/types';
import type { PropTab, DisplayMode } from '../store/stores';
import type { IconName } from './icons';
import type { DisplayOptions } from './viewport2D/render';
import type { RayTraceFailure, RayTraceState, RayTracingCapability } from '../render/renderer/rendererContext';

/** One properties-editor tab: rail icon plus the Chinese label shared by rail and menu. */
export interface PropTabOption {
  key: PropTab;
  icon: IconName;
  label: string;
}

/** Properties-editor tabs in rail order: identity, look, physics, pattern data, placement, render, project. */
export const PROP_TAB_OPTIONS: PropTabOption[] = [
  { key: 'object', icon: 'cube', label: '对象' },
  { key: 'material', icon: 'swatch', label: '材质' },
  { key: 'simulator', icon: 'waves', label: '模拟' },
  { key: 'pattern', icon: 'ruler', label: '版型' },
  { key: 'transform', icon: 'move', label: '变换' },
  { key: 'render', icon: 'image', label: '渲染' },
  { key: 'project', icon: 'briefcase', label: '工程' },
];

/** 2D display switches, shared by the 视图 ▸ 2D 显示 menu and the 2D toolbar dropdown. */
export const DISPLAY_LAYER_OPTIONS: Array<{ key: keyof DisplayOptions; label: string }> = [
  { key: 'internal', label: '内部线' },
  { key: 'darts', label: '省道' },
  { key: 'seamAllowance', label: '缝份线' },
  { key: 'notches', label: '刀口' },
  { key: 'grain', label: '布纹线' },
  { key: 'annotations', label: '注释' },
  { key: 'measurements', label: '标注尺寸' },
  { key: 'prints', label: '印花' },
  { key: 'topstitches', label: '明线' },
  { key: 'trims', label: '辅料' },
  { key: 'gradingOverlay', label: '齐码套叠' },
  { key: 'seamJoin', label: '拼接预览' },
  { key: 'wireframe', label: '网格线' },
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

/** Render modes that map to a cloth material; `DISPLAY_MODES` appends the two analysis heatmaps. */
export const RENDER_MODES: Array<{ value: RenderMode; label: string }> = [
  { value: 'shaded', label: '光栅化' },
  { value: 'raytraced', label: '光线追踪' },
  { value: 'wireframe', label: '线框' },
  { value: 'uvCheck', label: 'UV 检查' },
  { value: 'normalVis', label: '法线可视化' },
];

/** Display modes shared by the 3D toolbar, the render tab and the phone drawer, with the heatmaps last. */
export const DISPLAY_MODES: Array<{ value: DisplayMode; label: string }> = [
  ...RENDER_MODES,
  { value: 'fitHeatmap', label: '合身热图' },
  { value: 'strainHeatmap', label: '应变热图' },
  { value: 'pressureHeatmap', label: '压力热图' },
];

/** Edit-preview tiers offered by the 3D toolbar; `prefs.ts` validates the persisted value against the same list. */
export const EDIT_PREVIEW_TIERS: Array<{ value: EditPreviewTier; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低精度' },
  { value: 'full', label: '全精度' },
];

/** Interior point distributions offered by the project tab's mesh generation block. */
export const MESH_SAMPLINGS: Array<{ value: MeshSampling; label: string }> = [
  { value: 'lattice', label: '六边形晶格' },
  { value: 'blueNoise', label: '蓝噪声' },
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

/** Short readout for each ray tracing gate, shown beside the sample count. */
const RAY_STATE_LABELS: Record<RayTraceState, string> = {
  inactive: '',
  building: '光追内核加载中',
  deforming: '布料每帧在变',
  moving: '视角未静止',
  blending: '光栅过渡中',
  traced: '',
  unsupported: '本机不支持',
};

/** Plain-language reading of why the first ray-traced frames rejected this GPU. */
const RAY_FAILURE_LABELS: Record<RayTraceFailure, string> = {
  'gpu-error': 'GPU 报出 WebGPU 错误',
  'setup-failed': '内核初始化失败',
};

/** Readout for one ray tracing gate; empty for the modes that never trace. */
export function rayTraceStateLabel(state: RayTraceState): string {
  return RAY_STATE_LABELS[state];
}

/** Readout for the reason the probe gave. */
export function rayTraceFailureLabel(failure: RayTraceFailure): string {
  return RAY_FAILURE_LABELS[failure];
}

/** Why the display modes stop offering ray tracing; null while it is available or still unprobed. */
export function rayTracingUnavailableReason(capability: RayTracingCapability | null): string | null {
  if (!capability || capability.ok) return null;
  return `${RAY_FAILURE_LABELS[capability.failure ?? 'setup-failed']}（${capability.detail}）`;
}

/** Simulation step lengths offered by the timeline and the phone dock, in seconds, coarsest first. */
export const SIM_STEP_OPTIONS: number[] = [1 / 30, 1 / 60, 1 / 120, 1 / 240];

/** Step length as a fraction of a second (`1/60 s`), or in milliseconds when it has no short fraction. */
export function simStepLabel(dt: number): string {
  const denominator = Math.round(1 / dt);
  if (denominator > 0 && Math.abs(1 / denominator - dt) < 1e-9) return `1/${denominator} s`;
  return `${(dt * 1000).toFixed(1)} ms`;
}

/** Next step length in SIM_STEP_OPTIONS order, wrapping at the end; off-list values land on the first. */
export function nextSimStep(dt: number): number {
  const index = SIM_STEP_OPTIONS.indexOf(dt);
  return SIM_STEP_OPTIONS[(index + 1) % SIM_STEP_OPTIONS.length];
}
