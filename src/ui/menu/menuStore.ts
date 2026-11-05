import { create } from 'zustand';
import { CLOSED_NAV, type MenuNavState } from '@/ui/menu/nav';

/** Modal shown over the app from the menu. */
export type MenuDialog = 'shortcuts' | 'about' | 'exportDxf' | 'exportSvg' | 'exportPdf' | 'exportTechPack' | 'exportMarker' | 'exportBom' | 'review' | 'assets' | 'integration' | null;

interface MenuStore {
  /** Which dropdown, submenu and row the menu bar currently highlights. */
  nav: MenuNavState;
  dialog: MenuDialog;
  /** Optional payload of the open dialog; the review dialog uses it as the initial project. */
  dialogParam: string | null;
  setNav: (nav: MenuNavState) => void;
  closeMenus: () => void;
  openDialog: (dialog: Exclude<MenuDialog, null>, param?: string) => void;
  closeDialog: () => void;
}

/** Menu bar highlight and modal-dialog state. */
export const useMenuStore = create<MenuStore>(set => ({
  nav: CLOSED_NAV,
  dialog: null,
  dialogParam: null,
  setNav: (nav) => set({ nav }),
  closeMenus: () => set({ nav: CLOSED_NAV }),
  openDialog: (dialog, param) => set({ dialog, dialogParam: param ?? null, nav: CLOSED_NAV }),
  closeDialog: () => set({ dialog: null, dialogParam: null }),
}));

/** While a dropdown or dialog is open, the menu bar owns the keyboard. */
export function menuOwnsKeyboard(): boolean {
  const { nav, dialog } = useMenuStore.getState();
  return dialog !== null || nav.open !== null;
}
