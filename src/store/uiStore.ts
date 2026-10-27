import { create } from 'zustand';
import type { CameraProjection, RenderMode } from '../core/model/types';
import { pickPrefs, readPrefs, writePrefs } from './prefs';

/** 2D drafting and 3D fitting tools; each pane owns a subset. */
export type ToolType = 'select' | 'point' | 'line' | 'curve' | 'internalLine' | 'dart' | 'seam' | 'pan' | 'pin' | 'unpin';
/** Properties-editor tabs, one icon in the right-hand rail. Identity and data share `object`. */
export type PropTab = 'object' | 'material' | 'physics' | 'scene' | 'render';
/** How the viewport area divides between panes. */
export type ViewLayout = 'split3d2d' | 'split2d3d' | '2d' | '3d';
/** Id of one viewport pane. */
export type PaneId = '2d' | '3d';

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
  return tool === 'pin' || tool === 'unpin' ? '3d' : '2d';
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
  /** Bumped after reference-object list changes so panels re-read the engine list. */
  refObjectsVersion: number;
  showTemplatePanel: boolean;
  showScenePanel: boolean;
  showPropertiesPanel: boolean;
  showTimeline: boolean;
  /** Autosave period in seconds; 0 turns autosave off. */
  autoSaveSeconds: number;
  /** Timestamp of the last autosave written to the local archive. */
  lastAutosaveAt: string | null;
  setLayout: (v: ViewLayout) => void;
  setSplitRatio: (r: number) => void;
  setFocus: (p: PaneId) => void;
  setTool: (t: ToolType) => void;
  select: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  setSceneRatio: (r: number) => void;
  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  toggleOutliner: (id: string) => void;
  setCollapsedOutliner: (ids: string[]) => void;
  setPropTab: (t: PropTab) => void;
  setRenderMode: (m: RenderMode) => void;
  setCameraProjection: (p: CameraProjection) => void;
  requestFit: () => void;
  bumpRefObjects: () => void;
  toggleTemplatePanel: () => void;
  toggleScenePanel: () => void;
  togglePropertiesPanel: () => void;
  toggleTimeline: () => void;
  setAutoSaveSeconds: (s: number) => void;
  setLastAutosaveAt: (at: string | null) => void;
  balancePanes: () => void;
}

const prefs = readPrefs();

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
  refObjectsVersion: 0,
  showTemplatePanel: prefs.showTemplatePanel,
  showScenePanel: prefs.showScenePanel,
  showPropertiesPanel: prefs.showPropertiesPanel,
  showTimeline: prefs.showTimeline,
  autoSaveSeconds: prefs.autoSaveSeconds,
  lastAutosaveAt: null,

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
  setRenderMode: (m) => set({ renderMode: m }),
  setCameraProjection: (p) => set({ cameraProjection: p }),
  requestFit: () => set(s => ({ fitToken: s.fitToken + 1 })),
  bumpRefObjects: () => set(s => ({ refObjectsVersion: s.refObjectsVersion + 1 })),
  toggleTemplatePanel: () => set(s => ({ showTemplatePanel: !s.showTemplatePanel })),
  toggleScenePanel: () => set(s => ({ showScenePanel: !s.showScenePanel })),
  togglePropertiesPanel: () => set(s => ({ showPropertiesPanel: !s.showPropertiesPanel })),
  toggleTimeline: () => set(s => ({ showTimeline: !s.showTimeline })),
  setAutoSaveSeconds: (s) => set({ autoSaveSeconds: s }),
  setLastAutosaveAt: (at) => set({ lastAutosaveAt: at }),
  balancePanes: () => set(s => ({
    splitRatio: 0.5,
    layout: isSplitLayout(s.layout) ? s.layout : 'split3d2d',
  })),
}));

// Persisted panel and layout choices; the store is the source of truth while running.
useUIStore.subscribe(state => writePrefs(pickPrefs(state)));
