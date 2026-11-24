import type { Command } from '@/commands';
import type { Pattern, Project } from '@/model/types';

import { chooseSaveFile, type SaveFileType, type SaveFile } from '@/base/platform';
import { stripExtension } from '@/base/string';
import { patternFromJson } from '@/io/codec';
import { parsePatternDxf } from '@/io/dxf';
import { parseGerberPattern, parseHpglPattern, parsePdfPattern } from '@/io/import';
import {
  PROJECT_FILE_EXTENSION, projectCodec, readFileAsText,
} from '@/io/serialization';
import {
  embedProjectAssets, clearRecent, listAutosaves, listRecent, pruneOrphanBlobs, pushRecent,
  readAutosave, readRecent, saveAutosave, type AutosaveSummary, type RecentSummary,
} from '@/io/storage';
import { createBlankProject } from '@/model';

export interface ProjectServicePorts {
  project(): Project;
  load(project: Project): void;
  canUndo(): boolean;
  execute(command: Command): void;
  setProjectName(name: string): void;
  autoSaveSeconds(): number;
  setAutoSaveSeconds(seconds: number): void;
  setRecent(list: RecentSummary[]): void;
  setAutosaves(list: AutosaveSummary[]): void;
  setLastAutosaveAt(at: string | null): void;
  pickFiles(accept: string, multiple: boolean): Promise<File[] | null>;
  confirm(message: string): Promise<boolean>;
  notify(message: string): void;
}

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

export function createProjectService(ports: ProjectServicePorts): ProjectService {
  let startupRestoreStarted = false;

  let savedFile: SaveFile | null = null;

  const adopt = (project: Project): void => {
    savedFile = null;
    ports.load(project);
    void pruneOrphanBlobs(project);
    void pushRecent(project).then(() => service.refreshRecent());
  };

  const confirmDiscard = async (): Promise<boolean> => {
    if (!ports.canUndo()) return true;
    return ports.confirm('当前工程有未保存的修改，确定放弃吗？');
  };

  const projectTypes: SaveFileType[] = [
    { description: 'OpenCloth 工程', accept: { 'application/json': [PROJECT_FILE_EXTENSION] } },
  ];

  const projectFileName = (): string => `${ports.project().meta.name}${PROJECT_FILE_EXTENSION}`;

  const saveProjectFile = (askName: boolean): void => {
    void (async () => {
      const target = !askName && savedFile
        ? savedFile
        : await chooseSaveFile(projectFileName(), projectTypes);
      if (!target) return;
      ports.setProjectName(stripExtension(target.name) || ports.project().meta.name);
      const snapshot = await embedProjectAssets(ports.project());
      await target.write(new Blob([projectCodec.encode(snapshot)], { type: 'application/json' }));
      savedFile = target;
      await pushRecent(ports.project());
      service.refreshRecent();
      ports.notify(`已保存「${target.name}」`);
    })().catch(err => ports.notify('保存工程失败：' + (err as Error).message));
  };

  const loadText = (text: string): void => {
    try {
      adopt(projectCodec.decode(text));
    } catch (err) {
      ports.notify('加载工程失败：' + (err as Error).message);
    }
  };

  const commitPatternReplace = (next: Pattern, label: string): void => {
    let before: Pattern | null = null;
    ports.execute({
      label,
      execute(ctx) { before = structuredClone(ctx.project.pattern); ctx.project.pattern = next; },
      undo(ctx) { if (before) ctx.project.pattern = before; },
    });
  };

  const importPatternFile = async (
    accept: string, parse: (text: string) => Pattern, label: string, hint: string,
  ): Promise<void> => {
    const files = await ports.pickFiles(accept, false);
    const file = files?.[0];
    if (!file) return;
    try {
      commitPatternReplace(parse(await readFileAsText(file)), label);
    } catch (err) {
      ports.notify(hint + (err as Error).message);
    }
  };

  const importBinaryPatternFile = async (
    accept: string, parse: (bytes: Uint8Array) => Promise<Pattern>, label: string, hint: string,
  ): Promise<void> => {
    const files = await ports.pickFiles(accept, false);
    const file = files?.[0];
    if (!file) return;
    try {
      commitPatternReplace(await parse(new Uint8Array(await file.arrayBuffer())), label);
    } catch (err) {
      ports.notify(hint + (err as Error).message);
    }
  };

  const service: ProjectService = {
    newProject: () => {
      void (async () => {
        if (!(await confirmDiscard())) return;
        adopt(createBlankProject());
        if (ports.autoSaveSeconds() > 0) void service.writeAutosave();
      })();
    },
    openProjectFile: (file: File) => {
      void (async () => {
        if (!(await confirmDiscard())) return;
        loadText(await readFileAsText(file));
      })().catch(err => ports.notify('打开工程失败：' + (err as Error).message));
    },
    saveProject: () => saveProjectFile(false),
    saveProjectAs: () => saveProjectFile(true),
    reopenRecent: (id: string) => {
      void (async () => {
        if (!(await confirmDiscard())) return;
        const text = await readRecent(id);
        if (!text) { ports.notify('该工程快照已不在本地存档中。'); return; }
        loadText(text);
      })().catch(err => ports.notify('打开工程失败：' + (err as Error).message));
    },
    refreshRecent: () => {
      void listRecent().then((recent: RecentSummary[]) => ports.setRecent(recent));
    },
    clearRecentList: () => {
      void clearRecent().then(() => service.refreshRecent());
    },
    restoreAutosave: (id?: string) => {
      void (async () => {
        if (!(await confirmDiscard())) return;
        const record = await readAutosave(id);
        if (!record) { ports.notify('该自动保存快照已不在本地存档中。'); return; }
        loadText(record.json);
      })().catch(err => ports.notify('恢复自动保存失败：' + (err as Error).message));
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
