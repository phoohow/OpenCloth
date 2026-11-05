import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@/model/types';
import type { Command } from '@/model/types';
import type { GarmentEngine } from '@/runtime/garmentEngine';
import { createSceneService, type EngineRef } from '@/runtime/sceneService';
import type { SceneServicePorts } from '@/runtime/sceneService';
import { createStarterProject } from '@/pattern/template';

/** Scene service over a mutable project with a one-level undo history. */
function makeService(project: Project = createStarterProject()) {
  let current = project;
  const history: Command[] = [];
  let selection: string[] = [];
  const notifyRefObjectsChanged = vi.fn();
  const ports: SceneServicePorts = {
    project: () => current,
    execute: command => {
      const draft = structuredClone(current);
      command.execute({ project: draft });
      current = draft;
      history.push(command);
    },
    selection: () => selection,
    select: ids => { selection = ids; },
    clearSelection: () => { selection = []; },
    notifyRefObjectsChanged,
  };
  return {
    service: createSceneService(ports),
    history,
    notifyRefObjectsChanged,
    selection: () => selection,
    project: () => current,
  };
}

function fakeEngine(): EngineRef {
  return {
    current: {
      applyAvatarDisplay: vi.fn(),
      applyAvatarTransform: vi.fn(),
      setReferenceOpacity: vi.fn(),
    } as unknown as GarmentEngine,
  };
}

describe('sceneService', () => {
  it('面板可见性走撤销历史', () => {
    const { service, history, project } = makeService();
    const panelId = Object.keys(project().pattern.panels)[0]!;
    const before = project().pattern.panels[panelId]!.visible;

    service.setPanelsVisible([panelId], false);
    expect(project().pattern.panels[panelId]!.visible).toBe(false);
    expect(history.at(-1)!.label).toBe('隐藏版片');

    history.at(-1)!.undo({ project: project() });
    expect(project().pattern.panels[panelId]!.visible).toBe(before);
  });

  it('模特显示切换写入工程并同步引擎', () => {
    const { service, project } = makeService();
    const engine = fakeEngine();

    service.setAvatarDisplay('hidden', engine);
    expect(project().avatar.display).toBe('hidden');
    expect(engine.current!.applyAvatarDisplay).toHaveBeenCalledWith('hidden');
  });

  it('新增光源会选中新行，删除时清掉选择', () => {
    const { service, project, selection } = makeService();
    const before = project().scene.lights.lights.length;

    service.addLight('spot');
    const lights = project().scene.lights.lights;
    expect(lights).toHaveLength(before + 1);
    const added = lights.at(-1)!;
    expect(selection()).toEqual([`@light:${added.id}`]);

    service.removeLight(added.id);
    expect(project().scene.lights.lights).toHaveLength(before);
    expect(selection()).toEqual([]);
  });

  it('模拟参数只合并指定字段', () => {
    const { service, project } = makeService();
    const before = project().scene.simulation;

    service.setSimulationConfig('修改重力', { gravity: { x: 0, y: -5, z: 0 } });
    expect(project().scene.simulation.gravity.y).toBe(-5);
    expect(project().scene.simulation.substeps).toBe(before.substeps);
  });

  it('参考物体透明度同时更新工程与场景', () => {
    const project = createStarterProject();
    project.scene.referenceObjects = [{
      id: 'ref-1', name: '参考', objectKey: 'blob', opacity: 1, visible: true,
    }];
    const { service, notifyRefObjectsChanged, project: current } = makeService(project);
    const engine = fakeEngine();

    service.commitReferenceOpacity('ref-1', 0.4, engine);
    expect(current().scene.referenceObjects![0]!.opacity).toBe(0.4);
    expect(engine.current!.setReferenceOpacity).toHaveBeenCalledWith('ref-1', 0.4);
    expect(notifyRefObjectsChanged).toHaveBeenCalled();
  });
});
