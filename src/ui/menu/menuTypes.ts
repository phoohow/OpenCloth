/** Menu entry that runs an action, opens a submenu, or shows a check mark. */
export interface MenuLeaf {
  kind: 'item';
  id: string;
  label: string;
  /** Shortcut text drawn right-aligned; also the row shown in 快捷键总览. */
  accel?: string;
  checked?: boolean;
  disabled?: boolean;
  /** Submenu rows, one nesting level deep. */
  children?: MenuEntry[];
  run?: () => void;
}

/** Blank line between menu groups. */
export interface MenuSep {
  kind: 'sep';
}

/** A menu row: an item or the blank line between groups. */
export type MenuEntry = MenuLeaf | MenuSep;

/** One dropdown on the menu bar. */
export interface TopMenu {
  id: string;
  label: string;
  /** Alt mnemonic letter. */
  mnemonic: string;
  entries: MenuEntry[];
}

/** Separator row between menu groups. */
export function menuSep(): MenuSep {
  return { kind: 'sep' };
}
