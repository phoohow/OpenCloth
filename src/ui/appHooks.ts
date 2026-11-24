import { getCloudProject } from '@/io/storage';
import {
  FPS_SAMPLE_MS, is3DFocus, usePerfStore, useUIStore,
} from '@/store';
import { keyboardBlocked } from '@/ui/keyboardGuard';
import {
  refreshAutosaveList, refreshRecentList, restoreAutosaveOnStartup, writeAutosave,
} from '@/ui/menu/actions';
import { useMenuStore } from '@/ui/menu/menuStore';
import { SHORTCUTS, matchShortcut } from '@/ui/menu/shortcuts';
import { useEffect } from 'react';

export function useGlobalShortcuts(run: Record<string, () => void>): void {
  useEffect(() => {
    const dispatch = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (keyboardBlocked()) return;

      const id = matchShortcut(e);
      if (!id) return;
      const def = SHORTCUTS.find(s => s.id === id);
      if (!def || def.scope === '菜单栏') return;
      const ui = useUIStore.getState();
      if (def.scope === '3D 视口' && !is3DFocus(ui.layout, ui.focus)) return;
      if (def.scope === '2D 制版' && ui.layout === '3d') return;
      const action = run[id];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', dispatch);
    return () => window.removeEventListener('keydown', dispatch);
  }, [run]);
}

export function useReviewHashRoute(): void {
  useEffect(() => {
    const openFromHash = () => {
      const match = location.hash.match(/^#review=([^&]+)$/);
      if (!match) return;
      const projectId = decodeURIComponent(match[1]!);
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      const menu = useMenuStore.getState();
      if (menu.dialog === 'review' && menu.dialogParam === projectId) return;
      void getCloudProject(projectId).then(project => {
        if (project) menu.openDialog('review', projectId);
        else useUIStore.getState().showToast('本机没有该项目，请导入审版包');
      });
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);
}

export function useLocalArchiveStartup(): void {
  useEffect(() => {
    refreshRecentList();
    refreshAutosaveList();
    restoreAutosaveOnStartup();
  }, []);
}

export function useAutosaveTimer(seconds: number): void {
  useEffect(() => {
    if (seconds <= 0) return undefined;
    const timer = window.setInterval(() => void writeAutosave(), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);
}

export function useFpsSampling(): void {
  useEffect(() => {
    const timer = window.setInterval(
      () => usePerfStore.getState().sampleFps(performance.now()),
      FPS_SAMPLE_MS,
    );
    return () => window.clearInterval(timer);
  }, []);
}
