import { comboOf } from './shortcuts';
import { menuSep, type MenuEntry, type MenuLeaf, type TopMenu } from './menuTypes';
import type { MenuActions } from './actions';
import { CAMERA_PRESETS, CAMERA_PROJECTIONS, PROP_TAB_OPTIONS } from '../optionTables';
import { formatSavedAt } from '../timeFormat';
import type { CameraProjection } from '../../core/model/types';
import type { PaneId, PropTab, ViewLayout } from '../../store/stores';
import { isSplitLayout } from '../../store/stores';
import type { RecentSummary } from '../../io/projectArchive';

export { formatSavedAt };

/** Everything the menu labels reflect; read from the stores by the menu bar. */
export interface MenuState {
  projectName: string;
  layout: ViewLayout;
  focus: PaneId;
  propTab: PropTab;
  /** Projection the 3D viewport renders with; marks the active 视图 ▸ 投影 row. */
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
  hiddenPanelCount: number;
  panelCount: number;
  referenceCount: number;
  recent: RecentSummary[];
}

const AUTO_SAVE_ITEMS = [
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

/** Builds the five dropdowns from the current state snapshot. */
export function buildMenus(state: MenuState, actions: MenuActions): TopMenu[] {
  const recentEntries: MenuEntry[] = state.recent.length === 0
    ? [leaf('recentEmpty', '暂无本地存档', () => {}, { disabled: true })]
    : state.recent.map(item => leaf(
      `recent:${item.id}`,
      `${item.name}  ${formatSavedAt(item.savedAt)}`,
      () => actions.reopenRecent(item.id),
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
    leaf('toggleFocus', `焦点窗格：${state.focus === '3d' ? '3D 视口' : '2D 制版'}`,
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
          leaf('restoreAutosave', `从快照恢复${state.lastAutosaveAt ? `（${formatSavedAt(state.lastAutosaveAt)}）` : ''}…`,
            actions.restoreAutosave, { disabled: !state.lastAutosaveAt }),
        ]),
        menuSep(),
        group('import', '导入', [
          leaf('importAvatar', '模特模型…', actions.importAvatar),
          leaf('importReference', '参考物体…', actions.importReference),
          leaf('importEnvironment', '环境贴图…', actions.importEnvironment),
          menuSep(),
          leaf('resetEnvironment', '恢复内置环境', actions.resetEnvironment),
          leaf('clearReferences', '清除全部参考物体', actions.clearReferences, { disabled: state.referenceCount === 0 }),
        ]),
        group('export', '导出', [
          leaf('exportGlb', '服装 GLB…', actions.exportGlb),
          leaf('exportObj', '服装 OBJ…', actions.exportObj),
          leaf('screenshot', '导出截图 PNG', actions.screenshot),
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
          { accel: comboOf('deleteSelection'), disabled: state.selectedPanelCount === 0 }),
        menuSep(),
        leaf('selectAll', '全选版片', actions.selectAllPanels,
          { accel: comboOf('selectAll'), disabled: state.panelCount === 0 }),
        leaf('clearSelection', '取消选择', actions.clearSelection,
          { accel: comboOf('clearSelection'), disabled: state.selectedPanelCount === 0 }),
      ],
    },
    {
      id: 'view',
      label: '视图',
      mnemonic: 'V',
      entries: [
        group('layout', '布局', layoutGroup),
        group('camera', '视角', CAMERA_PRESETS.map(item => leaf(
          item.menuId,
          item.label,
          () => actions.camera(item.value),
          { accel: comboOf(item.menuId) },
        ))),
        group('cameraProjection', '投影', CAMERA_PROJECTIONS.map(item => leaf(
          item.menuId,
          item.label,
          () => actions.cameraProjection(item.value),
          { checked: state.cameraProjection === item.value },
        ))),
        leaf('fitView', '适应视图', actions.fitView, { accel: comboOf('fitView') }),
        menuSep(),
        leaf('showAllPanels', '显示全部版片', actions.showAllPanels, { disabled: state.hiddenPanelCount === 0 }),
        leaf('hideUnselected', '隐藏未选版片', actions.hideUnselected,
          { disabled: state.selectedPanelCount === 0 || state.selectedPanelCount === state.panelCount }),
        leaf('hideSelected', '隐藏选中版片', actions.hideSelected, { disabled: state.selectedPanelCount === 0 }),
      ],
    },
    {
      id: 'window',
      label: '窗口',
      mnemonic: 'W',
      entries: [
        leaf('templatePanel', '模板库面板', actions.toggleTemplatePanel, { checked: state.showTemplatePanel }),
        leaf('scenePanel', '场景大纲', actions.toggleScenePanel, { checked: state.showScenePanel }),
        leaf('propertiesPanel', '属性编辑器', actions.togglePropertiesPanel, { checked: state.showPropertiesPanel }),
        leaf('timeline', '时间轴', actions.toggleTimeline, { checked: state.showTimeline }),
        menuSep(),
        ...PROP_TAB_OPTIONS.map(item => leaf(
          `propTab:${item.key}`,
          `属性页：${item.label}`,
          () => actions.openPropTab(item.key),
          { checked: state.propTab === item.key, disabled: !state.showPropertiesPanel },
        )),
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
