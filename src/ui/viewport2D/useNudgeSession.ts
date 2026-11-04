import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pattern, Vec2 } from '../../core/model/types';
import {
  SetPointGradingCommand, edgePointIds,
  panelMoveCommand, panelMoveGeometry, pointMoveCommand, pointMoveGeometry,
  previewMove, previewPanelMove, type MoveGeometry,
} from '../../core/command/patternCommands';
import { idsOfKind } from '../elementSelection';
import { is2DFocus, useProjectStore, useUIStore } from '../../store/stores';
import { menuOwnsKeyboard } from '../menu/menuStore';
import { panelsOfPoint } from './hitTest';
import type { PreviewDrag } from './render';

/** What an arrow-key gesture translates: whole panels, or point geometry. */
export interface NudgeTarget {
  kind: 'panels' | 'points';
  ids: string[];
}

/** Accumulated arrow-key moves for one selection, committed as a single undo step. */
export interface NudgeSession {
  target: NudgeTarget;
  geom: MoveGeometry;
  total: Vec2;
}

/** Whether two targets address the same objects the same way. */
function sameTarget(a: NudgeTarget, b: NudgeTarget): boolean {
  return a.kind === b.kind && a.ids.length === b.ids.length && a.ids.every(id => b.ids.includes(id));
}

/**
 * Folds one arrow-key step into the running gesture. A step on the same selection joins the
 * session; a step on a different selection closes it (`close` first) and opens a new one.
 */
export function advanceNudge(
  prev: NudgeSession | null, target: NudgeTarget, geom: MoveGeometry, d: Vec2,
): { close: NudgeSession | null; session: NudgeSession } {
  if (prev && sameTarget(prev.target, target)) {
    const joined = { ...prev, geom, total: { x: prev.total.x + d.x, y: prev.total.y + d.y } };
    return { close: null, session: joined };
  }
  return { close: prev, session: { target, geom, total: { ...d } } };
}

/**
 * What arrow keys move for a selection: the selected panels, else the vertices the selected
 * edges hang on, so a nudged edge shifts its points.
 */
function nudgeTarget(pattern: Pattern, selection: readonly string[], panelIds: string[]): NudgeTarget | null {
  if (panelIds.length > 0) return { kind: 'panels', ids: panelIds };
  const pointIds = edgePointIds(pattern, idsOfKind(selection, 'edge'))
    .filter(id => panelsOfPoint(pattern, id).every(pid => !pattern.panels[pid]?.locked));
  return pointIds.length > 0 ? { kind: 'points', ids: pointIds } : null;
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
    nudgeRef.current = null;
    setPreview(null);
    if (session.total.x === 0 && session.total.y === 0) return;
    const store = useProjectStore.getState();
    const command = session.target.kind === 'points'
      ? pointMoveCommand(store.project.pattern, session.target.ids, session.total)
      : panelMoveCommand(store.project.pattern, session.target.ids, session.total);
    if (!command) return;
    // Set only once something really is written, so a skipped commit cannot swallow the next change.
    selfPatternChangeRef.current = true;
    store.executeCommand(command);
  }, [setPreview]);

  /** Arrow-key adjustment of one point's grading delta for the active size. */
  const nudgeGrade = useCallback((d: Vec2): boolean => {
    const ui = useUIStore.getState();
    if (!ui.displayOptions.gradingOverlay) return false;
    const project = useProjectStore.getState().project;
    const sizeId = project.activeSizeId;
    const pointIds = idsOfKind(ui.selection, 'point').filter(id => !!project.pattern.points[id]);
    if (!sizeId || pointIds.length !== 1) return false;
    const point = project.pattern.points[pointIds[0]!]!;
    const current = point.grading?.[sizeId] ?? { x: 0, y: 0 };
    useProjectStore.getState().executeCommand(
      new SetPointGradingCommand(point.id, sizeId, { x: current.x + d.x, y: current.y + d.y }),
    );
    return true;
  }, []);

  const nudgeSelected = useCallback((d: Vec2) => {
    const panelIds = useUIStore.getState().selection.filter(id => !!pattern.panels[id] && !pattern.panels[id]?.locked);
    const target = nudgeTarget(pattern, useUIStore.getState().selection, panelIds);
    if (!target) return;
    const geom = target.kind === 'panels'
      ? panelMoveGeometry(pattern, target.ids)
      : pointMoveGeometry(pattern, target.ids);
    if (geom.pointIds.length === 0) return;

    const { close, session } = advanceNudge(nudgeRef.current, target, geom, d);
    if (close) commitNudge();
    nudgeRef.current = session;
    setPreview({
      pattern: target.kind === 'panels'
        ? previewPanelMove(pattern, target.ids, session.total)
        : previewMove(pattern, session.geom, session.total),
      ghost: null,
    });
  }, [pattern, commitNudge, setPreview]);

  // A pattern change from elsewhere lands on top of an in-flight nudge; commit the nudge first.
  useEffect(() => {
    if (selfPatternChangeRef.current) {
      selfPatternChangeRef.current = false;
      return;
    }
    commitNudge();
  }, [pattern, commitNudge]);

  // Keyboard: arrow keys nudge panels, or the active size's grade delta while 齐码套叠 is on.
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
        if (!nudgeGrade(d)) nudgeSelected(d);
      }
    };
    // One arrow-key hold is one gesture, so the accumulated steps commit when the key is released.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false);
      if (e.key.startsWith('Arrow')) commitNudge();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [nudgeSelected, nudgeGrade, commitNudge]);

  // Releasing the page (tab switch, alt-tab) ends the gesture too.
  useEffect(() => {
    const onBlur = () => commitNudge();
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      commitNudge();
    };
  }, [commitNudge]);

  return { commitNudge, spaceDown };
}
