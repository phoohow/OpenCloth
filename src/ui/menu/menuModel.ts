import { comboOf } from '@/ui/menu/shortcuts';
import { menuSep, type MenuEntry, type MenuLeaf, type TopMenu } from '@/ui/menu/menuTypes';
import type { MenuActions } from '@/ui/menu/actions';
import {
  CAMERA_PRESETS, CAMERA_PROJECTIONS, DISPLAY_LAYER_OPTIONS, DISPLAY_MODES, EDIT_PREVIEW_TIERS,
  PROP_TAB_OPTIONS,
} from '@/ui/optionTables';
import { MARK_ITEMS, STRUCTURE_ITEMS, autoPlacePanels, runStructure } from '@/ui/commands/patternOps';
import { formatSavedAt } from '@/ui/timeFormat';
import type { CameraProjection, EditPreviewTier } from '@/model/types';
import type { DisplayMode, PaneId, PropTab, ToolType, ViewLayout } from '@/store';
import { isSplitLayout } from '@/store';
import type { DisplayOptions } from '@/ui/viewport2D/render';
import type { RecentSummary, AutosaveSummary } from '@/io/storage';

export { formatSavedAt };

/** Everything the menu labels reflect; read from the stores by the menu bar. */
export interface MenuState {
  projectName: string;
  layout: ViewLayout;
  focus: PaneId;
  propTab: PropTab;
  activeTool: ToolType;
  displayMode: DisplayMode;
  editPreview: EditPreviewTier;
  displayOptions: DisplayOptions;
  cameraProjection: CameraProjection;
  showTemplatePanel: boolean;
  showScenePanel: boolean;
  showPropertiesPanel: boolean;
  showTimeline: boolean;
  autoSaveSeconds: number;
  lastAutosaveAt: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  hasClipboard: boolean;
  selectedPanelCount: number;
  selectionCount: number;
  panelCount: number;
  referenceCount: number;
  recent: RecentSummary[];
  autosaves: AutosaveSummary[];
}

/** Autosave periods offered by 文件 ▸ 自动保存, shared with the phone menu. */
export const AUTO_SAVE_ITEMS = [
  { seconds: 0, label: '关闭' },
  { seconds: 30, label: '每 30 秒' },
  { seconds: 60, label: '每 1 分钟' },
  { seconds: 300, label: '每 5 分钟' },
];

function leaf(id: string, label: string, run: () => void, state?: Partial<MenuLeaf>): MenuLeaf {
  return { kind: 'item', id, label, run, ...state };
}

/** Submenu parent that only opens its children. */
function group(id: string, label: string, children: MenuEntry[]): MenuLeaf {
  return { kind: 'item', id, label, children };
}

/** Check mark in front of a row that is currently in effect. */
const marked = (on: boolean): string => (on ? '✓ ' : '　');

/** Builds the eight dropdowns from the current state snapshot, in workflow order. */
export function buildMenus(state: MenuState, actions: MenuActions): TopMenu[] {
  const recentEntries: MenuEntry[] = state.recent.length === 0
    ? [leaf('recentEmpty', '暂无本地存档', () => {}, { disabled: true })]
    : state.recent.map(item => leaf(
      `recent:${item.id}`,
      `${item.name}  ${formatSavedAt(item.savedAt)}`,
      () => actions.reopenRecent(item.id),
    ));

  const autosaveEntries: MenuEntry[] = state.autosaves.length === 0
    ? [leaf('autosaveEmpty', '暂无快照', () => {}, { disabled: true })]
    : state.autosaves.map(item => leaf(
      `autosave:${item.id}`,
      formatSavedAt(item.savedAt),
      () => actions.restoreAutosave(item.id),
    ));

  const layoutGroup: MenuEntry[] = [
    leaf('layout3d2d', '3D 左 + 2D 右 分屏', () => actions.setLayout('split3d2d'),
      { accel: comboOf('layout3d2d'), checked: state.layout === 'split3d2d' }),
    leaf('layout2d3d', '2D 左 + 3D 右 分屏', () => actions.setLayout('split2d3d'),
      { accel: comboOf('layout2d3d'), checked: state.layout === 'split2d3d' }),
    leaf('layout3d', '仅 3D 视口', () => actions.setLayout('3d'),
      { accel: comboOf('layout3d'), checked: state.layout === '3d' }),
    leaf('layout2d', '仅 2D 制版', () => actions.setLayout('2d'),
      { accel: comboOf('layout2d'), checked: state.layout === '2d' }),
    menuSep(),
    leaf('balancePanes', '左右均分', () => actions.balancePanes(), { disabled: !isSplitLayout(state.layout) }),
    leaf('toggleFocus', `切换焦点：${state.focus === '3d' ? '3D 视口' : '2D 制版'}`,
      () => actions.toggleFocus(), { accel: comboOf('toggleFocus') }),
  ];

  return [
    {
      id: 'file',
      label: '文件',
      mnemonic: 'F',
      entries: [
        leaf('newProject', '新建工程', actions.newProject, { accel: comboOf('newProject') }),
        leaf('openProject', '打开…', actions.openProject, { accel: comboOf('openProject') }),
        leaf('saveProject', '保存', actions.saveProject, { accel: comboOf('saveProject') }),
        leaf('saveProjectAs', '另存为…', actions.saveProjectAs, { accel: comboOf('saveProjectAs') }),
        menuSep(),
        group('recent', '最近打开', [...recentEntries, menuSep(),
          leaf('clearRecent', '清除列表', actions.clearRecentList, { disabled: state.recent.length === 0 }),
        ]),
        group('autoSave', '自动保存', [
          ...AUTO_SAVE_ITEMS.map(item => leaf(
            `autoSave:${item.seconds}`,
            item.label,
            () => actions.setAutoSaveSeconds(item.seconds),
            { checked: state.autoSaveSeconds === item.seconds },
          )),
          menuSep(),
          leaf('snapshotNow', '立即保存快照', actions.saveSnapshotNow),
          menuSep(),
          ...autosaveEntries,
        ]),
        menuSep(),
        // 版型在前、模型与环境在后：先有版型才谈试衣。
        group('import', '导入', [
          leaf('importDxf', 'DXF 版型…', actions.importDxf),
          leaf('importAstm', 'ASTM DXF 版型…', actions.importAstm),
          leaf('importGerber', 'Gerber 版型…', actions.importGerber),
          leaf('importHpgl', 'PLT 版型…', actions.importHpgl),
          leaf('importPdf', 'PDF 版型…', actions.importPdf),
          leaf('importPatternJson', 'JSON 版型…', actions.importPatternJson),
          menuSep(),
          leaf('importAvatar', '模特模型…', actions.importAvatar),
          leaf('importReference', '参考物体…', actions.importReference),
          leaf('importEnvironment', '环境贴图…', actions.importEnvironment),
          menuSep(),
          leaf('resetEnvironment', '恢复内置环境', actions.resetEnvironment),
          leaf('clearReferences', '清除全部参考物体', actions.clearReferences, { disabled: state.referenceCount === 0 }),
        ]),
        group('export', '导出', [
          leaf('exportCutGerber', '生产：裁床 Gerber…', actions.exportCutGerber),
          leaf('exportCutHpgl', '生产：裁床 PLT…', actions.exportCutHpgl),
          leaf('exportDxf', '生产：DXF 版型…', actions.exportDxf),
          leaf('exportPatternSvg', '生产：SVG 平面图…', actions.exportPatternSvg),
          leaf('exportPdf', '生产：PDF 图纸…', actions.exportPdf),
          leaf('exportMarker', '生产：排料图…', actions.exportMarker),
          leaf('exportTechPack', '生产：工艺单…', actions.exportTechPack),
          leaf('exportBom', '生产：物料清单…', actions.exportBom),
          menuSep(),
          leaf('exportGlb', '模型：服装 GLB…', actions.exportGlb),
          leaf('exportObj', '模型：服装 OBJ…', actions.exportObj),
          leaf('exportFbx', '模型：服装 FBX…', actions.exportFbx),
          leaf('exportUsd', '模型：服装 USD…', actions.exportUsd),
          leaf('exportSequence', '模型：模拟序列 OBJ (ZIP)…', actions.exportSequence),
          menuSep(),
          leaf('screenshot', '图像：截图 PNG', actions.screenshot),
          leaf('exportAnimation', '图像：动画 WebM…', actions.exportAnimation),
        ]),
      ],
    },
    {
      id: 'edit',
      label: '编辑',
      mnemonic: 'E',
      entries: [
        leaf('undo', `撤销${state.undoLabel ? ` ${state.undoLabel}` : ''}`, actions.undo,
          { accel: comboOf('undo'), disabled: !state.canUndo }),
        leaf('redo', `重做${state.redoLabel ? ` ${state.redoLabel}` : ''}`, actions.redo,
          { accel: comboOf('redo'), disabled: !state.canRedo }),
        menuSep(),
        leaf('copyPanels', '复制选中版片', actions.copySelection,
          { accel: comboOf('copyPanels'), disabled: state.selectedPanelCount === 0 }),
        leaf('pastePanels', '粘贴版片', actions.pasteClipboard,
          { accel: comboOf('pastePanels'), disabled: !state.hasClipboard }),
        leaf('deleteSelection', '删除选中', actions.deleteSelection,
          { accel: comboOf('deleteSelection'), disabled: state.selectionCount === 0 }),
        menuSep(),
        leaf('selectAll', '全选版片', actions.selectAllPanels,
          { accel: comboOf('selectAll'), disabled: state.panelCount === 0 }),
        leaf('clearSelection', '取消选择', actions.clearSelection,
          { accel: comboOf('clearSelection'), disabled: state.selectionCount === 0 }),
      ],
    },
    {
      id: 'pattern',
      label: '版型',
      mnemonic: 'P',
      entries: [
        leaf('templatePanel', '模板库', actions.toggleTemplatePanel, { checked: state.showTemplatePanel }),
        menuSep(),
        group('structure', '结构', STRUCTURE_ITEMS.map(item => leaf(
          `structure:${item.key}`,
          `${marked(item.key === 'split' || item.key === 'hole' ? state.activeTool === item.key : false)}${item.label}`,
          () => runStructure(item.key),
          { note: item.hint },
        ))),
        group('mark', '标记', MARK_ITEMS.map(item => leaf(
          `mark:${item.key}`,
          `${marked(state.activeTool === item.key)}${item.label}`,
          () => actions.setTool(item.key),
          { note: item.hint },
        ))),
        menuSep(),
        leaf('patternData', '尺码表与 POM…', () => actions.openPropTab('pattern')),
        menuSep(),
        leaf('autoPlace', '自动排位', () => autoPlacePanels(),
          { note: '按环绕区域分组，把版片排成互不重叠的几行' }),
      ],
    },
    {
      id: 'tryOn',
      label: '试衣',
      mnemonic: 'T',
      entries: [
        leaf('dress', '自动着装', actions.dress, { accel: comboOf('dress') }),
        menuSep(),
        leaf('pinTool', '打 PIN', () => actions.setTool('pin'),
          { checked: state.activeTool === 'pin', note: '悬停布料出现圆圈时单击' }),
        leaf('unpinTool', '拔 PIN', () => actions.setTool('unpin'), { checked: state.activeTool === 'unpin' }),
        leaf('clearPins', '清除全部 PIN', actions.clearPins),
        menuSep(),
        leaf('playPause', '播放 / 暂停', actions.playPause, { accel: comboOf('playPause') }),
        leaf('stepFrame', '单步', actions.stepFrame, { accel: comboOf('stepFrame') }),
        leaf('resetSim', '重置模拟', actions.resetSim, { accel: comboOf('resetSim') }),
        menuSep(),
        leaf('seamTool', '缝合', () => actions.setTool('seam'),
          { checked: state.activeTool === 'seam', note: '依次单击两条边，再各点一个端点定缝纫方向' }),
        leaf('multiSeam', '多段缝合', () => runStructure('multi-seam')),
        leaf('rebuildCloth', '重建布料网格', actions.rebuildCloth),
        menuSep(),
        group('analysis', '分析', [
          leaf('fitHeatmap', `${marked(state.displayMode === 'fitHeatmap')}合身热图`,
            () => actions.setDisplayMode('fitHeatmap')),
          leaf('strainHeatmap', `${marked(state.displayMode === 'strainHeatmap')}应变热图`,
            () => actions.setDisplayMode('strainHeatmap')),
          leaf('pressureHeatmap', `${marked(state.displayMode === 'pressureHeatmap')}压力热图`,
            () => actions.setDisplayMode('pressureHeatmap')),
          menuSep(),
          leaf('dynamicFit', '动态合身…', () => actions.openPropTab('project')),
        ]),
      ],
    },
    {
      id: 'view',
      label: '视图',
      mnemonic: 'V',
      entries: [
        group('layout', '布局', layoutGroup),
        menuSep(),
        group('camera', '视角', CAMERA_PRESETS.map(preset => leaf(
          `camera:${preset.value}`,
          `${preset.label} (${comboOf(preset.menuId)})`,
          () => actions.camera(preset.value),
        ))),
        group('projection', '投影', CAMERA_PROJECTIONS.map(option => leaf(
          `projection:${option.value}`,
          `${marked(state.cameraProjection === option.value)}${option.label}`,
          () => actions.cameraProjection(option.value),
        ))),
        group('displayMode', '显示', DISPLAY_MODES.map(mode => leaf(
          `displayMode:${mode.value}`,
          `${marked(state.displayMode === mode.value)}${mode.label}`,
          () => actions.setDisplayMode(mode.value),
        ))),
        group('editPreview', '拖动预览', EDIT_PREVIEW_TIERS.map(tier => leaf(
          `editPreview:${tier.value}`,
          `${marked(state.editPreview === tier.value)}${tier.label}`,
          () => actions.setEditPreview(tier.value),
        ))),
        menuSep(),
        group('display2d', '2D 显示', DISPLAY_LAYER_OPTIONS.map(option => leaf(
          `display2d:${option.key}`,
          `${marked(state.displayOptions[option.key])}${option.label}`,
          () => actions.setDisplayOption(option.key, !state.displayOptions[option.key]),
        ))),
        menuSep(),
        leaf('fitView', '适应视图', actions.fitView, { accel: comboOf('fitView') }),
      ],
    },
    {
      id: 'window',
      label: '窗口',
      mnemonic: 'W',
      entries: [
        leaf('templatePanelWindow', '模板库', actions.toggleTemplatePanel, { checked: state.showTemplatePanel }),
        leaf('scenePanel', '场景树', actions.toggleScenePanel, { checked: state.showScenePanel }),
        leaf('propertiesPanel', '属性', actions.togglePropertiesPanel, { checked: state.showPropertiesPanel }),
        leaf('timeline', '时间轴', actions.toggleTimeline, { checked: state.showTimeline }),
        menuSep(),
        group('propTab', '属性页', PROP_TAB_OPTIONS.map(item => leaf(
          `propTab:${item.key}`,
          item.label,
          () => actions.openPropTab(item.key),
          { checked: state.propTab === item.key, disabled: !state.showPropertiesPanel },
        ))),
      ],
    },
    {
      id: 'collab',
      label: '协作',
      mnemonic: 'C',
      entries: [
        leaf('openReview', '版本与审版…', actions.openReview,
          { note: '版本历史、评论批注、共享与四阶段审版' }),
        menuSep(),
        leaf('openAssets', '素材库…', actions.openAssets,
          { note: '内置与收藏的面料、辅料、模特' }),
        leaf('openIntegration', '外部对接…', actions.openIntegration,
          { note: 'PLM 包、物料清单、POM 报告与 Webhook' }),
      ],
    },
    {
      id: 'help',
      label: '帮助',
      mnemonic: 'H',
      entries: [
        leaf('shortcuts', '快捷键总览…', actions.showShortcuts, { accel: comboOf('shortcuts') }),
        leaf('about', '关于 OpenCloth', actions.showAbout),
      ],
    },
  ];
}
