import type { PaneId, PropTab, ViewLayout } from './stores';
import type { CameraProjection, EditPreviewTier, RenderMode } from '../core/model/types';

/** Key holding the persisted UI preferences. */
export const PREFS_KEY = 'oc-ui-prefs-v2';

/** Subset of the UI store that survives a reload. */
export interface UiPrefs {
  layout: ViewLayout;
  /** Share of the viewport area given to the left pane in the split layouts. */
  splitRatio: number;
  focus: PaneId;
  propTab: PropTab;
  renderMode: RenderMode;
  /** Projection the 3D viewport renders with. */
  cameraProjection: CameraProjection;
  /** Share of the right panel height given to the outliner. */
  sceneRatio: number;
  /** Width of the template panel in pixels. */
  leftPanelWidth: number;
  /** Width of the outliner and properties column in pixels. */
  rightPanelWidth: number;
  /** 3D fidelity the cloth follows an in-flight 2D edit with. */
  editPreview: EditPreviewTier;
  // Panel visibility.
  showTemplatePanel: boolean;
  showScenePanel: boolean;
  showPropertiesPanel: boolean;
  showTimeline: boolean;
  /** Autosave period in seconds; 0 disables autosave. */
  autoSaveSeconds: number;
}

export const DEFAULT_PREFS: UiPrefs = {
  layout: 'split3d2d',
  splitRatio: 0.5,
  focus: '3d',
  propTab: 'object',
  renderMode: 'shaded',
  cameraProjection: 'perspective',
  sceneRatio: 0.5,
  leftPanelWidth: 220,
  rightPanelWidth: 280,
  editPreview: 'off',
  showTemplatePanel: true,
  showScenePanel: true,
  showPropertiesPanel: true,
  showTimeline: true,
  autoSaveSeconds: 60,
};

const LAYOUTS: ViewLayout[] = ['split3d2d', 'split2d3d', '2d', '3d'];
const PANES: PaneId[] = ['2d', '3d'];
const RENDER_MODES: RenderMode[] = ['shaded', 'raytraced', 'wireframe', 'shadedWireframe', 'uvCheck', 'normalVis'];
const CAMERA_PROJECTIONS: CameraProjection[] = ['perspective', 'orthographic'];
const PROP_TABS: PropTab[] = ['object', 'material', 'physics', 'scene', 'render'];
const EDIT_PREVIEW_TIERS: EditPreviewTier[] = ['off', 'low', 'full'];
const AUTO_SAVE_SECONDS = [0, 30, 60, 300];
/** Draggable ranges matching the divider helpers in the viewport layout. */
const SPLIT_RATIO_RANGE: [number, number] = [0.15, 0.85];
const SCENE_RATIO_RANGE: [number, number] = [0.18, 0.6];
const PANEL_WIDTH_RANGE: [number, number] = [160, 560];

/** Minimal storage surface so the read/write path is testable without a browser. */
export interface PreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage when available, otherwise an inert stand-in. */
function browserStorage(): PreferencesStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Access throws in privacy modes that disable storage.
  }
  return { getItem: () => null, setItem: () => { } };
}

/** Preferences read from storage; anything missing or invalid falls back to the default. */
export function readPrefs(storage: PreferencesStorage = browserStorage()): UiPrefs {
  let raw: unknown;
  try {
    const text = storage.getItem(PREFS_KEY);
    if (!text) return { ...DEFAULT_PREFS };
    raw = JSON.parse(text);
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PREFS };
  const value = raw as Record<string, unknown>;
  const flag = (key: string, fallback: boolean): boolean =>
    typeof value[key] === 'boolean' ? value[key] as boolean : fallback;

  const seconds = AUTO_SAVE_SECONDS.includes(value.autoSaveSeconds as number)
    ? value.autoSaveSeconds as number
    : DEFAULT_PREFS.autoSaveSeconds;

  return {
    layout: LAYOUTS.includes(value.layout as ViewLayout) ? value.layout as ViewLayout : DEFAULT_PREFS.layout,
    splitRatio: clampTo(value.splitRatio, SPLIT_RATIO_RANGE, DEFAULT_PREFS.splitRatio),
    focus: PANES.includes(value.focus as PaneId) ? value.focus as PaneId : DEFAULT_PREFS.focus,
    propTab: PROP_TABS.includes(value.propTab as PropTab) ? value.propTab as PropTab : DEFAULT_PREFS.propTab,
    renderMode: RENDER_MODES.includes(value.renderMode as RenderMode)
      ? value.renderMode as RenderMode
      : DEFAULT_PREFS.renderMode,
    cameraProjection: CAMERA_PROJECTIONS.includes(value.cameraProjection as CameraProjection)
      ? value.cameraProjection as CameraProjection
      : DEFAULT_PREFS.cameraProjection,
    sceneRatio: clampTo(value.sceneRatio, SCENE_RATIO_RANGE, DEFAULT_PREFS.sceneRatio),
    leftPanelWidth: clampTo(value.leftPanelWidth, PANEL_WIDTH_RANGE, DEFAULT_PREFS.leftPanelWidth),
    rightPanelWidth: clampTo(value.rightPanelWidth, PANEL_WIDTH_RANGE, DEFAULT_PREFS.rightPanelWidth),
    showTemplatePanel: flag('showTemplatePanel', DEFAULT_PREFS.showTemplatePanel),
    showScenePanel: flag('showScenePanel', DEFAULT_PREFS.showScenePanel),
    showPropertiesPanel: flag('showPropertiesPanel', DEFAULT_PREFS.showPropertiesPanel),
    showTimeline: flag('showTimeline', DEFAULT_PREFS.showTimeline),
    editPreview: EDIT_PREVIEW_TIERS.includes(value.editPreview as EditPreviewTier)
      ? value.editPreview as EditPreviewTier
      : DEFAULT_PREFS.editPreview,
    autoSaveSeconds: seconds,
  };
}

/** Number inside the persisted range; anything missing or unreadable uses the default. */
function clampTo(value: unknown, [min, max]: [number, number], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Stores the preferences, ignoring write failures from a full or unavailable storage. */
export function writePrefs(prefs: UiPrefs, storage: PreferencesStorage = browserStorage()): void {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are non-essential; a failed write must not break the session.
  }
}

/** Preferences extracted from the live UI state. */
export function pickPrefs(state: UiPrefs): UiPrefs {
  return {
    layout: state.layout,
    splitRatio: state.splitRatio,
    focus: state.focus,
    propTab: state.propTab,
    renderMode: state.renderMode,
    cameraProjection: state.cameraProjection,
    sceneRatio: state.sceneRatio,
    leftPanelWidth: state.leftPanelWidth,
    rightPanelWidth: state.rightPanelWidth,
    showTemplatePanel: state.showTemplatePanel,
    showScenePanel: state.showScenePanel,
    showPropertiesPanel: state.showPropertiesPanel,
    showTimeline: state.showTimeline,
    editPreview: state.editPreview,
    autoSaveSeconds: state.autoSaveSeconds,
  };
}
