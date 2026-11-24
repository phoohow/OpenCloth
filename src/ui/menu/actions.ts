import type { Command } from '@/commands';
import type { CameraProjection, EditPreviewTier, Project } from '@/model/types';
import type { GarmentEngine, CameraPreset, Viewport } from '@/runtime';
import type { DisplayMode, PaneId, PropTab, ToolType, ViewLayout } from '@/store';
import type { ProductionOutputKind } from '@/ui/menu/production';
import type { DisplayOptions } from '@/ui/viewport2D/render';
import type { MutableRefObject } from 'react';

import { createProjectService } from '@/app';
import {
  capturePanels, PastePanelsCommand, CompositeCommand, DeleteElementsCommand,
  DeleteSelectionCommand,
} from '@/commands';
import { recordCanvasToWebM, downloadBytes, sequenceArchive } from '@/io/exporters';
import { isSplitLayout, useProjectStore, useSimStore, useUIStore } from '@/store';
import { useMenuStore } from '@/ui/menu/menuStore';
import {
  importAvatarViaPicker, importEnvironmentViaPicker, importReferenceViaPicker, openFilePicker,
} from '@/ui/modelImport';
import { importTemplatesViaPicker, saveCurrentPatternAsTemplate } from '@/ui/patternTemplateIo';
import { resetPlayback, stepPlayback, togglePlayback } from '@/ui/playbackControl';
import { setPanelsVisible, commitClearReferences, commitEnvironmentSource } from '@/ui/sceneCommands';
import { renderCapture, type CaptureRequest, type CaptureViewport } from '@/ui/screenshot';
import { askConfirm } from '@/ui/widgets/askDialog';
import { notify, reportActionError } from '@/ui/widgets/toast';

const projectService = createProjectService({
  project: () => useProjectStore.getState().project,
  load: loaded => useProjectStore.getState().loadProject(loaded),
  canUndo: () => useProjectStore.getState().history.canUndo,
  execute: command => useProjectStore.getState().executeCommand(command),
  setProjectName: name => useProjectStore.getState().setProjectName(name),
  autoSaveSeconds: () => useUIStore.getState().autoSaveSeconds,
  setAutoSaveSeconds: seconds => useUIStore.getState().setAutoSaveSeconds(seconds),
  setRecent: list => useProjectStore.getState().setRecent(list),
  setAutosaves: list => useProjectStore.getState().setAutosaves(list),
  setLastAutosaveAt: at => useUIStore.getState().setLastAutosaveAt(at),
  pickFiles: (accept, multiple) => openFilePicker(accept, multiple),
  confirm: message => askConfirm({ title: message }),
  notify,
});

interface MenuActionContext {
  engineRef: MutableRefObject<GarmentEngine | null>;
  rendererRef: MutableRefObject<Viewport | null>;
  projectInputRef: MutableRefObject<HTMLInputElement | null>;
}

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
  openIntegration: () => void;
  resetEnvironment: () => void;
  clearReferences: () => void;
  exportGlb: () => void;
  exportObj: () => void;
  exportFbx: () => void;
  exportUsd: () => void;
  screenshot: () => void;
  openDebugScreenshot: (viewport: CaptureViewport) => void;
  debugFrame: (request: CaptureRequest) => Promise<Blob | null>;
  exportAnimation: () => void;
  exportSequence: () => void;
  openProduction: (kind?: ProductionOutputKind) => void;
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

type ShortcutActions = Record<string, () => void>;

function project(): Project {
  return useProjectStore.getState().project;
}

function selectedPanelIds(): string[] {
  const pattern = project().pattern;
  return useUIStore.getState().selection.filter(id => !!pattern.panels[id]);
}

function allPanelIds(): string[] {
  return Object.keys(project().pattern.panels);
}

function withEngine(actions: MenuActionContext, fn: (engine: GarmentEngine) => void): void {
  const engine = actions.engineRef.current;
  if (!engine) { notify('引擎未就绪'); return; }
  fn(engine);
}

export function refreshRecentList(): void {
  projectService.refreshRecent();
}

export function refreshAutosaveList(): void {
  projectService.refreshAutosaveList();
}

export function writeAutosave(): Promise<void> {
  return projectService.writeAutosave();
}

export function restoreAutosaveOnStartup(): void {
  projectService.restoreAutosaveOnStartup();
}

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
    saveTemplateFile: () => void saveCurrentPatternAsTemplate(),
    openReview: () => useMenuStore.getState().openDialog('review'),
    openIntegration: () => useMenuStore.getState().openDialog('integration'),
    resetEnvironment: () => commitEnvironmentSource('builtin'),
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
    openDebugScreenshot: viewport => useMenuStore.getState().openDialog('screenshot', viewport),
    debugFrame: request => renderCapture(refs.rendererRef.current, request),
    exportAnimation: () => {
      const viewport = refs.rendererRef.current;
      if (!viewport) return;
      notify('开始录制 5 秒动画');
      void recordCanvasToWebM(viewport.canvas, `${project().meta.name}.webm`).then(result => {
        if (result === 'unsupported') notify('当前浏览器不支持画布录制');
      });
    },
    exportSequence: () => {
      const engine = refs.engineRef.current;
      if (!engine) return;
      const frames = engine.simulationFrames();
      if (frames.length === 0) { notify('还没有可导出的模拟帧，请先播放模拟。'); return; }
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
    playPause: () => togglePlayback(refs.engineRef),
    stepFrame: () => stepPlayback(refs.engineRef),
    resetSim: () => resetPlayback(refs.engineRef),

    toggleAssetPanel: () => useUIStore.getState().toggleAssetPanel(),
    toggleScenePanel: () => useUIStore.getState().toggleScenePanel(),
    togglePropertiesPanel: () => useUIStore.getState().togglePropertiesPanel(),
    toggleTimeline: () => useUIStore.getState().toggleTimeline(),
    togglePerfPanel: () => useUIStore.getState().togglePerfPanel(),

    showShortcuts: () => useMenuStore.getState().openDialog('shortcuts'),
    showAbout: () => useMenuStore.getState().openDialog('about'),
  };
}

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
    perfPanel: actions.togglePerfPanel,
    debug3d: () => actions.openDebugScreenshot('3d'),
  };
}

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
