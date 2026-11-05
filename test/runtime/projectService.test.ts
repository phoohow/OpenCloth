import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/model/types';
import { createProjectService, type ProjectServicePorts } from '@/runtime/projectService';
import { createBlankProject } from '@/pattern/template';
import { projectCodec, downloadTextFile } from '@/io/serialization/codec';
import * as archive from '@/io/storage/projectArchive';
import * as projectPackage from '@/io/storage/projectPackage';

vi.mock('@/io/storage/projectArchive', () => ({
  listRecent: vi.fn(),
  listAutosaves: vi.fn(),
  pushRecent: vi.fn(),
  pruneOrphanBlobs: vi.fn(),
  clearRecent: vi.fn(),
  readRecent: vi.fn(),
  readAutosave: vi.fn(),
  saveAutosave: vi.fn(),
}));

vi.mock('@/io/storage/projectPackage', () => ({
  embedProjectAssets: vi.fn(async (project: Project) => project),
}));

vi.mock('@/io/serialization/codec', async importOriginal => {
  const actual = await importOriginal<typeof import('@/io/serialization/codec')>();
  return {
    ...actual,
    downloadTextFile: vi.fn(),
    readFileAsText: vi.fn(async (file: File) => file.text()),
  };
});

/** Project service over in-memory ports; async snapshot work is mocked. */
function makeService(project: Project = createBlankProject(), autoSaveSeconds = 0) {
  let current = project;
  const ports: ProjectServicePorts = {
    project: () => current,
    load: vi.fn(loaded => { current = loaded; }),
    canUndo: () => false,
    execute: vi.fn(command => {
      const draft = structuredClone(current);
      command.execute({ project: draft });
      current = draft;
    }),
    autoSaveSeconds: () => autoSaveSeconds,
    setAutoSaveSeconds: vi.fn(),
    setRecent: vi.fn(),
    setAutosaves: vi.fn(),
    setLastAutosaveAt: vi.fn(),
    pickFiles: vi.fn(async () => null),
    confirm: vi.fn(() => true),
    prompt: vi.fn(() => '改名工程'),
    alert: vi.fn(),
  };
  return { service: createProjectService(ports), ports, project: () => current };
}

beforeEach(() => {
  vi.mocked(archive.listRecent).mockResolvedValue([]);
  vi.mocked(archive.listAutosaves).mockResolvedValue([]);
  vi.mocked(archive.pushRecent).mockResolvedValue();
  vi.mocked(archive.pruneOrphanBlobs).mockResolvedValue();
  vi.mocked(archive.clearRecent).mockResolvedValue();
  vi.mocked(archive.saveAutosave).mockResolvedValue(null);
  vi.mocked(archive.readAutosave).mockResolvedValue(null);
  vi.mocked(downloadTextFile).mockClear();
});

describe('projectService', () => {
  it('新建工程载入空白工程，并按自动保存开关写入快照', () => {
    const { service, ports } = makeService();
    service.newProject();
    expect(ports.load).toHaveBeenCalled();
    expect(ports.project().pattern.panels).toEqual({});
    expect(archive.saveAutosave).not.toHaveBeenCalled();
  });

  it('打开工程文件解析 JSON 后替换当前工程', async () => {
    const fileProject = createBlankProject();
    fileProject.meta.name = '来自文件';
    const file = new File([projectCodec.encode(fileProject)], 'p.ocproj.json', { type: 'application/json' });

    const { service, ports } = makeService();
    service.openProjectFile(file);

    await vi.waitFor(() => expect(ports.load).toHaveBeenCalled());
    expect(ports.project().meta.name).toBe('来自文件');
  });

  it('另存为改名后下载工程 JSON', async () => {
    const { service, ports } = makeService();
    service.saveProjectAs();

    expect(ports.project().meta.name).toBe('改名工程');
    await vi.waitFor(() => expect(downloadTextFile).toHaveBeenCalled());
    expect(vi.mocked(downloadTextFile).mock.calls[0]![0]).toBe('改名工程.ocproj.json');
    expect(vi.mocked(projectPackage.embedProjectAssets)).toHaveBeenCalled();
  });

  it('启动恢复只读取一次最新快照', async () => {
    const saved = createBlankProject();
    saved.meta.name = '自动保存工程';
    vi.mocked(archive.readAutosave).mockResolvedValue({
      id: 'auto-1', savedAt: '2026-01-01T00:00:00.000Z', json: projectCodec.encode(saved),
    });
    const { service, ports } = makeService(createBlankProject(), 30);

    service.restoreAutosaveOnStartup();
    service.restoreAutosaveOnStartup();

    await vi.waitFor(() => expect(ports.load).toHaveBeenCalled());
    expect(archive.readAutosave).toHaveBeenCalledTimes(1);
    expect(ports.project().meta.name).toBe('自动保存工程');
    expect(ports.setLastAutosaveAt).toHaveBeenCalledWith('2026-01-01T00:00:00.000Z');
  });

  it('刷新最近列表与清空最近列表都回写 store', async () => {
    vi.mocked(archive.listRecent).mockResolvedValue([{ id: 'r1', name: '最近工程', savedAt: '2026-01-01T00:00:00.000Z' }]);
    const { service, ports } = makeService();

    service.refreshRecent();
    await vi.waitFor(() => expect(ports.setRecent).toHaveBeenCalled());
    expect(ports.setRecent).toHaveBeenCalledWith([{ id: 'r1', name: '最近工程', savedAt: '2026-01-01T00:00:00.000Z' }]);

    service.clearRecentList();
    await vi.waitFor(() => expect(archive.clearRecent).toHaveBeenCalled());
  });
});
