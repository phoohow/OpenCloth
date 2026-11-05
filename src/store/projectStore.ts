import { create } from 'zustand';
import type { CameraConfig, Project } from '../core/model/types';
import type { PanelClipboard } from '../core/command/panelClipboard';
import type { RecentSummary, AutosaveSummary } from '../io/projectArchive';
import { CommandHistory, type Command } from '../core/command/command';
import { createStarterProject } from '../pattern/template';
import { ChangeSet } from '../core/change/changeSet';
import { diffProject } from '../core/change/diffProject';

interface ProjectStore {
  project: Project;
  /** What the last revision changed; the viewport dispatches on it. */
  changes: ChangeSet;
  history: CommandHistory;
  /** Copied panels waiting to be pasted. */
  clipboard: PanelClipboard | null;
  /** Saved project snapshots shown under 文件 ▸ 最近. */
  recent: RecentSummary[];
  /** Autosave snapshots shown under 文件 ▸ 自动保存. */
  autosaves: AutosaveSummary[];
  /** Increments on every loaded project, so the viewport can reapply its saved camera. */
  loadToken: number;
  executeCommand: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (project: Project) => void;
  /** Stores the viewport camera without touching the undo history. */
  setCamera: (camera: CameraConfig) => void;
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

/** Commits a finished command draft as the new immutable project state. */
function commit(draft: Project, stamp: boolean): Project {
  return stamp ? { ...draft, meta: { ...draft.meta, modifiedAt: new Date().toISOString() } } : { ...draft };
}

/** Project data plus the undo history that mutates it. */
export const useProjectStore = create<ProjectStore>((set, get) => {
  const starter = createStarterProject();
  return {
    project: starter,
    changes: ChangeSet.all(Object.keys(starter.pattern.panels)),
    history: new CommandHistory(),
    clipboard: null,
    recent: [],
    autosaves: [],
    loadToken: 0,

    executeCommand(cmd) {
      const { project, history } = get();
      const draft = structuredClone(project);
      history.execute(cmd, { project: draft });
      const next = commit(draft, true);
      set({ project: next, changes: diffProject(project, next) });
    },

    undo() {
      const { project, history } = get();
      const draft = structuredClone(project);
      if (!history.undo({ project: draft })) return;
      const next = commit(draft, false);
      set({ project: next, changes: diffProject(project, next) });
    },

    redo() {
      const { project, history } = get();
      const draft = structuredClone(project);
      if (!history.redo({ project: draft })) return;
      const next = commit(draft, false);
      set({ project: next, changes: diffProject(project, next) });
    },

    loadProject(project) {
      get().history.clear();
      set({
        project,
        clipboard: null,
        changes: ChangeSet.all(Object.keys(project.pattern.panels)),
        loadToken: get().loadToken + 1,
      });
    },

    setCamera(camera) {
      const { project } = get();
      set({ project: { ...project, scene: { ...project.scene, camera } }, changes: ChangeSet.empty() });
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
