import type { PanelClipboard } from '@/commands';
import type { RecentSummary, AutosaveSummary } from '@/io/storage';
import type { CameraConfig, Project } from '@/model/types';

import { createStarterProject } from '@/app/assembly';
import { CommandHistory, type Command } from '@/commands';
import { ChangeSet } from '@/runtime/common';
import { diffProject } from '@/runtime/diff';
import { create } from 'zustand';

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

    setProjectName(name) {
      const { project } = get();
      if (name === project.meta.name) return;
      set({ project: { ...project, meta: { ...project.meta, name } }, changes: ChangeSet.empty() });
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

interface ProjectStore {
  project: Project;
  changes: ChangeSet;
  history: CommandHistory;
  clipboard: PanelClipboard | null;
  recent: RecentSummary[];
  autosaves: AutosaveSummary[];
  loadToken: number;
  executeCommand: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (project: Project) => void;
  setCamera: (camera: CameraConfig) => void;
  setProjectName: (name: string) => void;
  setClipboard: (clip: PanelClipboard | null) => void;
  setRecent: (recent: RecentSummary[]) => void;
  setAutosaves: (autosaves: AutosaveSummary[]) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoLabel: () => string | null;
  redoLabel: () => string | null;
}

function commit(draft: Project, stamp: boolean): Project {
  return stamp ? { ...draft, meta: { ...draft.meta, modifiedAt: new Date().toISOString() } } : { ...draft };
}
