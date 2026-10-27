import type { MutableRefObject } from 'react';
import { isSplitLayout, useProjectStore, useSimStore, useUIStore } from '../../store/stores';
import type { PaneId, PropTab, ViewLayout } from '../../store/stores';
import { createStarterProject } from '../../pattern/template';
import { projectCodec, downloadTextFile, readFileAsText } from '../../io/codec';
import { exportGLB, exportOBJ, exportScreenshot } from '../../io/exporter';
import { clearRecent, listRecent, pruneOrphanBlobs, pushRecent, readAutosave, readRecent, saveAutosave, type RecentSummary } from '../../io/projectArchive';
import { capturePanels, PastePanelsCommand } from '../../core/command/panelClipboard';
import { DeleteSelectionCommand } from '../../core/command/patternCommands';
import { setPanelsVisible, commitClearReferences, commitEnvironmentReset } from '../sceneCommands';
import { importAvatarViaPicker, importEnvironmentViaPicker, importReferenceViaPicker } from '../modelImport';
import { useMenuStore } from './menuStore';
import type { GarmentEngine, CameraPreset } from '../../core/engine/garmentEngine';
import { renderScene } from '../../render/renderer/rendererContext';
import type { RendererContext } from '../../render/renderer/rendererContext';
import type { CameraProjection, Project } from '../../core/model/types';

interface MenuActionContext {
  engineRef: MutableRefObject<GarmentEngine | null>;
  ctxRef: MutableRefObject<RendererContext | null>;
  /** Hidden file input owned by the app; 打开… routes through it. */
  projectInputRef: MutableRefObject<HTMLInputElement | null>;
}

/** Everything the menu bar and the shortcut handler can invoke, built once with the engine refs. */
export interface MenuActions {
  newProject: () => void;
  openProject: () => void;
  openProjectFile: (file: File) => void;
  saveProject: () => void;
  saveProjectAs: () => void;
  reopenRecent: (id: string) => void;
  refreshRecent: () => void;
  clearRecentList: () => void;
  restoreAutosave: () => void;
  saveSnapshotNow: () => void;
  setAutoSaveSeconds: (seconds: number) => void;
  importAvatar: () => void;
  importReference: () => void;
  importEnvironment: () => void;
  resetEnvironment: () => void;
  clearReferences: () => void;
  exportGlb: () => void;
  exportObj: () => void;
  screenshot: () => void;
  undo: () => void;
  redo: () => void;
  copySelection: () => void;
  pasteClipboard: () => void;
  deleteSelection: () => void;
  selectAllPanels: () => void;
  clearSelection: () => void;
  showAllPanels: () => void;
  hideUnselected: () => void;
  hideSelected: () => void;
  setLayout: (layout: ViewLayout) => void;
  toggleFocus: () => void;
  setFocus: (pane: PaneId) => void;
  fitView: () => void;
  balancePanes: () => void;
  camera: (preset: CameraPreset) => void;
  cameraProjection: (projection: CameraProjection) => void;
  openPropTab: (tab: PropTab) => void;
  drape: () => void;
  playPause: () => void;
  stepFrame: () => void;
  resetSim: () => void;
  toggleTemplatePanel: () => void;
  toggleScenePanel: () => void;
  togglePropertiesPanel: () => void;
  toggleTimeline: () => void;
  showShortcuts: () => void;
  showAbout: () => void;
}

/** Table consumed by the global key handler, keyed by shortcut id. */
type ShortcutActions = Record<string, () => void>;

function project(): Project {
  return useProjectStore.getState().project;
}

/** Panel ids among the current selection. */
function selectedPanelIds(): string[] {
  const pattern = project().pattern;
  return useUIStore.getState().selection.filter(id => !!pattern.panels[id]);
}

function allPanelIds(): string[] {
  return Object.keys(project().pattern.panels);
}

/** Runs with the 3D engine, warning when it has not finished initialising. */
function withEngine(actions: MenuActionContext, fn: (engine: GarmentEngine) => void): void {
  const engine = actions.engineRef.current;
  if (!engine) { alert('引擎未就绪'); return; }
  fn(engine);
}

/** Confirms before discarding edits that were not saved to a file. */
function confirmDiscard(): boolean {
  if (!useProjectStore.getState().history.canUndo) return true;
  return confirm('当前工程有未保存的修改，确定放弃吗？');
}

/** Replaces the open project, remembering it in the recent list. */
function adopt(project: Project): void {
  useProjectStore.getState().loadProject(project);
  // The old history is gone, so blobs no snapshot references can be reclaimed.
  void pruneOrphanBlobs(project);
  void pushRecent(project).then(() => refreshRecentList());
}

/** Reads the stored list into the store that backs 文件 ▸ 最近. */
export function refreshRecentList(): void {
  void listRecent().then((recent: RecentSummary[]) => useProjectStore.getState().setRecent(recent));
}

/** Writes the current project into the autosave slot. */
export async function writeAutosave(): Promise<void> {
  const snapshot = project();
  await saveAutosave(snapshot);
  useUIStore.getState().setLastAutosaveAt(new Date().toISOString());
}

/** Builds the action set; refs are read on demand so the closures stay valid across re-renders. */
export function createMenuActions(refs: MenuActionContext): MenuActions {
  const saveToJson = (name: string) => {
    const snapshot = project();
    downloadTextFile(`${name}.ocproj.json`, projectCodec.encode(snapshot));
    void pushRecent(snapshot).then(() => refreshRecentList());
  };

  const loadText = (text: string) => {
    try {
      adopt(projectCodec.decode(text));
    } catch (err) {
      alert('加载工程失败：' + (err as Error).message);
    }
  };

  return {
    newProject: () => {
      if (!confirmDiscard()) return;
      adopt(createStarterProject());
    },
    openProject: () => refs.projectInputRef.current?.click(),
    openProjectFile: (file: File) => {
      if (!confirmDiscard()) return;
      void readFileAsText(file).then(loadText);
    },
    saveProject: () => saveToJson(project().meta.name),
    saveProjectAs: () => {
      const before = project().meta.name;
      const name = prompt('工程名称', before);
      if (!name) return;
      useProjectStore.getState().executeCommand({
        label: '重命名工程',
        execute: ctx => { ctx.project.meta = { ...ctx.project.meta, name }; },
        undo: ctx => { ctx.project.meta = { ...ctx.project.meta, name: before }; },
      });
      saveToJson(name);
    },
    reopenRecent: (id: string) => {
      if (!confirmDiscard()) return;
      void readRecent(id).then(text => {
        if (!text) { alert('该工程快照已不在本地存档中。'); return; }
        loadText(text);
      });
    },
    refreshRecent: refreshRecentList,
    clearRecentList: () => {
      void clearRecent().then(refreshRecentList);
    },
    restoreAutosave: () => {
      if (!confirmDiscard()) return;
      void readAutosave().then(record => {
        if (!record) { alert('还没有自动保存的快照。'); return; }
        loadText(record.json);
      });
    },
    saveSnapshotNow: () => void writeAutosave(),
    setAutoSaveSeconds: (seconds: number) => useUIStore.getState().setAutoSaveSeconds(seconds),

    importAvatar: () => void importAvatarViaPicker(),
    importReference: () => withEngine(refs, engine => void importReferenceViaPicker(engine)),
    importEnvironment: () => void importEnvironmentViaPicker(),
    resetEnvironment: () => commitEnvironmentReset(),
    clearReferences: () => commitClearReferences(),

    exportGlb: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      void exportGLB(ctx.scene, `${project().meta.name}.glb`, { includeAvatar: false, includeMaterial: true });
    },
    exportObj: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      exportOBJ(ctx.scene, `${project().meta.name}.obj`, { includeAvatar: false, includeMaterial: true });
    },
    screenshot: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      renderScene(ctx);
      exportScreenshot(ctx.canvas, `${project().meta.name}.png`);
    },

    undo: () => useProjectStore.getState().undo(),
    redo: () => useProjectStore.getState().redo(),
    copySelection: () => {
      const clip = capturePanels(project().pattern, selectedPanelIds());
      if (!clip) return;
      useProjectStore.getState().setClipboard(clip);
    },
    pasteClipboard: () => {
      const clip = useProjectStore.getState().clipboard;
      if (!clip) return;
      const cmd = new PastePanelsCommand(clip);
      useProjectStore.getState().executeCommand(cmd);
      useUIStore.getState().select(cmd.pastedPanelIds);
    },
    deleteSelection: () => {
      const ids = selectedPanelIds();
      if (ids.length === 0) return;
      useProjectStore.getState().executeCommand(new DeleteSelectionCommand(ids));
      useUIStore.getState().clearSelection();
    },
    selectAllPanels: () => useUIStore.getState().select(allPanelIds()),
    clearSelection: () => useUIStore.getState().clearSelection(),
    showAllPanels: () => setPanelsVisible(allPanelIds(), true),
    hideUnselected: () => {
      const keep = new Set(selectedPanelIds());
      const hidden = allPanelIds().filter(id => !keep.has(id) && project().pattern.panels[id]?.visible);
      setPanelsVisible(hidden, false);
    },
    hideSelected: () => setPanelsVisible(selectedPanelIds(), false),

    setLayout: layout => useUIStore.getState().setLayout(layout),
    toggleFocus: () => {
      const ui = useUIStore.getState();
      const pane = ui.focus === '3d' ? '2d' : '3d';
      if (!isSplitLayout(ui.layout) && ui.layout !== pane) return;
      ui.setFocus(pane);
    },
    setFocus: pane => useUIStore.getState().setFocus(pane),
    fitView: () => useUIStore.getState().requestFit(),
    balancePanes: () => useUIStore.getState().balancePanes(),
    camera: preset => refs.engineRef.current?.setCameraPreset(preset),
    cameraProjection: projection => useUIStore.getState().setCameraProjection(projection),
    openPropTab: tab => useUIStore.getState().setPropTab(tab),

    drape: () => withEngine(refs, engine => {
      void engine.beginDrape(project()).then(ok => { if (ok) useSimStore.getState().play(); });
    }),
    playPause: () => useSimStore.getState().togglePlay(),
    stepFrame: () => useSimStore.getState().step(),
    resetSim: () => {
      useSimStore.getState().reset();
      refs.engineRef.current?.resetSimulation();
    },

    toggleTemplatePanel: () => useUIStore.getState().toggleTemplatePanel(),
    toggleScenePanel: () => useUIStore.getState().toggleScenePanel(),
    togglePropertiesPanel: () => useUIStore.getState().togglePropertiesPanel(),
    toggleTimeline: () => useUIStore.getState().toggleTimeline(),

    showShortcuts: () => useMenuStore.getState().openDialog('shortcuts'),
    showAbout: () => useMenuStore.getState().openDialog('about'),
  };
}

/** Registry mapping shortcut ids to the action that runs them. */
export function shortcutActions(actions: MenuActions): ShortcutActions {
  return {
    newProject: actions.newProject,
    openProject: actions.openProject,
    saveProject: actions.saveProject,
    saveProjectAs: actions.saveProjectAs,
    undo: actions.undo,
    redo: actions.redo,
    copyPanels: actions.copySelection,
    pastePanels: actions.pasteClipboard,
    deleteSelection: actions.deleteSelection,
    selectAll: actions.selectAllPanels,
    clearSelection: actions.clearSelection,
    layout3d2d: () => actions.setLayout('split3d2d'),
    layout2d3d: () => actions.setLayout('split2d3d'),
    layout2d: () => actions.setLayout('2d'),
    layout3d: () => actions.setLayout('3d'),
    fitView: actions.fitView,
    toggleFocus: actions.toggleFocus,
    drape: actions.drape,
    playPause: actions.playPause,
    stepFrame: actions.stepFrame,
    resetSim: actions.resetSim,
    cameraFront: () => actions.camera('front'),
    cameraBack: () => actions.camera('back'),
    cameraLeft: () => actions.camera('left'),
    cameraRight: () => actions.camera('right'),
    cameraTop: () => actions.camera('top'),
    cameraBottom: () => actions.camera('bottom'),
    cameraFrontLeft: () => actions.camera('frontLeft'),
    cameraFrontRight: () => actions.camera('frontRight'),
    cameraBackLeft: () => actions.camera('backLeft'),
    cameraBackRight: () => actions.camera('backRight'),
    shortcuts: actions.showShortcuts,
  };
}
