import type { CameraProjection, EditPreviewTier, SurfaceMode, Pattern, RenderBackend, TrimKind, Vec2 } from '@/model/types';
import type { AuxState } from '@/store/auxView';
import type { AssetTab, PaneId, PlaybackChannel, PropTab, ViewLayout } from '@/store/types';

import { FLOOR_NODE_ID, type PatternElementKind } from '@/model';
import { pickPrefs, readPrefs, writePrefs } from '@/store/prefs';
import { presetOf, RENDER_PRESETS } from '@/store/renderPresets';
import { create } from 'zustand';

export type { AssetTab, PaneId, PlaybackChannel, PropTab, ViewLayout } from '@/store/types';

const HEATMAP_MODES: ReadonlySet<string> = new Set(['fitHeatmap', 'strainHeatmap', 'pressureHeatmap']);

const prefs = readPrefs();

let toastSeq = 0;

export const useUIStore = create<UIStore>((set, get) => ({
  layout: prefs.layout,
  splitRatio: prefs.splitRatio,
  focus: prefs.focus,
  activeTool: 'select',
  transformMode: 'translate',
  selection: [],
  propTab: prefs.propTab,
  sceneRatio: prefs.sceneRatio,
  leftPanelWidth: prefs.leftPanelWidth,
  rightPanelWidth: prefs.rightPanelWidth,
  expandedOutliner: [],
  fill: prefs.fill,
  aux: prefs.aux,
  backend: prefs.backend,
  cameraProjection: prefs.cameraProjection,
  fitToken: 0,
  repaintToken: 0,
  trimKind: 'button',
  refObjectsVersion: 0,
  marqueeKinds: ['panel'],
  editPreview: prefs.editPreview,
  fitCheck: false,
  fitTightCm: 0.5,
  fitLooseCm: 2.5,
  strainCheck: false,
  strainMin: -0.25,
  strainMax: 0.25,
  strainByFabric: false,
  pressureCheck: false,
  pressureMaxKpa: 5,
  dynamicSampling: false,
  editPreviewPattern: null,
  gradingClipboard: null,
  displayOptions: {
    bodyGuide: true,
    internal: true, darts: true, seamAllowance: false, notches: true, grain: true, annotations: true, measurements: true, gradingOverlay: false, seamJoin: false,
    prints: true, topstitches: true, trims: true, wireframe: false,
  },
  assetTab: 'pattern',
  showAssetPanel: prefs.showAssetPanel,
  showScenePanel: prefs.showScenePanel,
  showPropertiesPanel: prefs.showPropertiesPanel,
  showTimeline: prefs.showTimeline,
  playbackChannel: prefs.playbackChannel,
  linkChannels: prefs.linkChannels,
  showPerfPanel: false,
  autoSaveSeconds: prefs.autoSaveSeconds,
  lastAutosaveAt: null,
  toast: null,
  measure3d: null,
  dragForce3d: null,

  setLayout: (v) => set({ layout: v }),
  setSplitRatio: (r) => set({ splitRatio: r }),
  setFocus: (p) => set({ focus: p }),
  setTool: (t) => set({ activeTool: t, focus: toolPane(t) }),
  toggleTool: (t) => set(s => s.activeTool === t
    ? { activeTool: 'select' }
    : { activeTool: t, focus: toolPane(t) }),
  setTransformMode: (m) => { if (m !== 'scale') set({ transformMode: m }); },
  select: (ids) => set(selectionState(ids)),
  toggleSelection: (id) => {
    const sel = get().selection;
    const next = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id];
    set(selectionState(next));
  },
  clearSelection: () => set({ selection: [] }),
  setDisplayOption: (key, value) => set(s => ({ displayOptions: { ...s.displayOptions, [key]: value } })),
  setMarqueeKinds: (kinds) => set({ marqueeKinds: kinds }),
  setEditPreview: (tier) => set({ editPreview: tier }),
  setFitCheck: (on) => set(s => ({
    fitCheck: on,
    strainCheck: on ? false : s.strainCheck,
    pressureCheck: on ? false : s.pressureCheck,
  })),
  setFitThresholds: (tightCm, looseCm) => set({
    fitTightCm: Math.max(0, tightCm),
    fitLooseCm: Math.max(tightCm, looseCm),
  }),
  setStrainCheck: (on) => set(s => ({
    strainCheck: on,
    fitCheck: on ? false : s.fitCheck,
    pressureCheck: on ? false : s.pressureCheck,
  })),
  setStrainRange: (min, max) => set({
    strainMin: Math.min(max, min),
    strainMax: Math.max(max, min),
  }),
  setStrainByFabric: (on) => set({ strainByFabric: on }),
  setPressureCheck: (on) => set(s => ({
    pressureCheck: on,
    fitCheck: on ? false : s.fitCheck,
    strainCheck: on ? false : s.strainCheck,
  })),
  setPressureMaxKpa: (maxKpa) => set({ pressureMaxKpa: Math.max(0.5, Math.min(30, maxKpa)) }),
  setDynamicSampling: (on) => set({ dynamicSampling: on }),
  setEditPreviewPattern: (pattern) => set({ editPreviewPattern: pattern }),
  setGradingClipboard: (delta) => set({ gradingClipboard: delta }),
  setSceneRatio: (r) => set({ sceneRatio: r }),
  setLeftPanelWidth: (w) => set({ leftPanelWidth: w }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
  toggleOutliner: (id) => set(s => ({
    expandedOutliner: s.expandedOutliner.includes(id)
      ? s.expandedOutliner.filter(x => x !== id)
      : [...s.expandedOutliner, id],
  })),
  setExpandedOutliner: (ids) => set({ expandedOutliner: ids }),
  setPropTab: (t) => set({ propTab: t }),
  setDisplayMode: (m) => {
    const preset = RENDER_PRESETS.find(entry => entry.id === m);
    const heatmap = HEATMAP_MODES.has(m);
    set({
      pressureCheck: m === 'pressureHeatmap',
      fitCheck: m === 'fitHeatmap',
      strainCheck: m === 'strainHeatmap',
      ...(preset
        ? { fill: preset.fill, backend: preset.backend }
        : heatmap ? { fill: 'material' as SurfaceMode, backend: 'raster' as RenderBackend } : {}),
    });
  },
  setFill: (m) => set({ fill: m }),
  setAux: (m) => set({ aux: m }),
  setBackend: (m) => set({ backend: m }),
  setCameraProjection: (p) => set({ cameraProjection: p }),
  requestFit: () => set(s => ({ fitToken: s.fitToken + 1 })),
  requestRepaint: () => set(s => ({ repaintToken: s.repaintToken + 1 })),
  setTrimKind: (k) => set({ trimKind: k }),
  bumpRefObjects: () => set(s => ({ refObjectsVersion: s.refObjectsVersion + 1 })),
  setAssetTab: (t) => set({ assetTab: t }),
  toggleAssetPanel: () => set(s => ({ showAssetPanel: !s.showAssetPanel })),
  toggleScenePanel: () => set(s => ({ showScenePanel: !s.showScenePanel })),
  togglePropertiesPanel: () => set(s => ({ showPropertiesPanel: !s.showPropertiesPanel })),
  toggleTimeline: () => set(s => ({ showTimeline: !s.showTimeline })),
  setPlaybackChannel: (c) => set({ playbackChannel: c }),
  toggleLinkChannels: () => set(s => ({ linkChannels: !s.linkChannels })),
  togglePerfPanel: () => set(s => ({ showPerfPanel: !s.showPerfPanel })),
  setAutoSaveSeconds: (s) => set({ autoSaveSeconds: s }),
  setMeasure3d: (r) => set({ measure3d: r }),
  setDragForce3d: (r) => set({ dragForce3d: r }),
  setLastAutosaveAt: (at) => set({ lastAutosaveAt: at }),
  showToast: (text) => set({ toast: { id: ++toastSeq, text } }),
  dismissToast: () => set({ toast: null }),
  balancePanes: () => set(s => ({
    splitRatio: 0.5,
    layout: isSplitLayout(s.layout) ? s.layout : 'split3d2d',
  })),
}));

export type ToolType = 'select' | 'point' | 'deletePoint' | 'line' | 'curve' | 'internalLine' | 'dart' | 'seam' | 'pin' | 'unpin' | 'sketch3d' | 'measure3d' | 'rect' | 'circle' | 'ellipse' | 'split' | 'hole' | 'notch' | 'annotation' | 'measure' | 'topstitch' | 'trim';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface MeasureReadout {
  points: number;
  distanceCm: number | null;
}

export interface DragForceReadout {
  x: number;
  y: number;
  forceN: number;
}

export type DisplayMode =
  | 'rasterized' | 'raytraced' | 'uvVis' | 'normalVis'
  | 'fitHeatmap' | 'strainHeatmap' | 'pressureHeatmap';

export interface ToastMessage {
  id: number;
  text: string;
}

interface UIStore {
  layout: ViewLayout;
  splitRatio: number;
  focus: PaneId;
  activeTool: ToolType;
  transformMode: TransformMode;
  selection: string[];
  propTab: PropTab;
  sceneRatio: number;
  leftPanelWidth: number;
  rightPanelWidth: number;
  expandedOutliner: string[];
  fill: SurfaceMode;
  aux: AuxState;
  backend: RenderBackend;
  cameraProjection: CameraProjection;
  fitToken: number;
  repaintToken: number;
  trimKind: TrimKind;
  displayOptions: {
    bodyGuide: boolean;
    internal: boolean;
    darts: boolean;
    seamAllowance: boolean;
    notches: boolean;
    grain: boolean;
    annotations: boolean;
    measurements: boolean;
    gradingOverlay: boolean;
    seamJoin: boolean;
    prints: boolean;
    topstitches: boolean;
    trims: boolean;
    wireframe: boolean;
  };
  refObjectsVersion: number;
  marqueeKinds: PatternElementKind[];
  editPreview: EditPreviewTier;
  fitCheck: boolean;
  fitTightCm: number;
  fitLooseCm: number;
  strainCheck: boolean;
  strainMin: number;
  strainMax: number;
  strainByFabric: boolean;
  pressureCheck: boolean;
  pressureMaxKpa: number;
  dynamicSampling: boolean;
  editPreviewPattern: Pattern | null;
  gradingClipboard: Vec2 | null;
  assetTab: AssetTab;
  showAssetPanel: boolean;
  showScenePanel: boolean;
  showPropertiesPanel: boolean;
  showTimeline: boolean;
  playbackChannel: PlaybackChannel;
  linkChannels: boolean;
  showPerfPanel: boolean;
  autoSaveSeconds: number;
  lastAutosaveAt: string | null;
  measure3d: MeasureReadout | null;
  dragForce3d: DragForceReadout | null;
  toast: ToastMessage | null;
  setLayout: (v: ViewLayout) => void;
  setSplitRatio: (r: number) => void;
  setFocus: (p: PaneId) => void;
  setTool: (t: ToolType) => void;
  toggleTool: (t: ToolType) => void;
  setTransformMode: (m: TransformMode) => void;
  select: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  setDisplayOption: (key: keyof UIStore['displayOptions'], value: boolean) => void;
  setMarqueeKinds: (kinds: PatternElementKind[]) => void;
  setEditPreview: (tier: EditPreviewTier) => void;
  setFitCheck: (on: boolean) => void;
  setFitThresholds: (tightCm: number, looseCm: number) => void;
  setStrainCheck: (on: boolean) => void;
  setStrainRange: (min: number, max: number) => void;
  setStrainByFabric: (on: boolean) => void;
  setPressureCheck: (on: boolean) => void;
  setPressureMaxKpa: (maxKpa: number) => void;
  setDynamicSampling: (on: boolean) => void;
  setEditPreviewPattern: (pattern: Pattern | null) => void;
  setGradingClipboard: (delta: Vec2 | null) => void;
  setSceneRatio: (r: number) => void;
  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  toggleOutliner: (id: string) => void;
  setExpandedOutliner: (ids: string[]) => void;
  setPropTab: (t: PropTab) => void;
  setDisplayMode: (m: DisplayMode) => void;
  setFill: (m: SurfaceMode) => void;
  setAux: (aux: AuxState) => void;
  setBackend: (m: RenderBackend) => void;

  setCameraProjection: (p: CameraProjection) => void;
  requestFit: () => void;
  requestRepaint: () => void;
  setTrimKind: (k: TrimKind) => void;
  bumpRefObjects: () => void;
  setAssetTab: (t: AssetTab) => void;
  toggleAssetPanel: () => void;
  toggleScenePanel: () => void;
  togglePropertiesPanel: () => void;
  toggleTimeline: () => void;
  setPlaybackChannel: (c: PlaybackChannel) => void;
  toggleLinkChannels: () => void;
  togglePerfPanel: () => void;
  setAutoSaveSeconds: (s: number) => void;
  setMeasure3d: (r: MeasureReadout | null) => void;
  setDragForce3d: (r: DragForceReadout | null) => void;
  setLastAutosaveAt: (at: string | null) => void;
  showToast: (text: string) => void;
  dismissToast: () => void;
  balancePanes: () => void;
}

export function displayModeOf(state: {
  fill: SurfaceMode; backend: RenderBackend;
  fitCheck: boolean; strainCheck: boolean; pressureCheck: boolean;
}): DisplayMode {
  if (state.pressureCheck) return 'pressureHeatmap';
  if (state.fitCheck) return 'fitHeatmap';
  if (state.strainCheck) return 'strainHeatmap';
  return presetOf(state.fill, state.backend).id as DisplayMode;
}

export function isSplitLayout(layout: ViewLayout): boolean {
  return layout === 'split3d2d' || layout === 'split2d3d';
}

export function leftPaneOf(layout: ViewLayout): PaneId {
  if (layout === 'split2d3d') return '2d';
  if (layout === 'split3d2d') return '3d';
  return layout;
}

export function toolPane(tool: ToolType): PaneId {
  return tool === 'pin' || tool === 'unpin' || tool === 'sketch3d' || tool === 'measure3d' ? '3d' : '2d';
}

export function is3DFocus(layout: ViewLayout, focus: PaneId): boolean {
  return layout === '3d' || (isSplitLayout(layout) && focus === '3d');
}

export function is2DFocus(layout: ViewLayout, focus: PaneId): boolean {
  return layout === '2d' || (isSplitLayout(layout) && focus === '2d');
}

export function isRightPanelShown(state: { showScenePanel: boolean; showPropertiesPanel: boolean }): boolean {
  return state.showScenePanel || state.showPropertiesPanel;
}

function selectionState(ids: string[]): { selection: string[]; propTab?: PropTab } {
  return ids.length === 1 && ids[0] === FLOOR_NODE_ID
    ? { selection: ids, propTab: 'transform' }
    : { selection: ids };
}

useUIStore.subscribe(state => writePrefs(pickPrefs(state)));
