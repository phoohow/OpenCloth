import { create } from 'zustand';
import type { Project } from '../core/model/types';
import type { PanelClipboard } from '../core/command/panelClipboard';
import type { RecentSummary, AutosaveSummary } from '../io/projectArchive';
import { CommandHistory, type Command } from '../core/command/command';
import { createStarterProject } from '../pattern/template';
import { avatarBodySignature } from '../core/engine/clothSignatures';

interface ProjectStore {
  project: Project;
  /** Rebuild key for everything the cloth geometry depends on; see `computeClothSignature`. */
  clothSignature: string;
  history: CommandHistory;
  /** Copied panels waiting to be pasted. */
  clipboard: PanelClipboard | null;
  /** Saved project snapshots shown under 文件 ▸ 最近. */
  recent: RecentSummary[];
  /** Autosave snapshots shown under 文件 ▸ 自动保存. */
  autosaves: AutosaveSummary[];
  executeCommand: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (project: Project) => void;
  setClipboard: (clip: PanelClipboard | null) => void;
  setRecent: (recent: RecentSummary[]) => void;
  setAutosaves: (autosaves: AutosaveSummary[]) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Label of the command that undo would revert. */
  undoLabel: () => string | null;
  /** Label of the command that redo would replay. */
  redoLabel: () => string | null;
}

/**
 * One comparable string over everything a cloth rebuild reads: the pattern minus
 * draw-only flags and names, the avatar fields that shape the body (display, name and
 * transform sync to the scene without a rebuild) and the global mesh resolution.
 */
export function computeClothSignature(project: Project): string {
  const drawOnly = new Set(['display', 'visible', 'stitchVisible', 'name']);
  const pattern = JSON.stringify(project.pattern, (key, value) => (drawOnly.has(key) ? undefined : value));
  const body = avatarBodySignature(project.avatar);
  return `${pattern}|${body}|${project.scene.simulation.meshResolutionCm ?? null}`;
}

/** Commits a finished command draft as the new immutable project state. */
function commit(draft: Project, stamp: boolean): Partial<ProjectStore> {
  const project: Project = stamp
    ? { ...draft, meta: { ...draft.meta, modifiedAt: new Date().toISOString() } }
    : { ...draft };
  return { project, clothSignature: computeClothSignature(project) };
}

/** Project data plus the undo history that mutates it. */
export const useProjectStore = create<ProjectStore>((set, get) => {
  const starter = createStarterProject();
  return {
    project: starter,
    clothSignature: computeClothSignature(starter),
    history: new CommandHistory(),
    clipboard: null,
    recent: [],
    autosaves: [],

    executeCommand(cmd) {
      const { project, history } = get();
      const draft = structuredClone(project);
      history.execute(cmd, { project: draft });
      set(commit(draft, true));
    },

    undo() {
      const { project, history } = get();
      const draft = structuredClone(project);
      if (history.undo({ project: draft })) set(commit(draft, false));
    },

    redo() {
      const { project, history } = get();
      const draft = structuredClone(project);
      if (history.redo({ project: draft })) set(commit(draft, false));
    },

    loadProject(project) {
      get().history.clear();
      set({ project, clipboard: null, clothSignature: computeClothSignature(project) });
    },

    setClipboard: (clip) => set({ clipboard: clip }),
    setRecent: (recent) => set({ recent }),
    setAutosaves: (autosaves) => set({ autosaves }),

    canUndo: () => get().history.canUndo,
    canRedo: () => get().history.canRedo,
    undoLabel: () => get().history.lastLabel,
    redoLabel: () => get().history.nextLabel,
  };
});
