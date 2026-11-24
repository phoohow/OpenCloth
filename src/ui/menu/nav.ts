import type { MenuEntry, MenuLeaf, TopMenu } from '@/ui/menu/menuTypes';

export const CLOSED_NAV: MenuNavState = { open: null, sub: null, active: -1 };

export interface MenuNavState {
  open: number | null;
  sub: number | null;
  active: number;
}

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

export function isNavigable(entry: MenuEntry): entry is MenuLeaf {
  return entry.kind === 'item' && !entry.disabled;
}

export function visibleEntries(menus: TopMenu[], state: MenuNavState): MenuEntry[] {
  const menu = state.open === null ? undefined : menus[state.open];
  if (!menu) return [];
  if (state.sub === null) return menu.entries;
  const parent = menu.entries[state.sub];
  return parent?.kind === 'item' ? parent.children ?? [] : [];
}

export function firstNavigable(entries: MenuEntry[]): number {
  return entries.findIndex(isNavigable);
}

export function activeLeaf(menus: TopMenu[], state: MenuNavState): MenuLeaf | null {
  const entry = visibleEntries(menus, state)[state.active];
  return entry && isNavigable(entry) ? entry : null;
}

export function moveFocus(entries: MenuEntry[], from: number, delta: 1 | -1): number {
  const count = entries.length;
  if (count === 0) return -1;
  for (let hops = 1; hops <= count; hops++) {
    const index = (((from + delta * hops) % count) + count) % count;
    if (isNavigable(entries[index])) return index;
  }

  return from;
}

export function opensDropdown(menu: TopMenu): boolean {
  return menu.entries.length > 0;
}

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
      for (let hops = 1; hops <= menus.length; hops++) {
        const index = (((state.open + step.delta * hops) % menus.length) + menus.length) % menus.length;
        if (opensDropdown(menus[index])) {
          return { open: index, sub: null, active: firstNavigable(menus[index].entries) };
        }
      }

      return state;
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

export function menuByMnemonic(menus: TopMenu[], letter: string): number | null {
  if (!letter) return null;
  const index = menus.findIndex(m => m.mnemonic.toLowerCase() === letter.toLowerCase());
  return index < 0 ? null : index;
}
