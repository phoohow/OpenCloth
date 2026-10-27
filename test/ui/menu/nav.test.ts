import { describe, expect, it } from 'vitest';
import { menuSep, type MenuLeaf, type TopMenu } from '../../../src/ui/menu/menuTypes';
import {
  CLOSED_NAV, activeLeaf, firstNavigable, isNavigable, menuByMnemonic, moveFocus, reduceMenuNav, visibleEntries,
} from '../../../src/ui/menu/nav';

const leaf = (id: string, extra: Partial<MenuLeaf> = {}): MenuLeaf => ({
  kind: 'item', id, label: id, run: () => {}, ...extra,
});

const subLeaf = (id: string, childIds: string[]): MenuLeaf => ({
  kind: 'item', id, label: id, children: childIds.map(c => leaf(c)),
});

const MENUS: TopMenu[] = [
  {
    id: 'file',
    label: '文件',
    mnemonic: 'F',
    entries: [leaf('new'), menuSep(), leaf('open', { disabled: true }), subLeaf('recent', ['r1', 'r2'])],
  },
  { id: 'edit', label: '编辑', mnemonic: 'E', entries: [leaf('undo', { disabled: true }), leaf('redo')] },
  { id: 'help', label: '帮助', mnemonic: 'H', entries: [] },
];

describe('visibleEntries', () => {
  it('lists the root rows of the open menu', () => {
    expect(visibleEntries(MENUS, { open: 0, sub: null, active: 0 })).toEqual(MENUS[0].entries);
  });

  it('lists submenu rows once the submenu is expanded', () => {
    const parent = MENUS[0].entries[3] as MenuLeaf;
    expect(visibleEntries(MENUS, { open: 0, sub: 3, active: 0 })).toEqual(parent.children);
  });

  it('is empty while the bar is closed', () => {
    expect(visibleEntries(MENUS, CLOSED_NAV)).toEqual([]);
  });
});

describe('moveFocus', () => {
  const entries = MENUS[0].entries;

  it('skips separators and disabled rows', () => {
    expect(moveFocus(entries, 0, 1)).toBe(3);
    expect(moveFocus(entries, 3, -1)).toBe(0);
  });

  it('wraps around the list', () => {
    expect(moveFocus(entries, 3, 1)).toBe(0);
    expect(moveFocus(entries, 0, -1)).toBe(3);
  });

  it('stays put when the list holds no navigable row', () => {
    expect(moveFocus([menuSep(), leaf('x', { disabled: true })], 0, 1)).toBe(0);
  });

  it('reports no row for an empty list', () => {
    expect(moveFocus([], 0, 1)).toBe(-1);
    expect(firstNavigable([])).toBe(-1);
  });
});

describe('reduceMenuNav', () => {
  it('opens a menu on its first usable row', () => {
    expect(reduceMenuNav(CLOSED_NAV, MENUS, { type: 'openMenu', index: 0 }))
      .toEqual({ open: 0, sub: null, active: 0 });
    expect(reduceMenuNav(CLOSED_NAV, MENUS, { type: 'openMenu', index: 1 }).active).toBe(1);
  });

  it('ignores an out-of-range menu index', () => {
    expect(reduceMenuNav(CLOSED_NAV, MENUS, { type: 'openMenu', index: 9 })).toEqual(CLOSED_NAV);
  });

  it('steps within the visible list', () => {
    const open = reduceMenuNav(CLOSED_NAV, MENUS, { type: 'openMenu', index: 0 });
    expect(reduceMenuNav(open, MENUS, { type: 'step', delta: 1 }).active).toBe(3);
  });

  it('expands a submenu and returns to its parent', () => {
    const open = { open: 0, sub: null, active: 3 };
    const inside = reduceMenuNav(open, MENUS, { type: 'intoSub' });
    expect(inside).toEqual({ open: 0, sub: 3, active: 0 });
    expect(reduceMenuNav(inside, MENUS, { type: 'outOfSub' })).toEqual(open);
  });

  it('refuses to enter a submenu from a plain row', () => {
    expect(reduceMenuNav({ open: 0, sub: null, active: 0 }, MENUS, { type: 'intoSub' }))
      .toEqual({ open: 0, sub: null, active: 0 });
  });

  it('treats Escape as leaving the submenu first', () => {
    expect(reduceMenuNav({ open: 0, sub: 3, active: 1 }, MENUS, { type: 'outOfSub' }))
      .toEqual({ open: 0, sub: null, active: 3 });
  });

  it('cycles the open menu and closes on the last step of the bar', () => {
    const open = reduceMenuNav(CLOSED_NAV, MENUS, { type: 'openMenu', index: 2 });
    expect(reduceMenuNav(open, MENUS, { type: 'cycleMenu', delta: 1 }).open).toBe(0);
    expect(reduceMenuNav(open, MENUS, { type: 'cycleMenu', delta: -1 }).open).toBe(1);
  });

  it('does nothing on a closed bar', () => {
    expect(reduceMenuNav(CLOSED_NAV, MENUS, { type: 'step', delta: 1 })).toEqual(CLOSED_NAV);
    expect(reduceMenuNav(CLOSED_NAV, MENUS, { type: 'cycleMenu', delta: 1 })).toEqual(CLOSED_NAV);
  });

  it('follows the pointer onto root and submenu rows', () => {
    expect(reduceMenuNav(CLOSED_NAV, MENUS, { type: 'hoverRoot', index: 2 })).toEqual({ open: null, sub: null, active: 2 });
    expect(reduceMenuNav({ open: 0, sub: 3, active: 0 }, MENUS, { type: 'hoverSub', index: 1 }))
      .toEqual({ open: 0, sub: 3, active: 1 });
  });

  it('expands a submenu on hover of its parent row', () => {
    expect(reduceMenuNav({ open: 0, sub: null, active: 0 }, MENUS, { type: 'hoverParent', index: 3 }))
      .toEqual({ open: 0, sub: 3, active: 0 });
    expect(reduceMenuNav({ open: 0, sub: null, active: 0 }, MENUS, { type: 'hoverParent', index: 0 }))
      .toEqual({ open: 0, sub: null, active: 0 });
  });

  it('closes everything', () => {
    expect(reduceMenuNav({ open: 0, sub: 3, active: 1 }, MENUS, { type: 'close' })).toEqual(CLOSED_NAV);
  });
});

describe('activeLeaf', () => {
  it('resolves the highlighted root row', () => {
    expect(activeLeaf(MENUS, { open: 0, sub: null, active: 0 })?.id).toBe('new');
  });

  it('resolves the highlighted submenu row', () => {
    expect(activeLeaf(MENUS, { open: 0, sub: 3, active: 1 })?.id).toBe('r2');
  });

  it('refuses disabled rows', () => {
    expect(activeLeaf(MENUS, { open: 0, sub: null, active: 2 })).toBeNull();
    expect(activeLeaf(MENUS, { open: 0, sub: null, active: 1 })).toBeNull();
  });
});

describe('menu helpers', () => {
  it('finds menus by mnemonic letter, ignoring case', () => {
    expect(menuByMnemonic(MENUS, 'f')).toBe(0);
    expect(menuByMnemonic(MENUS, 'H')).toBe(2);
    expect(menuByMnemonic(MENUS, 'Z')).toBeNull();
    expect(menuByMnemonic(MENUS, '')).toBeNull();
  });

  it('marks separators and disabled rows as not navigable', () => {
    expect(isNavigable(menuSep())).toBe(false);
    expect(isNavigable(leaf('x', { disabled: true }))).toBe(false);
    expect(isNavigable(leaf('x'))).toBe(true);
  });
});
