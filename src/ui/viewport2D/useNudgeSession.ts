import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pattern, Vec2 } from '../../core/model/types';
import { MovePanelsCommand, panelMoveGeometry, previewMove, type MoveGeometry } from '../../core/command/patternCommands';
import { is2DFocus, useProjectStore, useUIStore } from '../../store/stores';
import { menuOwnsKeyboard } from '../menu/menuStore';
import type { PreviewDrag } from './render';

/** Accumulated arrow-key moves for one selection, committed as a single undo step. */
interface NudgeSession {
  panelIds: string[];
  geom: MoveGeometry;
  total: Vec2;
  timer: ReturnType<typeof setTimeout>;
}

/** Whether two panel selections cover the same panels. */
function samePanels(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every(id => b.includes(id));
}

/** Arrow-key nudging of the selected panels and the space key that arms panning. */
export function useNudgeSession(pattern: Pattern, setPreview: (preview: PreviewDrag | null) => void) {
  const nudgeRef = useRef<NudgeSession | null>(null);
  const selfPatternChangeRef = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);

  /** Commits accumulated arrow-key nudges as one undo step. */
  const commitNudge = useCallback(() => {
    const session = nudgeRef.current;
    if (!session) return;
    clearTimeout(session.timer);
    nudgeRef.current = null;
    setPreview(null);
    if (session.total.x === 0 && session.total.y === 0) return;
    selfPatternChangeRef.current = true;
    useProjectStore.getState().executeCommand(new MovePanelsCommand(session.panelIds, session.total));
  }, [setPreview]);

  const nudgeSelected = useCallback((d: Vec2) => {
    const panelIds = useUIStore.getState().selection.filter(id => !!pattern.panels[id]);
    if (panelIds.length === 0) return;
    const geom = panelMoveGeometry(pattern, panelIds);
    if (geom.pointIds.length === 0) return;

    const prev = nudgeRef.current;
    if (prev && samePanels(prev.panelIds, panelIds)) {
      clearTimeout(prev.timer);
      prev.total = { x: prev.total.x + d.x, y: prev.total.y + d.y };
      prev.geom = geom;
      prev.timer = setTimeout(commitNudge, 500);
      nudgeRef.current = prev;
    } else {
      commitNudge();
      nudgeRef.current = { panelIds, geom, total: { ...d }, timer: setTimeout(commitNudge, 500) };
    }
    setPreview({ pattern: previewMove(pattern, geom, nudgeRef.current.total), ghost: null });
  }, [pattern, commitNudge, setPreview]);

  // A pattern change from elsewhere invalidates the geometry an in-flight preview was drawn from.
  useEffect(() => {
    if (selfPatternChangeRef.current) {
      selfPatternChangeRef.current = false;
      return;
    }
    const session = nudgeRef.current;
    if (!session) return;
    clearTimeout(session.timer);
    nudgeRef.current = null;
    setPreview(null);
  }, [pattern, setPreview]);

  // Keyboard: nudge the selected panels.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (menuOwnsKeyboard()) return;
      const ui = useUIStore.getState();
      if (!is2DFocus(ui.layout, ui.focus)) return;
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.5;
        const d: Vec2 = {
          x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          y: e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0,
        };
        nudgeSelected(d);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [nudgeSelected]);

  return { commitNudge, spaceDown };
}
