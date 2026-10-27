import { describe, expect, it } from 'vitest';
import { buildMenus, formatSavedAt, type MenuState } from '../../../src/ui/menu/menuModel';
import type { MenuActions } from '../../../src/ui/menu/actions';
import type { MenuEntry, MenuLeaf, TopMenu } from '../../../src/ui/menu/menuTypes';
import { isNavigable } from '../../../src/ui/menu/nav';

const actions = new Proxy({}, {
  get: () => () => {},
  ownKeys: () => [],
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
}) as unknown as MenuActions;

function state(overrides: Partial<MenuState> = {}): MenuState {
  return {
    projectName: '测试工程',
    layout: 'split3d2d',
    focus: '3d',
    propTab: 'object',
    cameraProjection: 'perspective',
    showTemplatePanel: true,
    showScenePanel: true,
    showPropertiesPanel: true,
    showTimeline: true,
    autoSaveSeconds: 0,
    lastAutosaveAt: null,
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    hasClipboard: false,
    selectedPanelCount: 0,
    hiddenPanelCount: 0,
    panelCount: 3,
    referenceCount: 0,
    recent: [],
    ...overrides,
  };
}

function menu(menus: TopMenu[], id: string): TopMenu {
  const found = menus.find(m => m.id === id);
  if (!found) throw new Error(`missing menu ${id}`);
  return found;
}

function find(entries: MenuEntry[], id: string): MenuLeaf {
  const found = search(entries, id);
  if (!found) throw new Error(`missing item ${id}`);
  return found;
}

function search(entries: MenuEntry[], id: string): MenuLeaf | null {
  for (const entry of entries) {
    if (entry.kind === 'sep') continue;
    if (entry.id === id) return entry;
    const child = entry.children ? search(entry.children, id) : null;
    if (child) return child;
  }
  return null;
}

describe('buildMenus', () => {
  it('lists the five dropdowns with unique mnemonics', () => {
    const menus = buildMenus(state(), actions);
    expect(menus.map(m => m.id)).toEqual(['file', 'edit', 'view', 'window', 'help']);
    expect(new Set(menus.map(m => m.mnemonic)).size).toBe(menus.length);
  });

  it('disables undo and redo without a history', () => {
    const edit = buildMenus(state(), actions).find(m => m.id === 'edit')!;
    expect(find(edit.entries, 'undo').disabled).toBe(true);
    expect(find(edit.entries, 'redo').disabled).toBe(true);
  });

  it('names the undo and redo rows after the command', () => {
    const edit = menu(buildMenus(state({
      canUndo: true, canRedo: true, undoLabel: '移动版型片', redoLabel: '粘贴版型片',
    }), actions), 'edit');
    expect(find(edit.entries, 'undo').label).toBe('撤销 移动版型片');
    expect(find(edit.entries, 'redo').label).toBe('重做 粘贴版型片');
  });

  it('gates clipboard and visibility rows on the selection', () => {
    const menus = buildMenus(state({ selectedPanelCount: 1, hiddenPanelCount: 1 }), actions);
    expect(find(menu(menus, 'edit').entries, 'copyPanels').disabled).toBe(false);
    expect(find(menu(menus, 'edit').entries, 'pastePanels').disabled).toBe(true);
    expect(find(menu(menus, 'view').entries, 'showAllPanels').disabled).toBe(false);
    expect(find(menu(menus, 'view').entries, 'hideUnselected').disabled).toBe(false);

    const empty = buildMenus(state(), actions);
    expect(find(menu(empty, 'edit').entries, 'copyPanels').disabled).toBe(true);
    expect(find(menu(empty, 'view').entries, 'showAllPanels').disabled).toBe(true);
    expect(find(menu(empty, 'view').entries, 'hideSelected').disabled).toBe(true);
  });

  it('disables hiding unselected when everything is selected', () => {
    const view = menu(buildMenus(state({ selectedPanelCount: 3, panelCount: 3 }), actions), 'view');
    expect(find(view.entries, 'hideUnselected').disabled).toBe(true);
  });

  it('checks the active layout and autosave and exposes screenshot export', () => {
    const menus = buildMenus(state({ layout: '2d', autoSaveSeconds: 60 }), actions);
    expect(find(menu(menus, 'view').entries, 'layout2d').checked).toBe(true);
    expect(find(menu(menus, 'view').entries, 'layout3d2d').checked).toBe(false);
    expect(find(menu(menus, 'file').entries, 'screenshot').run).toBeTruthy();
    expect(find(menu(menus, 'file').entries, 'autoSave:60').checked).toBe(true);
  });

  it('offers both split orders with their own combos', () => {
    const view = menu(buildMenus(state({ layout: 'split2d3d' }), actions), 'view');
    expect(find(view.entries, 'layout2d3d').checked).toBe(true);
    expect(find(view.entries, 'layout2d3d').accel).toBe('4');
    expect(find(view.entries, 'layout3d2d').accel).toBe('3');
    expect(find(view.entries, 'balancePanes').disabled).toBe(false);
  });

  it('checks the visible panels in the window menu', () => {
    const window = menu(buildMenus(state({ showTimeline: false, showScenePanel: false }), actions), 'window');
    expect(find(window.entries, 'timeline').checked).toBe(false);
    expect(find(window.entries, 'scenePanel').checked).toBe(false);
    expect(find(window.entries, 'templatePanel').checked).toBe(true);
  });

  it('locks property-tab rows when the editor is hidden', () => {
    const window = menu(buildMenus(state({ showPropertiesPanel: false, propTab: 'render' }), actions), 'window');
    expect(find(window.entries, 'propTab:render').disabled).toBe(true);
    expect(find(window.entries, 'propTab:render').checked).toBe(true);
  });

  it('shows an empty recent list as a disabled row', () => {
    const file = menu(buildMenus(state(), actions), 'file');
    expect(find(file.entries, 'recentEmpty').disabled).toBe(true);
    expect(find(file.entries, 'clearRecent').disabled).toBe(true);
  });

  it('lists recent projects with their save time', () => {
    const file = menu(buildMenus(state({
      recent: [{ id: 'a', name: '衬衫', savedAt: '2026-10-28T09:05:00.000Z' }],
    }), actions), 'file');
    expect(find(file.entries, 'recent:a').label).toContain('衬衫');
    expect(find(file.entries, 'clearRecent').disabled).toBe(false);
  });

  it('offers restoring only after an autosave exists', () => {
    const file = menu(buildMenus(state(), actions), 'file');
    expect(find(file.entries, 'restoreAutosave').disabled).toBe(true);
    const withSave = menu(buildMenus(state({ lastAutosaveAt: '2026-10-28T09:05:00.000Z' }), actions), 'file');
    expect(find(withSave.entries, 'restoreAutosave').disabled).toBe(false);
    expect(find(withSave.entries, 'restoreAutosave').label).toContain('10-28');
  });

  it('disables reference cleanup when the scene holds none', () => {
    const file = menu(buildMenus(state(), actions), 'file');
    expect(find(file.entries, 'clearReferences').disabled).toBe(true);
    const withRefs = menu(buildMenus(state({ referenceCount: 2 }), actions), 'file');
    expect(find(withRefs.entries, 'clearReferences').disabled).toBe(false);
  });

  it('shows the focus pane in the row that toggles it', () => {
    const view = menu(buildMenus(state({ focus: '2d' }), actions), 'view');
    expect(find(view.entries, 'toggleFocus').label).toBe('焦点窗格：2D 制版');
    expect(find(view.entries, 'balancePanes').disabled).toBe(false);
    const solo = menu(buildMenus(state({ layout: '3d' }), actions), 'view');
    expect(find(solo.entries, 'balancePanes').disabled).toBe(true);
  });

  it('keeps every enabled row executable or expandable', () => {
    const menus = buildMenus(state({
      canUndo: true, canRedo: true, hasClipboard: true, selectedPanelCount: 1, hiddenPanelCount: 1,
      referenceCount: 1, lastAutosaveAt: '2026-10-28T09:05:00.000Z',
      recent: [{ id: 'a', name: '衬衫', savedAt: '2026-10-28T09:05:00.000Z' }],
    }), actions);
    const walk = (entries: MenuEntry[]) => {
      for (const entry of entries) {
        if (entry.kind === 'sep' || !isNavigable(entry)) continue;
        expect(entry.run || entry.children?.length, entry.id).toBeTruthy();
        if (entry.children) walk(entry.children);
      }
    };
    menus.forEach(m => walk(m.entries));
  });

  it('labels every keyboard-driven row with its combo', () => {
    const edit = menu(buildMenus(state(), actions), 'edit');
    expect(find(edit.entries, 'undo').accel).toBe('Ctrl+Z');
    expect(find(edit.entries, 'pastePanels').accel).toBe('Ctrl+V');
    const view = menu(buildMenus(state(), actions), 'view');
    expect(find(view.entries, 'fitView').accel).toBe('F');
    expect(find(view.entries, 'cameraFront').accel).toBe('Num2');
    expect(find(view.entries, 'cameraBackRight').accel).toBe('Num9');
  });

  it('checks the row matching the live camera projection', () => {
    const view = menu(buildMenus(state({ cameraProjection: 'orthographic' }), actions), 'view');
    expect(find(view.entries, 'cameraProjectionOrthographic').checked).toBe(true);
    expect(find(view.entries, 'cameraProjectionPerspective').checked).toBe(false);
  });
});

describe('formatSavedAt', () => {
  it('renders a local month-day and clock time', () => {
    expect(formatSavedAt('2026-01-02T03:04:00.000Z')).toMatch(/^01-02 \d{2}:04$/);
  });

  it('returns empty text for an unreadable stamp', () => {
    expect(formatSavedAt('not-a-date')).toBe('');
  });
});
