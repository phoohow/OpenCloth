import type { Pattern, Project } from '@/model/types';
import type { Command } from '@/commands';
import { createBlankProject } from '@/pattern/template';
import { projectCodec, downloadTextFile, readFileAsText } from '@/io/serialization';
import { embedProjectAssets } from '@/io/storage';
import {
  clearRecent, listAutosaves, listRecent, pruneOrphanBlobs, pushRecent, readAutosave, readRecent,
  saveAutosave, type AutosaveSummary, type RecentSummary,
} from '@/io/storage';
import { parsePatternDxf } from '@/io/dxf';
import { parseGerberPattern } from '@/io/import';
import { parseHpglPattern } from '@/io/import';
import { parsePdfPattern } from '@/io/import';
import { patternFromJson } from '@/pattern/auto';

/** Host callbacks the project service needs from the composition root. */
export interface ProjectServicePorts {
  /** Current project data. */
  project(): Project;
  /** Replaces the open project and clears the undo history. */
  load(project: Project): void;
  /** Whether the open project has unsaved edits. */
  canUndo(): boolean;
  /** Runs an edit through the project undo history. */
  execute(command: Command): void;
  /** Autosave interval in seconds; zero disables snapshots. */
  autoSaveSeconds(): number;
  setAutoSaveSeconds(seconds: number): void;
  setRecent(list: RecentSummary[]): void;
  setAutosaves(list: AutosaveSummary[]): void;
  setLastAutosaveAt(at: string | null): void;
  /** Opens the host's file picker. */
  pickFiles(accept: string, multiple: boolean): Promise<File[] | null>;
  confirm(message: string): boolean;
  prompt(message: string, initial: string): string | null;
  alert(message: string): void;
}

/** Project lifecycle: new/open/save, recent snapshots, autosave and pattern imports. */
export interface ProjectService {
  newProject(): void;
  openProjectFile(file: File): void;
  saveProject(): void;
  saveProjectAs(): void;
  reopenRecent(id: string): void;
  refreshRecent(): void;
  clearRecentList(): void;
  restoreAutosave(id?: string): void;
  saveSnapshotNow(): void;
  setAutoSaveSeconds(seconds: number): void;
  refreshAutosaveList(): void;
  writeAutosave(): Promise<void>;
  restoreAutosaveOnStartup(): void;
  importDxf(): void;
  importAstm(): void;
  importGerber(): void;
  importHpgl(): void;
  importPdf(): void;
  importPatternJson(): void;
}

/** Builds the project service over the host's stores, pickers and dialogs. */
export function createProjectService(ports: ProjectServicePorts): ProjectService {
  let startupRestoreStarted = false;

  /** Replaces the open project, remembering it in the recent list. */
  const adopt = (project: Project): void => {
    ports.load(project);
    // The old history is gone, so blobs no snapshot references can be reclaimed.
    void pruneOrphanBlobs(project);
    void pushRecent(project).then(() => service.refreshRecent());
  };

  /** Confirms before discarding edits that were not saved to a file. */
  const confirmDiscard = (): boolean => {
    if (!ports.canUndo()) return true;
    return ports.confirm('当前工程有未保存的修改，确定放弃吗？');
  };

  const saveToJson = (name: string): void => {
    void (async () => {
      const plain = ports.project();
      const snapshot = await embedProjectAssets(plain);
      downloadTextFile(`${name}.ocproj.json`, projectCodec.encode(snapshot));
      await pushRecent(plain);
      service.refreshRecent();
    })().catch(err => ports.alert('保存工程失败：' + (err as Error).message));
  };

  const loadText = (text: string): void => {
    try {
      adopt(projectCodec.decode(text));
    } catch (err) {
      ports.alert('加载工程失败：' + (err as Error).message);
    }
  };

  /** Replaces the project pattern in one undoable step. */
  const commitPatternReplace = (next: Pattern, label: string): void => {
    let before: Pattern | null = null;
    ports.execute({
      label,
      execute(ctx) { before = structuredClone(ctx.project.pattern); ctx.project.pattern = next; },
      undo(ctx) { if (before) ctx.project.pattern = before; },
    });
  };

  /** Picks a pattern file, parses it and swaps it into the project; failures alert. */
  const importPatternFile = async (
    accept: string, parse: (text: string) => Pattern, label: string, hint: string,
  ): Promise<void> => {
    const files = await ports.pickFiles(accept, false);
    const file = files?.[0];
    if (!file) return;
    try {
      commitPatternReplace(parse(await readFileAsText(file)), label);
    } catch (err) {
      ports.alert(hint + (err as Error).message);
    }
  };

  /** Picks a binary pattern file, parses it and swaps it into the project; failures alert. */
  const importBinaryPatternFile = async (
    accept: string, parse: (bytes: Uint8Array) => Promise<Pattern>, label: string, hint: string,
  ): Promise<void> => {
    const files = await ports.pickFiles(accept, false);
    const file = files?.[0];
    if (!file) return;
    try {
      commitPatternReplace(await parse(new Uint8Array(await file.arrayBuffer())), label);
    } catch (err) {
      ports.alert(hint + (err as Error).message);
    }
  };

  const service: ProjectService = {
    newProject: () => {
      if (!confirmDiscard()) return;
      adopt(createBlankProject());
      // Snapshot the blank project so a reload restores it instead of the previous session.
      if (ports.autoSaveSeconds() > 0) void service.writeAutosave();
    },
    openProjectFile: (file: File) => {
      if (!confirmDiscard()) return;
      void readFileAsText(file).then(loadText);
    },
    saveProject: () => saveToJson(ports.project().meta.name),
    saveProjectAs: () => {
      const before = ports.project().meta.name;
      const name = ports.prompt('工程名称', before);
      if (!name) return;
      ports.execute({
        label: '重命名工程',
        execute: ctx => { ctx.project.meta = { ...ctx.project.meta, name }; },
        undo: ctx => { ctx.project.meta = { ...ctx.project.meta, name: before }; },
      });
      saveToJson(name);
    },
    reopenRecent: (id: string) => {
      if (!confirmDiscard()) return;
      void readRecent(id).then(text => {
        if (!text) { ports.alert('该工程快照已不在本地存档中。'); return; }
        loadText(text);
      });
    },
    refreshRecent: () => {
      void listRecent().then((recent: RecentSummary[]) => ports.setRecent(recent));
    },
    clearRecentList: () => {
      void clearRecent().then(() => service.refreshRecent());
    },
    restoreAutosave: (id?: string) => {
      if (!confirmDiscard()) return;
      void readAutosave(id).then(record => {
        if (!record) { ports.alert('该自动保存快照已不在本地存档中。'); return; }
        loadText(record.json);
      });
    },
    saveSnapshotNow: () => void service.writeAutosave(),
    setAutoSaveSeconds: seconds => ports.setAutoSaveSeconds(seconds),
    refreshAutosaveList: () => {
      void listAutosaves().then(list => ports.setAutosaves(list));
    },
    writeAutosave: async () => {
      const snapshot = ports.project();
      const record = await saveAutosave(snapshot);
      if (!record) return;
      ports.setLastAutosaveAt(record.savedAt);
      service.refreshAutosaveList();
    },
    restoreAutosaveOnStartup: () => {
      if (startupRestoreStarted) return;
      startupRestoreStarted = true;
      if (ports.autoSaveSeconds() <= 0) return;
      void readAutosave().then(record => {
        if (!record) return;
        ports.setLastAutosaveAt(record.savedAt);
        if (ports.canUndo()) return;
        try {
          adopt(projectCodec.decode(record.json));
        } catch {
          // A corrupt snapshot leaves the starter project in place.
        }
      });
    },
    importDxf: () => void importPatternFile('.dxf', text => parsePatternDxf(text), '导入 DXF 版型', '导入 DXF 失败：'),
    importAstm: () => void importPatternFile('.dxf', text => parsePatternDxf(text, { convention: 'ASTM' }), '导入 ASTM DXF 版型', '导入 ASTM DXF 失败：'),
    importGerber: () => void importPatternFile('.gbr,.ger,.gtl,.gbl,.gko', text => parseGerberPattern(text), '导入 Gerber 版型', '导入 Gerber 失败：'),
    importHpgl: () => void importPatternFile('.plt,.hpgl,.hp,.hpg', text => parseHpglPattern(text), '导入 PLT 绘图', '导入 PLT 失败：'),
    importPdf: () => void importBinaryPatternFile('.pdf', bytes => parsePdfPattern(bytes), '导入 PDF 版型', '导入 PDF 版型失败：'),
    importPatternJson: () => void importPatternFile('.json', patternFromJson, '导入 JSON 版型', '导入 JSON 版型失败：'),
  };

  return service;
}
