import type { MutableRefObject } from 'react';
import { isSplitLayout, useProjectStore, useSimStore, useUIStore } from '@/store';
import type { DisplayMode, PaneId, PropTab, ToolType, ViewLayout } from '@/store';
import type { DisplayOptions } from '@/ui/viewport2D/render';
import { downloadTextFile } from '@/io/serialization';
import { exportGLB, exportOBJ, exportFBX, exportUSD, exportScreenshot } from '@/io/exporters';
import { markerGerber, markerHpgl } from '@/io/exporters';
import { recordCanvasToWebM } from '@/io/exporters';
import { downloadBytes, sequenceArchive } from '@/io/exporters';
import { capturePanels, PastePanelsCommand } from '@/commands';
import { CompositeCommand, DeleteElementsCommand, DeleteSelectionCommand } from '@/commands';
import type { Command } from '@/commands';
import { setPanelsVisible, commitClearReferences, commitEnvironmentReset } from '@/ui/sceneCommands';
import { importAvatarViaPicker, importEnvironmentViaPicker, importReferenceViaPicker, openFilePicker } from '@/ui/modelImport';
import { useMenuStore } from '@/ui/menu/menuStore';
import type { GarmentEngine, CameraPreset } from '@/runtime';
import { renderScene } from '@/render/renderer';
import type { RendererContext } from '@/render/renderer';
import type { CameraProjection, EditPreviewTier, Project } from '@/model/types';
import { reportActionError } from '@/ui/widgets/toast';
import { createProjectService } from '@/runtime';

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
  openReview: () => void;
  openAssets: () => void;
  openIntegration: () => void;
  resetEnvironment: () => void;
  clearReferences: () => void;
  exportGlb: () => void;
  exportObj: () => void;
  exportFbx: () => void;
  exportUsd: () => void;
  screenshot: () => void;
  exportAnimation: () => void;
  exportSequence: () => void;
  exportDxf: () => void;
  exportPatternSvg: () => void;
  exportPdf: () => void;
  exportTechPack: () => void;
  exportMarker: () => void;
  exportCutGerber: () => void;
  exportCutHpgl: () => void;
  exportBom: () => void;
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

/** Reads the stored list into the store that backs 文件 ▸ 最近. */
export function refreshRecentList(): void {
  projectService.refreshRecent();
}

/** Reads the stored snapshot list into the store that backs 文件 ▸ 自动保存. */
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
    openReview: () => useMenuStore.getState().openDialog('review'),
    openAssets: () => useMenuStore.getState().openDialog('assets'),
    openIntegration: () => useMenuStore.getState().openDialog('integration'),
    resetEnvironment: () => commitEnvironmentReset(),
    clearReferences: () => commitClearReferences(),

    exportGlb: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      void exportGLB(ctx.surface.scene, `${project().meta.name}.glb`, { includeAvatar: false, includeMaterial: true });
    },
    exportObj: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      exportOBJ(ctx.surface.scene, `${project().meta.name}.obj`, { includeAvatar: false, includeMaterial: true });
    },
    exportFbx: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      exportFBX(ctx.surface.scene, `${project().meta.name}.fbx`, { includeAvatar: false, includeMaterial: false });
    },
    exportUsd: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      exportUSD(ctx.surface.scene, `${project().meta.name}.usda`, { includeAvatar: false, includeMaterial: false });
    },
    screenshot: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      renderScene(ctx);
      exportScreenshot(ctx.surface.canvas, `${project().meta.name}.png`);
    },
    exportAnimation: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      alert('开始录制 5 秒动画…');
      // The viewport keeps drawing each frame, so a paused simulation records its current state.
      void recordCanvasToWebM(ctx.surface.canvas, `${project().meta.name}.webm`).then(result => {
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
    exportDxf: () => useMenuStore.getState().openDialog('exportDxf'),
    exportPatternSvg: () => useMenuStore.getState().openDialog('exportSvg'),
    exportPdf: () => useMenuStore.getState().openDialog('exportPdf'),
    exportTechPack: () => useMenuStore.getState().openDialog('exportTechPack'),
    exportMarker: () => useMenuStore.getState().openDialog('exportMarker'),
    exportCutGerber: () => {
      const current = project();
      downloadTextFile(
        `${current.meta.name}-裁床.gbr`,
        markerGerber(current.pattern, { fabricWidthCm: 150, gapCm: 0.5 }),
        'text/plain',
      );
    },
    exportCutHpgl: () => {
      const current = project();
      downloadTextFile(
        `${current.meta.name}-裁床.plt`,
        markerHpgl(current.pattern, { fabricWidthCm: 150, gapCm: 0.5 }),
        'text/plain',
      );
    },
    exportBom: () => useMenuStore.getState().openDialog('exportBom'),

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
    dress: actions.dress,
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
