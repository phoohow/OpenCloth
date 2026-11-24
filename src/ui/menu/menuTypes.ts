export interface MenuLeaf {
  kind: 'item';
  id: string;
  label: string;
  accel?: string;
  checked?: boolean;
  disabled?: boolean;
  children?: MenuEntry[];
  note?: string;
  run?: () => void;
}

export interface MenuSep {
  kind: 'sep';
}

export type MenuEntry = MenuLeaf | MenuSep;

export interface TopMenu {
  id: string;
  label: string;
  mnemonic: string;
  entries: MenuEntry[];
  run?: () => void;
}

export function menuSep(): MenuSep {
  return { kind: 'sep' };
}
