import type { MutableRefObject } from 'react';
import { isSplitLayout, useProjectStore, useSimStore, useUIStore } from '../../store/stores';
import type { DisplayMode, PaneId, PropTab, ToolType, ViewLayout } from '../../store/stores';
import type { DisplayOptions } from '../viewport2D/render';
import { createBlankProject } from '../../pattern/template';
import { projectCodec, downloadTextFile, readFileAsText } from '../../io/codec';
import { embedProjectAssets } from '../../io/projectPackage';
import { exportGLB, exportOBJ, exportFBX, exportUSD, exportScreenshot } from '../../io/exporter';
import { markerGerber, markerHpgl } from '../../io/cutExport';
import { recordCanvasToWebM } from '../../io/animationExporter';
import { downloadBytes, sequenceArchive } from '../../io/sequenceExport';
import { clearRecent, listAutosaves, listRecent, pruneOrphanBlobs, pushRecent, readAutosave, readRecent, saveAutosave, type RecentSummary } from '../../io/projectArchive';
import { capturePanels, PastePanelsCommand } from '../../core/command/panelClipboard';
import { CompositeCommand, DeleteElementsCommand, DeleteSelectionCommand } from '../../core/command/patternCommands';
import type { Command } from '../../core/command/command';
import { setPanelsVisible, commitClearReferences, commitEnvironmentReset } from '../sceneCommands';
import { importAvatarViaPicker, importEnvironmentViaPicker, importReferenceViaPicker, openFilePicker } from '../modelImport';
import { parsePatternDxf } from '../../io/dxf/reader';
import { parseGerberPattern } from '../../io/import/gerber';
import { parseHpglPattern } from '../../io/import/hpgl';
import { parsePdfPattern } from '../../io/import/pdfPaths';
import { patternFromJson } from '../../pattern/auto/aiContract';
import { useMenuStore } from './menuStore';
import type { GarmentEngine, CameraPreset } from '../../core/engine/garmentEngine';
import { renderScene } from '../../render/renderer/rendererContext';
import type { RendererContext } from '../../render/renderer/rendererContext';
import type { CameraProjection, EditPreviewTier, Pattern, Project } from '../../core/model/types';
import { reportActionError } from '../widgets/toast';

interface MenuActionContext {
  engineRef: MutableRefObject<GarmentEngine | null>;
  ctxRef: MutableRefObject<RendererContext | null>;
  /** Hidden file input owned by the app; 打开… routes through it. */
  projectInputRef: MutableRefObject<HTMLInputElement | null>;
}

/** Guards the startup restore against React's double effect run. */
let startupRestoreStarted = false;

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

/** Replaces the project pattern in one undoable step. */
function commitPatternReplace(next: Pattern, label: string): void {
  let before: Pattern | null = null;
  useProjectStore.getState().executeCommand({
    label,
    execute(ctx) { before = structuredClone(ctx.project.pattern); ctx.project.pattern = next; },
    undo(ctx) { if (before) ctx.project.pattern = before; },
  });
}

/** Picks a pattern file, parses it and swaps it into the project; failures alert. */
async function importPatternFile(accept: string, parse: (text: string) => Pattern, label: string, hint: string): Promise<void> {
  const files = await openFilePicker(accept, false);
  const file = files?.[0];
  if (!file) return;
  try {
    commitPatternReplace(parse(await readFileAsText(file)), label);
  } catch (err) {
    alert(hint + (err as Error).message);
  }
}

/** Picks a binary pattern file, parses it and swaps it into the project; failures alert. */
async function importBinaryPatternFile(
  accept: string, parse: (bytes: Uint8Array) => Promise<Pattern>, label: string, hint: string,
): Promise<void> {
  const files = await openFilePicker(accept, false);
  const file = files?.[0];
  if (!file) return;
  try {
    commitPatternReplace(await parse(new Uint8Array(await file.arrayBuffer())), label);
  } catch (err) {
    alert(hint + (err as Error).message);
  }
}

/** Reads the stored list into the store that backs 文件 ▸ 最近. */
export function refreshRecentList(): void {
  void listRecent().then((recent: RecentSummary[]) => useProjectStore.getState().setRecent(recent));
}

/** Reads the stored snapshot list into the store that backs 文件 ▸ 自动保存. */
export function refreshAutosaveList(): void {
  void listAutosaves().then(list => useProjectStore.getState().setAutosaves(list));
}

/** Writes the current project into a new autosave snapshot and refreshes the snapshot list. */
export async function writeAutosave(): Promise<void> {
  const snapshot = project();
  const record = await saveAutosave(snapshot);
  if (!record) return;
  useUIStore.getState().setLastAutosaveAt(record.savedAt);
  refreshAutosaveList();
}

/** Restores the newest autosave once per page load so a reload keeps the last session. */
export function restoreAutosaveOnStartup(): void {
  if (startupRestoreStarted) return;
  startupRestoreStarted = true;
  if (useUIStore.getState().autoSaveSeconds <= 0) return;
  void readAutosave().then(record => {
    if (!record) return;
    useUIStore.getState().setLastAutosaveAt(record.savedAt);
    if (useProjectStore.getState().history.canUndo) return;
    try {
      adopt(projectCodec.decode(record.json));
    } catch {
      // A corrupt snapshot leaves the starter project in place.
    }
  });
}

/** Builds the action set; refs are read on demand so the closures stay valid across re-renders. */
export function createMenuActions(refs: MenuActionContext): MenuActions {
  const saveToJson = (name: string) => {
    void (async () => {
      const plain = project();
      const snapshot = await embedProjectAssets(plain);
      downloadTextFile(`${name}.ocproj.json`, projectCodec.encode(snapshot));
      await pushRecent(plain);
      refreshRecentList();
    })().catch(err => alert('保存工程失败：' + (err as Error).message));
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
      adopt(createBlankProject());
      // Snapshot the blank project so a reload restores it instead of the previous session.
      if (useUIStore.getState().autoSaveSeconds > 0) void writeAutosave();
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
    restoreAutosave: (id?: string) => {
      if (!confirmDiscard()) return;
      void readAutosave(id).then(record => {
        if (!record) { alert('该自动保存快照已不在本地存档中。'); return; }
        loadText(record.json);
      });
    },
    saveSnapshotNow: () => void writeAutosave(),
    setAutoSaveSeconds: (seconds: number) => useUIStore.getState().setAutoSaveSeconds(seconds),

    importAvatar: () => void importAvatarViaPicker(),
    importReference: () => withEngine(refs, engine => void importReferenceViaPicker(engine)),
    importEnvironment: () => void importEnvironmentViaPicker(),
    importDxf: () => void importPatternFile('.dxf', text => parsePatternDxf(text), '导入 DXF 版型', '导入 DXF 失败：'),
    importAstm: () => void importPatternFile('.dxf', text => parsePatternDxf(text, { convention: 'ASTM' }), '导入 ASTM DXF 版型', '导入 ASTM DXF 失败：'),
    importGerber: () => void importPatternFile('.gbr,.ger,.gtl,.gbl,.gko', text => parseGerberPattern(text), '导入 Gerber 版型', '导入 Gerber 失败：'),
    importHpgl: () => void importPatternFile('.plt,.hpgl,.hp,.hpg', text => parseHpglPattern(text), '导入 PLT 绘图', '导入 PLT 失败：'),
    importPdf: () => void importBinaryPatternFile('.pdf', bytes => parsePdfPattern(bytes), '导入 PDF 版型', '导入 PDF 版型失败：'),
    importPatternJson: () => void importPatternFile('.json', patternFromJson, '导入 JSON 版型', '导入 JSON 版型失败：'),
    openReview: () => useMenuStore.getState().openDialog('review'),
    openAssets: () => useMenuStore.getState().openDialog('assets'),
    openIntegration: () => useMenuStore.getState().openDialog('integration'),
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
    exportFbx: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      exportFBX(ctx.scene, `${project().meta.name}.fbx`, { includeAvatar: false, includeMaterial: false });
    },
    exportUsd: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      exportUSD(ctx.scene, `${project().meta.name}.usda`, { includeAvatar: false, includeMaterial: false });
    },
    screenshot: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      renderScene(ctx);
      exportScreenshot(ctx.canvas, `${project().meta.name}.png`);
    },
    exportAnimation: () => {
      const ctx = refs.ctxRef.current;
      if (!ctx) return;
      alert('开始录制 5 秒动画…');
      // The viewport keeps drawing each frame, so a paused simulation records its current state.
      void recordCanvasToWebM(ctx.canvas, `${project().meta.name}.webm`).then(result => {
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
