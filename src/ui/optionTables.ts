import type { PanelWrapMode } from '@/garment';
import type {
  BodyLandmark, CameraProjection, DenoiseModel, EditPreviewTier, GarmentLayer, MeshSampling,
  PanelDrape, ToneMappingMode,
} from '@/model/types';
import type { RayTraceFailure, TraceStatus as RayTraceState, RayTracingCapability } from '@/render/common';
import type { CameraPreset } from '@/runtime';
import type { PropTab, DisplayMode, AssetTab, AuxGroupMode } from '@/store';
import type { IconName } from '@/ui/icons';
import type { DisplayOptions } from '@/ui/viewport2D/render';

import { DEFAULT_SKIN_APPEARANCE } from '@/model';

export const PROP_TAB_OPTIONS: PropTabOption[] = [
  { key: 'object', icon: 'cube', label: '对象' },
  { key: 'material', icon: 'swatch', label: '材质' },
  { key: 'simulator', icon: 'waves', label: '模拟' },
  { key: 'transform', icon: 'move', label: '变换' },
  { key: 'render', icon: 'image', label: '渲染' },
  { key: 'pattern', icon: 'ruler', label: '测量' },
  { key: 'project', icon: 'briefcase', label: '工程' },
];

export const ASSET_TAB_OPTIONS: AssetTabOption[] = [
  { key: 'pattern', icon: 't-shirt', label: '版型' },
  { key: 'model', icon: 'avatar', label: '模特' },
  { key: 'fabric', icon: 'swatch', label: '面料' },
  { key: 'trim', icon: 'trim', label: '辅料' },
  { key: 'environment', icon: 'environment', label: '环境' },
];

export const DISPLAY_LAYER_OPTIONS: Array<{ key: keyof DisplayOptions; label: string }> = [
  { key: 'bodyGuide', label: '人体参考' },
  { key: 'internal', label: '内部线' },
  { key: 'darts', label: '省道' },
  { key: 'seamAllowance', label: '缝份线' },
  { key: 'notches', label: '刀口' },
  { key: 'grain', label: '布纹线' },
  { key: 'annotations', label: '注释' },
  { key: 'measurements', label: '尺寸线' },
  { key: 'prints', label: '印花' },
  { key: 'topstitches', label: '明线' },
  { key: 'trims', label: '辅料' },
  { key: 'gradingOverlay', label: '放码预览' },
  { key: 'seamJoin', label: '拼接预览' },
  { key: 'wireframe', label: '网格线' },
];

export const CAMERA_PRESETS: CameraPresetOption[] = [
  { value: 'front', menuId: 'cameraFront', label: '正视' },
  { value: 'back', menuId: 'cameraBack', label: '后视' },
  { value: 'left', menuId: 'cameraLeft', label: '左视' },
  { value: 'right', menuId: 'cameraRight', label: '右视' },
  { value: 'bottom', menuId: 'cameraBottom', label: '仰视' },
  { value: 'top', menuId: 'cameraTop', label: '俯视' },
  { value: 'frontLeft', menuId: 'cameraFrontLeft', label: '前左' },
  { value: 'frontRight', menuId: 'cameraFrontRight', label: '前右' },
  { value: 'backLeft', menuId: 'cameraBackLeft', label: '后左' },
  { value: 'backRight', menuId: 'cameraBackRight', label: '后右' },
];

export const CAMERA_PROJECTIONS: CameraProjectionOption[] = [
  { value: 'perspective', menuId: 'cameraProjectionPerspective', label: '透视' },
  { value: 'orthographic', menuId: 'cameraProjectionOrthographic', label: '正交' },
];

export const WIRE_AUX_OPTIONS: Array<{ value: AuxGroupMode; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'only', label: '仅线框' },
  { value: 'over', label: '叠加线框' },
];

export const PROXY_AUX_OPTIONS: Array<{ value: AuxGroupMode; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'only', label: '仅简模' },
  { value: 'over', label: '叠加简模' },
];

export const GIRTH_LINES_AUX_OPTIONS: Array<{ value: AuxGroupMode; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'only', label: '仅围度线' },
  { value: 'over', label: '叠加围度线' },
];

export const SKELETON_AUX_OPTIONS: Array<{ value: AuxGroupMode; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'only', label: '仅骨架' },
  { value: 'over', label: '叠加骨架' },
];

export const DISPLAY_MODES: Array<{ value: DisplayMode; label: string }> = [
  { value: 'rasterized', label: '光栅化' },
  { value: 'raytraced', label: '光线追踪' },
  { value: 'uvVis', label: 'UV可视化' },
  { value: 'normalVis', label: 'Normal可视化' },
  { value: 'fitHeatmap', label: '合身热图' },
  { value: 'strainHeatmap', label: '应变热图' },
  { value: 'pressureHeatmap', label: '压力热图' },
];

export const EDIT_PREVIEW_TIERS: Array<{ value: EditPreviewTier; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低精度' },
  { value: 'full', label: '全精度' },
];

export const MESH_SAMPLINGS: Array<{ value: MeshSampling; label: string }> = [
  { value: 'lattice', label: '六边晶格' },
  { value: 'blueNoise', label: '蓝噪声' },
];

export const TONE_MAPPING: Array<{ value: ToneMappingMode; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'aces', label: 'ACES' },
  { value: 'reinhard', label: 'Reinhard' },
  { value: 'linear', label: '线性' },
];

export const DENOISE_MODELS: Array<{ value: DenoiseModel; label: string }> = [
  { value: 'small', label: '快速' },
  { value: 'base', label: '均衡' },
];

const RAY_STATE_LABELS: Record<RayTraceState, string> = {
  inactive: '',
  building: '初始化',
  deforming: '模拟中',
  moving: '移动中',
  blending: '光栅过渡',
  tracing: '',
  finished: '采样完成',
  unsupported: '本机不支持',
};

const RAY_FAILURE_LABELS: Record<RayTraceFailure, string> = {
  'gpu-error': 'GPU 错误',
  'setup-failed': '初始化失败',
};

export const SIM_STEP_OPTIONS: number[] = [1 / 30, 1 / 60, 1 / 120, 1 / 240];

export const GARMENT_LAYER_LABELS: Record<GarmentLayer, string> = {
  lining: '里布', padding: '填充', shell: '外壳',
};

export const PANEL_WRAP_MODES: Array<{ value: PanelWrapMode; label: string }> = [
  { value: 'flat', label: '扁平' },
  { value: 'torso-front', label: '躯干前' },
  { value: 'torso-back', label: '躯干后' },
  { value: 'torso-full', label: '躯干整圈' },
  { value: 'arm-left', label: '左臂' },
  { value: 'arm-right', label: '右臂' },
  { value: 'leg-left', label: '左腿' },
  { value: 'leg-right', label: '右腿' },
  { value: 'neck', label: '领口' },
  { value: 'neck-left', label: '领口左' },
  { value: 'neck-right', label: '领口右' },
  { value: 'head', label: '头部整圈' },
  { value: 'head-left', label: '头部左' },
  { value: 'head-right', label: '头部右' },
];

export const SKIN_TONES: Array<{ key: string; label: string; color: string }> = [
  { key: 'light', label: '浅肤', color: '#ecd3b9' },
  { key: 'asian', label: '自然', color: DEFAULT_SKIN_APPEARANCE.color },
  { key: 'warm', label: '暖棕', color: '#c89873' },
  { key: 'deep', label: '深肤', color: '#8d5c3c' },
];

export interface PropTabOption {
  key: PropTab;
  icon: IconName;
  label: string;
}

export interface AssetTabOption {
  key: AssetTab;
  icon: IconName;
  label: string;
}

export interface CameraPresetOption {
  value: CameraPreset;
  menuId: string;
  label: string;
}

export interface CameraProjectionOption {
  value: CameraProjection;
  menuId: string;
  label: string;
}

export function rayTraceStateLabel(state: RayTraceState): string {
  return RAY_STATE_LABELS[state];
}

export function rayTraceFailureLabel(failure: RayTraceFailure): string {
  return RAY_FAILURE_LABELS[failure];
}

export function rayTracingUnavailableReason(capability: RayTracingCapability | null): string | null {
  if (!capability || capability.ok) return null;
  return `${RAY_FAILURE_LABELS[capability.failure ?? 'setup-failed']}（${capability.detail}）`;
}

export function simStepLabel(dt: number): string {
  const denominator = Math.round(1 / dt);
  if (denominator > 0 && Math.abs(1 / denominator - dt) < 1e-9) return `1/${denominator} s`;
  return `${(dt * 1000).toFixed(1)} ms`;
}

export function anchorOptionsFor(region: PanelDrape['region']): Array<{ value: BodyLandmark; label: string }> {
  const all: Array<{ value: BodyLandmark; label: string }> = [
    { value: 'neckTop', label: '颈顶' },
    { value: 'shoulderTop', label: '肩线' },
    { value: 'shoulderCap', label: '肩峰' },
    { value: 'shoulder', label: '肩关节' },
    { value: 'bust', label: '胸' },
    { value: 'waist', label: '腰' },
    { value: 'hip', label: '胯' },
    { value: 'crotch', label: '裆' },
    { value: 'knee', label: '膝' },
    { value: 'ankle', label: '踝' },
  ];
  if (region === 'arm') return all.filter(option => ['neckTop', 'shoulderTop', 'shoulderCap', 'shoulder', 'bust'].includes(option.value));
  if (region === 'leg') return all.filter(option => ['hip', 'crotch', 'knee', 'ankle'].includes(option.value));
  if (region === 'neck') return all.filter(option => ['neckTop', 'shoulderTop', 'shoulderCap'].includes(option.value));
  if (region === 'head') return all.filter(option => ['neckTop', 'shoulderTop'].includes(option.value));
  return all;
}
