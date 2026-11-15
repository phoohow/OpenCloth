import type { MutableRefObject } from 'react';
import { isSplitLayout, useProjectStore, useSimStore, useUIStore } from '@/store';
import type { AssetTab, DisplayMode, PaneId, PropTab, ToolType, ViewLayout } from '@/store';
import type { DisplayOptions } from '@/ui/viewport2D/render';
import { recordCanvasToWebM } from '@/io/exporters';
import { downloadBytes, sequenceArchive } from '@/io/exporters';
import { capturePanels, PastePanelsCommand } from '@/commands';
import { CompositeCommand, DeleteElementsCommand, DeleteSelectionCommand } from '@/commands';
import type { Command } from '@/commands';
import { setPanelsVisible, commitClearReferences, commitEnvironmentReset } from '@/ui/sceneCommands';
import { importAvatarViaPicker, importEnvironmentViaPicker, importReferenceViaPicker, openFilePicker } from '@/ui/modelImport';
import { useMenuStore } from '@/ui/menu/menuStore';
import type { ProductionKind } from '@/ui/menu/production';
import type { GarmentEngine, CameraPreset } from '@/runtime';
import type { Viewport } from '@/runtime';
import type { CameraProjection, EditPreviewTier, Project } from '@/model/types';
import { reportActionError } from '@/ui/widgets/toast';
import { importTemplatesViaPicker, saveCurrentPatternAsTemplate } from '@/ui/patternTemplateIo';
import { exportDebugScreenshot, type ScreenshotRequest } from '@/ui/debug/screenshot';
import { createProjectService } from '@/runtime';

interface MenuActionContext {
  engineRef: MutableRefObject<GarmentEngine | null>;
  rendererRef: MutableRefObject<Viewport | null>;
  /** Hidden file input owned by the app; the Open action routes through it. */
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
  restoreAutosave: (id?: string) => void;
  saveSnapshotNow: () => void;
  setAutoSaveSeconds: (seconds: number) => void;
  importAvatar: () => void;
  importReference: () => void;
  importEnvironment: () => void;
  importDxf: () => void;
  importAstm: () => void;
  importGerber: () => void;
  importHpgl: () => void;
  importPdf: () => void;
  importPatternJson: () => void;
  importTemplateFile: () => void;
  saveTemplateFile: () => void;
  openReview: () => void;
  openAssets: (tab: AssetTab) => void;
  openIntegration: () => void;
  resetEnvironment: () => void;
  clearReferences: () => void;
  exportGlb: () => void;
  exportObj: () => void;
  exportFbx: () => void;
  exportUsd: () => void;
  screenshot: () => void;
  openDebugScreenshot: () => void;
  debugScreenshot: (request: ScreenshotRequest) => Promise<string | null>;
  exportAnimation: () => void;
  exportSequence: () => void;
  openProduction: (kind?: ProductionKind) => void;
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
  setDisplayMode: (mode: DisplayMode) => void;
  setEditPreview: (tier: EditPreviewTier) => void;
  setDisplayOption: (key: keyof DisplayOptions, value: boolean) => void;
  setTool: (tool: ToolType) => void;
  clearPins: () => void;
  rebuildCloth: () => void;
  openPropTab: (tab: PropTab) => void;
  dress: () => void;
  playPause: () => void;
  stepFrame: () => void;
  resetSim: () => void;
  toggleAssetPanel: () => void;
  toggleScenePanel: () => void;
  togglePropertiesPanel: () => void;
  toggleTimeline: () => void;
  togglePerfPanel: () => void;
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

/** Project lifecycle bound to the project store's history and the UI store's preferences. */
const projectService = createProjectService({
  project: () => useProjectStore.getState().project,
  load: loaded => useProjectStore.getState().loadProject(loaded),
  canUndo: () => useProjectStore.getState().history.canUndo,
  execute: command => useProjectStore.getState().executeCommand(command),
  autoSaveSeconds: () => useUIStore.getState().autoSaveSeconds,
  setAutoSaveSeconds: seconds => useUIStore.getState().setAutoSaveSeconds(seconds),
  setRecent: list => useProjectStore.getState().setRecent(list),
  setAutosaves: list => useProjectStore.getState().setAutosaves(list),
  setLastAutosaveAt: at => useUIStore.getState().setLastAutosaveAt(at),
  pickFiles: (accept, multiple) => openFilePicker(accept, multiple),
  confirm: message => window.confirm(message),
  prompt: (message, initial) => window.prompt(message, initial),
  alert: message => window.alert(message),
});

/** Reads the stored list into the store that backs the File ▸ Recent submenu. */
export function refreshRecentList(): void {
  projectService.refreshRecent();
}

/** Reads the stored snapshot list into the store that backs the File ▸ Autosave submenu. */
export function refreshAutosaveList(): void {
  projectService.refreshAutosaveList();
}

/** Writes the current project into a new autosave snapshot and refreshes the snapshot list. */
export function writeAutosave(): Promise<void> {
  return projectService.writeAutosave();
}

/** Restores the newest autosave once per page load so a reload keeps the last session. */
export function restoreAutosaveOnStartup(): void {
  projectService.restoreAutosaveOnStartup();
}

/** Builds the action set; refs are read on demand so the closures stay valid across re-renders. */
export function createMenuActions(refs: MenuActionContext): MenuActions {
  return {
    newProject: projectService.newProject,
    openProject: () => refs.projectInputRef.current?.click(),
    openProjectFile: projectService.openProjectFile,
    saveProject: projectService.saveProject,
    saveProjectAs: projectService.saveProjectAs,
    reopenRecent: projectService.reopenRecent,
    refreshRecent: projectService.refreshRecent,
    clearRecentList: projectService.clearRecentList,
    restoreAutosave: projectService.restoreAutosave,
    saveSnapshotNow: projectService.saveSnapshotNow,
    setAutoSaveSeconds: projectService.setAutoSaveSeconds,

    importAvatar: () => void importAvatarViaPicker(),
    importReference: () => withEngine(refs, engine => void importReferenceViaPicker(engine)),
    importEnvironment: () => void importEnvironmentViaPicker(),
    importDxf: projectService.importDxf,
    importAstm: projectService.importAstm,
    importGerber: projectService.importGerber,
    importHpgl: projectService.importHpgl,
    importPdf: projectService.importPdf,
    importPatternJson: projectService.importPatternJson,
    importTemplateFile: () => void importTemplatesViaPicker(),
    saveTemplateFile: saveCurrentPatternAsTemplate,
    openReview: () => useMenuStore.getState().openDialog('review'),
    openAssets: (tab) => {
      const ui = useUIStore.getState();
      ui.setAssetTab(tab);
      if (!ui.showAssetPanel) ui.toggleAssetPanel();
    },
    openIntegration: () => useMenuStore.getState().openDialog('integration'),
    resetEnvironment: () => commitEnvironmentReset(),
    clearReferences: () => commitClearReferences(),

    exportGlb: () => void exportScene(refs, 'glb', 'glb', 'model/gltf-binary'),
    exportObj: () => void exportScene(refs, 'obj', 'obj', 'text/plain'),
    exportFbx: () => void exportScene(refs, 'fbx', 'fbx', 'application/octet-stream'),
    exportUsd: () => void exportScene(refs, 'usd', 'usda', 'text/plain'),
    screenshot: () => {
      const viewport = refs.rendererRef.current;
      if (!viewport) return;
      exportScreenshot(viewport.canvas, `${project().meta.name}.png`);
    },
    openDebugScreenshot: () => useMenuStore.getState().openDialog('screenshot'),
    debugScreenshot: request => exportDebugScreenshot(refs.rendererRef.current, request),
    exportAnimation: () => {
      const viewport = refs.rendererRef.current;
      if (!viewport) return;
      alert('开始录制 5 秒动画');
      // The viewport keeps drawing each frame, so a paused simulation records its current state.
      void recordCanvasToWebM(viewport.canvas, `${project().meta.name}.webm`).then(result => {
        if (result === 'unsupported') alert('当前浏览器不支持画布录制');
      });
    },
    exportSequence: () => {
      const engine = refs.engineRef.current;
      if (!engine) return;
      const frames = engine.simulationFrames();
      if (frames.length === 0) { alert('还没有可导出的模拟帧，请先播放模拟。'); return; }
      const indices = engine.clothIndices();
      if (!indices) return;
      downloadBytes(`${project().meta.name}-模拟序列.zip`, sequenceArchive(frames, indices), 'application/zip');
    },
    openProduction: kind => useMenuStore.getState().openDialog('production', kind),

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
      const rows = useUIStore.getState().selection;
      const panels = selectedPanelIds();
      const elements = rows.filter(row => !panels.includes(row));
      const cmds: Command[] = [];
      if (panels.length > 0) cmds.push(new DeleteSelectionCommand(panels));
      if (elements.length > 0) cmds.push(new DeleteElementsCommand(elements));
      if (cmds.length === 0) return;
      const cmd = cmds.length === 1 ? cmds[0]! : new CompositeCommand('删除选中', cmds);
      try {
        useProjectStore.getState().executeCommand(cmd);
        useUIStore.getState().clearSelection();
      } catch (err) {
        reportActionError(err, '删除失败');
      }
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
    setDisplayMode: mode => useUIStore.getState().setDisplayMode(mode),
    setEditPreview: tier => useUIStore.getState().setEditPreview(tier),
    setDisplayOption: (key, value) => useUIStore.getState().setDisplayOption(key, value),
    setTool: tool => useUIStore.getState().setTool(tool),
    clearPins: () => {
      const engine = refs.engineRef.current;
      if (!engine) return;
      void engine.clearPins().then(() => useSimStore.getState().bumpPins());
    },
    rebuildCloth: () => {
      const engine = refs.engineRef.current;
      if (!engine) return;
      void engine.initSimulator(project()).then(() => {
        engine.resetSimulation();
        useSimStore.getState().reset();
        useSimStore.getState().bumpPins();
      });
    },
    openPropTab: tab => useUIStore.getState().setPropTab(tab),

    dress: () => withEngine(refs, engine => {
      void engine.beginDress(project()).then(ok => { if (ok) useSimStore.getState().play(); });
    }),
    playPause: () => useSimStore.getState().togglePlay(),
    stepFrame: () => useSimStore.getState().step(),
    resetSim: () => {
      useSimStore.getState().reset();
      refs.engineRef.current?.resetSimulation();
    },

    toggleAssetPanel: () => useUIStore.getState().toggleAssetPanel(),
    toggleScenePanel: () => useUIStore.getState().toggleScenePanel(),
    togglePropertiesPanel: () => useUIStore.getState().togglePropertiesPanel(),
    toggleTimeline: () => useUIStore.getState().toggleTimeline(),
    togglePerfPanel: () => useUIStore.getState().togglePerfPanel(),

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
    dress: actions.dress,
    playPause: actions.playPause,
    stepFrame: actions.stepFrame,
    resetSim: actions.resetSim,
    gizmoTranslate: () => useUIStore.getState().setTransformMode('translate'),
    gizmoRotate: () => useUIStore.getState().setTransformMode('rotate'),
    gizmoScale: () => useUIStore.getState().setTransformMode('scale'),
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


/** Exports the scene through the viewport and downloads the bytes. */
async function exportScene(
  refs: MenuActionContext,
  format: 'glb' | 'obj' | 'fbx' | 'usd',
  extension: string,
  mime: string,
): Promise<void> {
  const viewport = refs.rendererRef.current;
  if (!viewport) return;
  const bytes = await viewport.exportScene(format, { includeAvatar: false });
  const name = `${useProjectStore.getState().project.meta.name}.${extension}`;
  downloadBytes(name, new Uint8Array(bytes), mime);
}

/** Saves the canvas as a PNG. */
function exportScreenshot(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}
