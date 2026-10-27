import type { MenuEntry, MenuLeaf, TopMenu } from './menuTypes';

/** Which dropdown is open, which submenu is expanded and which row is highlighted. */
export interface MenuNavState {
  /** Index of the open menu on the bar; null when the bar is closed. */
  open: number | null;
  /** Index within the open menu of the expanded submenu item; null while on the root list. */
  sub: number | null;
  /** Highlighted row of the list the keyboard acts on. */
  active: number;
}

export const CLOSED_NAV: MenuNavState = { open: null, sub: null, active: -1 };

/** Keyboard navigation action on the menu bar. */
export type MenuNavStep =
  | { type: 'openMenu'; index: number }
  | { type: 'close' }
  | { type: 'step'; delta: 1 | -1 }
  | { type: 'cycleMenu'; delta: 1 | -1 }
  | { type: 'intoSub' }
  | { type: 'outOfSub' }
  | { type: 'hoverRoot'; index: number }
  | { type: 'hoverParent'; index: number }
  | { type: 'hoverSub'; index: number };

/** Rows the keyboard can land on: real entries that are not separators or disabled. */
export function isNavigable(entry: MenuEntry): entry is MenuLeaf {
  return entry.kind === 'item' && !entry.disabled;
}

/** Rows under the pointer and the arrow keys right now. */
export function visibleEntries(menus: TopMenu[], state: MenuNavState): MenuEntry[] {
  const menu = state.open === null ? undefined : menus[state.open];
  if (!menu) return [];
  if (state.sub === null) return menu.entries;
  const parent = menu.entries[state.sub];
  return parent?.kind === 'item' ? parent.children ?? [] : [];
}

/** Index of the first navigable row, or -1 when the list holds none. */
export function firstNavigable(entries: MenuEntry[]): number {
  return entries.findIndex(isNavigable);
}

/** Row the Enter key acts on; null when nothing is highlighted. */
export function activeLeaf(menus: TopMenu[], state: MenuNavState): MenuLeaf | null {
  const entry = visibleEntries(menus, state)[state.active];
  return entry && isNavigable(entry) ? entry : null;
}

/** Nearest navigable row from `from` in `delta`'s direction, wrapping around the list. */
export function moveFocus(entries: MenuEntry[], from: number, delta: 1 | -1): number {
  const count = entries.length;
  if (count === 0) return -1;
  for (let hops = 1; hops <= count; hops++) {
    const index = (((from + delta * hops) % count) + count) % count;
    if (isNavigable(entries[index])) return index;
  }
  return from;
}

/** Applies one navigation step; opening a submenu and running an item stay with the caller. */
export function reduceMenuNav(state: MenuNavState, menus: TopMenu[], step: MenuNavStep): MenuNavState {
  switch (step.type) {
    case 'openMenu': {
      const menu = menus[step.index];
      if (!menu) return state;
      return { open: step.index, sub: null, active: firstNavigable(menu.entries) };
    }
    case 'close':
      return CLOSED_NAV;
    case 'cycleMenu': {
      if (state.open === null || menus.length === 0) return state;
      const index = (((state.open + step.delta) % menus.length) + menus.length) % menus.length;
      return { open: index, sub: null, active: firstNavigable(menus[index].entries) };
    }
    case 'step': {
      if (state.open === null) return state;
      const entries = visibleEntries(menus, state);
      return { ...state, active: moveFocus(entries, state.active, step.delta) };
    }
    case 'intoSub': {
      if (state.open === null || state.sub !== null) return state;
      const parent = menus[state.open].entries[state.active];
      if (parent?.kind !== 'item' || !parent.children?.length) return state;
      return { ...state, sub: state.active, active: firstNavigable(parent.children) };
    }
    case 'outOfSub':
      return state.sub === null ? state : { ...state, sub: null, active: state.sub };
    case 'hoverRoot':
      return { ...state, sub: null, active: step.index };
    case 'hoverParent': {
      if (state.open === null) return state;
      const parent = menus[state.open].entries[step.index];
      if (parent?.kind !== 'item' || !parent.children?.length) return state;
      return { ...state, sub: step.index, active: firstNavigable(parent.children) };
    }
    case 'hoverSub':
      return { ...state, active: step.index };
    default:
      return state;
  }
}

/** Index of the menu whose mnemonic letter matches, or null. */
export function menuByMnemonic(menus: TopMenu[], letter: string): number | null {
  if (!letter) return null;
  const index = menus.findIndex(m => m.mnemonic.toLowerCase() === letter.toLowerCase());
  return index < 0 ? null : index;
}
