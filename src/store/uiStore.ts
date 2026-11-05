import { create } from 'zustand';
import type { CameraProjection, EditPreviewTier, Pattern, RenderMode, TrimKind, Vec2 } from '../core/model/types';
import type { PatternElementKind } from '../core/model/elementRef';
import { pickPrefs, readPrefs, writePrefs } from './prefs';

/** 2D drafting and 3D fitting tools; each pane owns a subset. */
export type ToolType = 'select' | 'point' | 'deletePoint' | 'line' | 'curve' | 'internalLine' | 'dart' | 'seam' | 'pin' | 'unpin' | 'sketch3d' | 'measure3d' | 'rect' | 'circle' | 'ellipse' | 'split' | 'hole' | 'notch' | 'annotation' | 'measure' | 'topstitch' | 'trim';

/** Points placed in a pending 3D measurement, and the distance once two exist. */
export interface MeasureReadout {
  points: number;
  /** Distance between the two placed points in centimetres, or null while only one exists. */
  distanceCm: number | null;
}

/** Properties-editor tabs, one icon in the right-hand rail. Identity and data share `object`. */
export type PropTab = 'object' | 'material' | 'simulator' | 'pattern' | 'transform' | 'render' | 'project';
/** Viewport display-mode value: a render mode or one of the three cloth analysis heatmaps. */
export type DisplayMode = RenderMode | 'fitHeatmap' | 'strainHeatmap' | 'pressureHeatmap';

/** Display-mode value the viewport controls show: the active heatmap, otherwise the render mode. */
export function displayModeOf(state: {
  renderMode: RenderMode; fitCheck: boolean; strainCheck: boolean; pressureCheck: boolean;
}): DisplayMode {
  if (state.pressureCheck) return 'pressureHeatmap';
  if (state.fitCheck) return 'fitHeatmap';
  if (state.strainCheck) return 'strainHeatmap';
  return state.renderMode;
}
/** How the viewport area divides between panes. */
export type ViewLayout = 'split3d2d' | 'split2d3d' | '2d' | '3d';
/** Id of one viewport pane. */
export type PaneId = '2d' | '3d';

/** Transient message shown over the viewports; a fresh id restarts the toast on repeated text. */
export interface ToastMessage {
  id: number;
  text: string;
}

/** Layouts that show both panes side by side. */
export function isSplitLayout(layout: ViewLayout): boolean {
  return layout === 'split3d2d' || layout === 'split2d3d';
}

/** Pane on the left of a split layout; single-pane layouts return their own pane. */
export function leftPaneOf(layout: ViewLayout): PaneId {
  if (layout === 'split2d3d') return '2d';
  if (layout === 'split3d2d') return '3d';
  return layout;
}

/** Pane whose toolbar owns a tool. */
export function toolPane(tool: ToolType): PaneId {
  return tool === 'pin' || tool === 'unpin' || tool === 'sketch3d' || tool === 'measure3d' ? '3d' : '2d';
}

/** Keyboard shortcuts go to one pane at a time; a split layout tracks focus. */
export function is3DFocus(layout: ViewLayout, focus: PaneId): boolean {
  return layout === '3d' || (isSplitLayout(layout) && focus === '3d');
}

/** Whether the 2D pane owns the keyboard focus. */
export function is2DFocus(layout: ViewLayout, focus: PaneId): boolean {
  return layout === '2d' || (isSplitLayout(layout) && focus === '2d');
}

/** Whether the right column has an outliner or properties section to show. */
export function isRightPanelShown(state: { showScenePanel: boolean; showPropertiesPanel: boolean }): boolean {
  return state.showScenePanel || state.showPropertiesPanel;
}

interface UIStore {
  layout: ViewLayout;
  /** Share of the viewport area given to the left pane when the layout is a split. */
  splitRatio: number;
  focus: PaneId;
  activeTool: ToolType;
  selection: string[];
  /** Properties-editor context shown in the right panel's lower section. */
  propTab: PropTab;
  /** Share of the right panel height given to the outliner. */
  sceneRatio: number;
  /** Width of the template panel in pixels. */
  leftPanelWidth: number;
  /** Width of the outliner and properties column in pixels. */
  rightPanelWidth: number;
  /** Outliner rows whose children are hidden. */
  collapsedOutliner: string[];
  renderMode: RenderMode;
  /** Projection the 3D viewport renders with; persisted like the render mode. */
  cameraProjection: CameraProjection;
  /** Bumped to fit the pattern into the 2D pane. */
  fitToken: number;
  /** Bumped when a print image finishes decoding, so the 2D pane repaints. */
  repaintToken: number;
  /** Trim kind the 2D trim tool places. */
  trimKind: TrimKind;
  /** Layer switches for drafting-only visuals; toggles stay out of the undo history. */
  displayOptions: {
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
    /** Triangulated simulation mesh drawn over the cut pieces. */
    wireframe: boolean;
  };
  /** Bumped after reference-object list changes so panels re-read the engine list. */
  refObjectsVersion: number;
  /** Element kinds a marquee rectangle collects. Session-only. */
  marqueeKinds: PatternElementKind[];
  /** 3D fidelity the cloth follows an in-flight 2D edit with. */
  editPreview: EditPreviewTier;
  /** Shows body-clearance colours on the cloth instead of fabric materials. */
  fitCheck: boolean;
  /** Clearance below this reads as tight, in centimetres. */
  fitTightCm: number;
  /** Clearance above this reads as loose, in centimetres. */
  fitLooseCm: number;
  /** Shows per-vertex strain colours on the cloth instead of fabric materials. */
  strainCheck: boolean;
  /** Lower bound of the strain colour ramp. */
  strainMin: number;
  /** Upper bound of the strain colour ramp. */
  strainMax: number;
  /** Colours and counts strain against each fabric's own limits instead of the manual range. */
  strainByFabric: boolean;
  /** Shows estimated contact pressure colours on the cloth. */
  pressureCheck: boolean;
  /** Upper end of the pressure colour scale, in kilopascals. */
  pressureMaxKpa: number;
  /** Records one pressure sample per step while the body animation plays. */
  dynamicSampling: boolean;
  /** Pattern copy of the in-flight 2D drag; session-only transport to the 3D pane. */
  editPreviewPattern: Pattern | null;
  /** Grading delta copied from one point, pasted onto the selected points. Session-only. */
  gradingClipboard: Vec2 | null;
  showTemplatePanel: boolean;
  showScenePanel: boolean;
  showPropertiesPanel: boolean;
  showTimeline: boolean;
  /** Autosave period in seconds; 0 turns autosave off. */
  autoSaveSeconds: number;
  /** Timestamp of the last autosave written to the local archive. */
  lastAutosaveAt: string | null;
  /** Pending 3D measurement reading; null when no measurement is armed. */
  measure3d: MeasureReadout | null;
  /** Transient message over the viewports; null when none is shown. */
  toast: ToastMessage | null;
  setLayout: (v: ViewLayout) => void;
  setSplitRatio: (r: number) => void;
  setFocus: (p: PaneId) => void;
  setTool: (t: ToolType) => void;
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
  setCollapsedOutliner: (ids: string[]) => void;
  setPropTab: (t: PropTab) => void;
  setDisplayMode: (m: DisplayMode) => void;
  setRenderMode: (m: RenderMode) => void;
  setCameraProjection: (p: CameraProjection) => void;
  requestFit: () => void;
  requestRepaint: () => void;
  setTrimKind: (k: TrimKind) => void;
  bumpRefObjects: () => void;
  toggleTemplatePanel: () => void;
  toggleScenePanel: () => void;
  togglePropertiesPanel: () => void;
  toggleTimeline: () => void;
  setAutoSaveSeconds: (s: number) => void;
  setMeasure3d: (r: MeasureReadout | null) => void;
  setLastAutosaveAt: (at: string | null) => void;
  showToast: (text: string) => void;
  dismissToast: () => void;
  balancePanes: () => void;
}

const prefs = readPrefs();

/** Sequence behind `ToastMessage.id`. */
let toastSeq = 0;

/** Viewport layout, tool, selection and panel-visibility state. */
export const useUIStore = create<UIStore>((set, get) => ({
  layout: prefs.layout,
  splitRatio: prefs.splitRatio,
  focus: prefs.focus,
  activeTool: 'select',
  selection: [],
  propTab: prefs.propTab,
  sceneRatio: prefs.sceneRatio,
  leftPanelWidth: prefs.leftPanelWidth,
  rightPanelWidth: prefs.rightPanelWidth,
  collapsedOutliner: [],
  renderMode: prefs.renderMode,
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
    internal: true, darts: true, seamAllowance: false, notches: true, grain: true, annotations: true, measurements: true, gradingOverlay: false, seamJoin: false,
    prints: true, topstitches: true, trims: true, wireframe: false,
  },
  showTemplatePanel: prefs.showTemplatePanel,
  showScenePanel: prefs.showScenePanel,
  showPropertiesPanel: prefs.showPropertiesPanel,
  showTimeline: prefs.showTimeline,
  autoSaveSeconds: prefs.autoSaveSeconds,
  lastAutosaveAt: null,
  toast: null,
  measure3d: null,

  setLayout: (v) => set({ layout: v }),
  setSplitRatio: (r) => set({ splitRatio: r }),
  setFocus: (p) => set({ focus: p }),
  setTool: (t) => set({ activeTool: t, focus: toolPane(t) }),
  select: (ids) => set({ selection: ids }),
  toggleSelection: (id) => {
    const sel = get().selection;
    const next = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id];
    set({ selection: next });
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
    collapsedOutliner: s.collapsedOutliner.includes(id)
      ? s.collapsedOutliner.filter(x => x !== id)
      : [...s.collapsedOutliner, id],
  })),
  setCollapsedOutliner: (ids) => set({ collapsedOutliner: ids }),
  setPropTab: (t) => set({ propTab: t }),
  // Heatmaps replace the cloth material, and the path tracer hides that overlay, so analysis modes stay on the raster path.
  setDisplayMode: (m) => {
    if (m === 'pressureHeatmap') {
      set(s => ({ pressureCheck: true, fitCheck: false, strainCheck: false, renderMode: s.renderMode === 'raytraced' ? 'shaded' : s.renderMode }));
    } else if (m === 'fitHeatmap') {
      set(s => ({ fitCheck: true, strainCheck: false, pressureCheck: false, renderMode: s.renderMode === 'raytraced' ? 'shaded' : s.renderMode }));
    } else if (m === 'strainHeatmap') {
      set(s => ({ strainCheck: true, fitCheck: false, pressureCheck: false, renderMode: s.renderMode === 'raytraced' ? 'shaded' : s.renderMode }));
    } else {
      set({ renderMode: m, fitCheck: false, strainCheck: false, pressureCheck: false });
    }
  },
  setRenderMode: (m) => set({ renderMode: m }),
  setCameraProjection: (p) => set({ cameraProjection: p }),
  requestFit: () => set(s => ({ fitToken: s.fitToken + 1 })),
  requestRepaint: () => set(s => ({ repaintToken: s.repaintToken + 1 })),
  setTrimKind: (k) => set({ trimKind: k }),
  bumpRefObjects: () => set(s => ({ refObjectsVersion: s.refObjectsVersion + 1 })),
  toggleTemplatePanel: () => set(s => ({ showTemplatePanel: !s.showTemplatePanel })),
  toggleScenePanel: () => set(s => ({ showScenePanel: !s.showScenePanel })),
  togglePropertiesPanel: () => set(s => ({ showPropertiesPanel: !s.showPropertiesPanel })),
  toggleTimeline: () => set(s => ({ showTimeline: !s.showTimeline })),
  setAutoSaveSeconds: (s) => set({ autoSaveSeconds: s }),
  setMeasure3d: (r) => set({ measure3d: r }),
  setLastAutosaveAt: (at) => set({ lastAutosaveAt: at }),
  showToast: (text) => set({ toast: { id: ++toastSeq, text } }),
  dismissToast: () => set({ toast: null }),
  balancePanes: () => set(s => ({
    splitRatio: 0.5,
    layout: isSplitLayout(s.layout) ? s.layout : 'split3d2d',
  })),
}));

// Persisted panel and layout choices; the store is the source of truth while running.
useUIStore.subscribe(state => writePrefs(pickPrefs(state)));
