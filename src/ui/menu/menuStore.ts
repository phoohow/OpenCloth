import { CLOSED_NAV, type MenuNavState } from '@/ui/menu/nav';
import { create } from 'zustand';

export const useMenuStore = create<MenuStore>(set => ({
  nav: CLOSED_NAV,
  dialog: null,
  dialogParam: null,
  setNav: (nav) => set({ nav }),
  closeMenus: () => set({ nav: CLOSED_NAV }),
  openDialog: (dialog, param) => set({ dialog, dialogParam: param ?? null, nav: CLOSED_NAV }),
  closeDialog: () => set({ dialog: null, dialogParam: null }),
}));

export type MenuDialog =
  | 'shortcuts' | 'about' | 'production' | 'review' | 'integration' | 'screenshot' | null;

interface MenuStore {
  nav: MenuNavState;
  dialog: MenuDialog;
  dialogParam: string | null;
  setNav: (nav: MenuNavState) => void;
  closeMenus: () => void;
  openDialog: (dialog: Exclude<MenuDialog, null>, param?: string) => void;
  closeDialog: () => void;
}

export function menuOwnsKeyboard(): boolean {
  const { nav, dialog } = useMenuStore.getState();
  return dialog !== null || nav.open !== null;
}
