import type { Command, ProjectContext } from '@/commands';
import type {
  AvatarDisplay, EnvironmentSource, LightType, ObjectTransform, Project, RayTracingConfig,
  ReferenceObjectRef, SceneLight, SimulationConfig, ToneMappingMode,
} from '@/model/types';
import type { GarmentEngine } from '@/runtime';
import type { MutableRefObject } from 'react';

import {
  LIGHT_TYPE_LABELS, convertLightIntensity, createLight, normalizeLights, normalizeRayTracing,
  collectionMemberRows, isNodeVisibleWritable, lightAtPosition, lightNodeId, parseSceneRef,
  readNodeTransform, readNodeVisible, writeNodeTransform, writeNodeVisible,
} from '@/model';

export type EngineRef = MutableRefObject<GarmentEngine | null>;

export interface SceneServicePorts {
  project(): Project;
  execute(command: Command): void;
  selection(): string[];
  select(ids: string[]): void;
  clearSelection(): void;
  notifyRefObjectsChanged(): void;
}

export interface SceneService {
  previewTransform(nodeId: string, transform: ObjectTransform, engineRef: EngineRef): void;
  commitTransform(nodeId: string, transform: ObjectTransform, engineRef: EngineRef, label?: string): void;
  commitPanelTransforms(entries: readonly { panelId: string; transform: ObjectTransform }[], label?: string): void;
  setNodeVisible(nodeId: string, visible: boolean, engineRef?: EngineRef): void;
  setNodesVisible(nodeIds: readonly string[], visible: boolean, engineRef?: EngineRef): void;
  setPanelsVisible(panelIds: string[], visible: boolean): void;
  setAvatarDisplay(display: AvatarDisplay, engineRef: EngineRef, label?: string): void;
  patchValue<T>(
    label: string,
    read: (p: Project) => T,
    write: (ctx: ProjectContext, value: T) => void,
    value: T,
  ): void;
  commitReferenceOpacity(refId: string, opacity: number, engineRef: EngineRef): void;
  removeReference(refId: string): void;
  commitReferenceImport(record: ReferenceObjectRef): void;
  commitClearReferences(): void;
  commitAvatarModel(objectKey: string, modelName: string): void;
  commitEnvironmentImport(objectKey: string, name: string): void;
  commitEnvironmentSource(source: EnvironmentSource): void;
  commitEnvironmentReset(): void;
  setSimulationConfig(label: string, patch: Partial<SimulationConfig>): void;
  setToneMapping(mode: ToneMappingMode): void;
  setRayTracingConfig(label: string, patch: Partial<RayTracingConfig>): void;
  addLight(type: LightType): void;
  removeLight(id: string): void;
  patchLight(id: string, label: string, patch: Partial<SceneLight>): void;
}

export function createSceneService(ports: SceneServicePorts): SceneService {
  const project = () => ports.project();

  const previewTransform: SceneService['previewTransform'] = (nodeId, transform, engineRef) => {
    const ref = parseSceneRef(nodeId);
    if (ref.kind === 'avatar') {
      engineRef.current?.applyAvatarTransform({ ...project().avatar, transform }, false);
      return;
    }

    if (ref.kind === 'floor') {
      engineRef.current?.setFloorTransform(transform);
      return;
    }

    if (ref.kind === 'reference') {
      engineRef.current?.setReferenceTransform(ref.id, transform);
      return;
    }

    if (ref.kind === 'light') {
      const moved = lightAtPosition(project().scene.lights, ref.id, transform.position);
      if (moved) engineRef.current?.setLightPosition(moved);
    }
  };

  const commitTransform: SceneService['commitTransform'] = (nodeId, transform, engineRef, label = '修改变换') => {
    const before = readNodeTransform(project(), nodeId);
    if (!before) return;
    const nodeRef = parseSceneRef(nodeId);
    const apply = (ctx: ProjectContext, value: ObjectTransform) => {
      if (!writeNodeTransform(ctx.project, nodeId, value)) return;
      if (nodeRef.kind === 'avatar') {
        engineRef.current?.applyAvatarTransform(ctx.project.avatar);
        return;
      }

      if (nodeRef.kind === 'floor') {
        engineRef.current?.setFloorTransform(value);
        return;
      }

      if (nodeRef.kind === 'reference') {
        engineRef.current?.setReferenceTransform(nodeRef.id, value);
        ctx.project.scene = { ...ctx.project.scene };
        ports.notifyRefObjectsChanged();
      }
    };

    ports.execute({
      label,
      execute: ctx => apply(ctx, transform),
      undo: ctx => apply(ctx, before),
    });
  };

  const commitPanelTransforms: SceneService['commitPanelTransforms'] = (entries, label = '3D 变换') => {
    if (entries.length === 0) return;
    const before = entries.map(entry => readNodeTransform(project(), entry.panelId));
    if (before.some(value => value === null)) return;
    const apply = (ctx: ProjectContext, values: readonly ObjectTransform[]) => {
      entries.forEach((entry, i) => writeNodeTransform(ctx.project, entry.panelId, values[i]!));
    };
    ports.execute({
      label,
      execute: ctx => apply(ctx, entries.map(entry => entry.transform)),
      undo: ctx => apply(ctx, before as ObjectTransform[]),
    });
  };

  const patchValue: SceneService['patchValue'] = (label, read, write, value) => {
    const before = read(project());
    if (Object.is(before, value)) return;
    ports.execute({
      label,
      execute: ctx => write(ctx, value),
      undo: ctx => write(ctx, before),
    });
  };

  const VISIBILITY_NOUN: Record<string, string> = {
    panel: '版片', seam: '缝合线', print: '印花', topstitch: '明线', trim: '辅料',
    avatar: '模特', reference: '参考物', light: '光源', environment: '环境光', floor: '地板',
  };

  function applyLiveVisibility(nodeIds: readonly string[], values: boolean[], engineRef?: EngineRef): void {
    const engine = engineRef?.current;
    if (!engine) return;
    nodeIds.forEach((nodeId, i) => {
      const ref = parseSceneRef(nodeId);
      if (ref.kind === 'reference') engine.setReferenceVisible(ref.id, values[i]!);
    });
  }

  function expandCollections(current: Project, nodeIds: readonly string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const nodeId of nodeIds) {
      const members = parseSceneRef(nodeId).kind === 'collection' ? collectionMemberRows(current, nodeId) : [nodeId];
      for (const member of members) {
        if (seen.has(member) || !isNodeVisibleWritable(current, member)) continue;
        seen.add(member);
        out.push(member);
      }
    }

    return out;
  }

  function touchesReferences(nodeIds: readonly string[]): boolean {
    return nodeIds.some(nodeId => parseSceneRef(nodeId).kind === 'reference');
  }

  const setNodesVisible: SceneService['setNodesVisible'] = (nodeIds, visible, engineRef) => {
    const current = project();
    const writable = nodeIds.filter(nodeId => isNodeVisibleWritable(current, nodeId));
    const targets = expandCollections(current, writable);
    if (targets.length === 0) return;
    const before = targets.map(nodeId => readNodeVisible(current, nodeId) === true);
    if (before.every(value => value === visible)) return;
    const noun = VISIBILITY_NOUN[parseSceneRef(targets[0]!).kind] ?? '对象';
    const apply = (ctx: ProjectContext, values: boolean[]): void => {
      targets.forEach((nodeId, i) => writeNodeVisible(ctx.project, nodeId, values[i]!));
      applyLiveVisibility(targets, values, engineRef);
      if (touchesReferences(targets)) ports.notifyRefObjectsChanged();
    };
    ports.execute({
      label: `${visible ? '显示' : '隐藏'}${noun}`,
      execute: ctx => apply(ctx, targets.map(() => visible)),
      undo: ctx => apply(ctx, before),
    });
  };

  const setNodeVisible: SceneService['setNodeVisible'] = (nodeId, visible, engineRef) => {
    setNodesVisible([nodeId], visible, engineRef);
  };

  function applyAvatarDisplay(ctx: ProjectContext, display: AvatarDisplay, engineRef: EngineRef): void {
    ctx.project.avatar.display = display;
    engineRef.current?.applyAvatarDisplay(display);
  }

  const setAvatarDisplay: SceneService['setAvatarDisplay'] = (display, engineRef, label = '修改模特显示') => {
    patchValue(
      label,
      p => p.avatar.display,
      (ctx, value) => applyAvatarDisplay(ctx, value, engineRef),
      display,
    );
  };

  const setPanelsVisible: SceneService['setPanelsVisible'] = (panelIds, visible) => {
    setNodesVisible(panelIds, visible);
  };

  const commitReferenceOpacity: SceneService['commitReferenceOpacity'] = (refId, opacity, engineRef) => {
    patchValue(
      '修改参考物透明度',
      p => (p.scene.referenceObjects ?? []).find(r => r.id === refId)?.opacity ?? 1,
      (ctx, v) => {
        const ref = (ctx.project.scene.referenceObjects ?? []).find(r => r.id === refId);
        if (ref) ref.opacity = v;
        engineRef.current?.setReferenceOpacity(refId, v);
        ctx.project.scene = { ...ctx.project.scene };
        ports.notifyRefObjectsChanged();
      },
      opacity,
    );
  };

  const removeReference: SceneService['removeReference'] = refId => {
    const current = project().scene.referenceObjects ?? [];
    patchValue(
      '删除参考物',
      p => p.scene.referenceObjects ?? [],
      (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, referenceObjects: v }; },
      current.filter(r => r.id !== refId),
    );
    ports.notifyRefObjectsChanged();
  };

  const commitReferenceImport: SceneService['commitReferenceImport'] = record => {
    patchValue(
      '导入参考物',
      p => p.scene.referenceObjects ?? [],
      (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, referenceObjects: v }; },
      [...(project().scene.referenceObjects ?? []), record],
    );
    ports.notifyRefObjectsChanged();
  };

  const commitClearReferences: SceneService['commitClearReferences'] = () => {
    patchValue(
      '清除参考物',
      p => p.scene.referenceObjects ?? [],
      (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, referenceObjects: v }; },
      [],
    );
    ports.notifyRefObjectsChanged();
  };

  const commitAvatarModel: SceneService['commitAvatarModel'] = (objectKey, modelName) => {
    const current = project();
    patchValue(
      '导入模特',
      p => p.avatar,
      (ctx, v) => { ctx.project.avatar = { ...v }; },
      {
        ...current.avatar, source: 'glb', glbObjectKey: objectKey, modelName, display: 'visible',
        glbUrl: undefined,
      },
    );
  };

  const commitEnvironmentImport: SceneService['commitEnvironmentImport'] = (objectKey, name) => {
    const lights = project().scene.lights;
    patchValue(
      '导入环境图',
      p => p.scene.lights,
      (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, lights: v }; },
      { ...lights, iblObjectKey: objectKey, iblName: name, iblUrl: undefined, iblSource: 'custom' },
    );
  };

  const commitEnvironmentSource: SceneService['commitEnvironmentSource'] = source => {
    const lights = project().scene.lights;
    patchValue(
      '切换环境图',
      p => p.scene.lights,
      (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, lights: v }; },
      { ...lights, iblSource: source },
    );
  };

  const commitEnvironmentReset: SceneService['commitEnvironmentReset'] = () => {
    const lights = project().scene.lights;
    patchValue(
      '移除环境图',
      p => p.scene.lights,
      (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, lights: v }; },
      { ...lights, iblObjectKey: undefined, iblName: undefined, iblUrl: undefined, iblSource: 'builtin' },
    );
  };

  const setSimulationConfig: SceneService['setSimulationConfig'] = (label, patch) => {
    patchValue(
      label,
      p => p.scene.simulation,
      (ctx, value) => {
        ctx.project.scene = { ...ctx.project.scene, simulation: value };
      },
      { ...project().scene.simulation, ...patch },
    );
  };

  const setToneMapping: SceneService['setToneMapping'] = mode => {
    patchValue(
      '修改色调映射',
      p => p.scene.render.toneMapping,
      (ctx, value) => {
        ctx.project.scene = { ...ctx.project.scene, render: { ...ctx.project.scene.render, toneMapping: value } };
      },
      mode,
    );
  };

  const setRayTracingConfig: SceneService['setRayTracingConfig'] = (label, patch) => {
    patchValue(
      label,
      p => normalizeRayTracing(p.scene.render.rayTracing),
      (ctx, value) => {
        ctx.project.scene = { ...ctx.project.scene, render: { ...ctx.project.scene.render, rayTracing: value } };
      },
      { ...normalizeRayTracing(project().scene.render.rayTracing), ...patch },
    );
  };

  function writeLights(ctx: ProjectContext, lights: SceneLight[]): void {
    ctx.project.scene = { ...ctx.project.scene, lights: { ...ctx.project.scene.lights, lights } };
  }

  const addLight: SceneService['addLight'] = type => {
    const current = normalizeLights(project().scene.lights);
    const light = createLight(type, current.filter(l => l.type === type).length + 1);
    patchValue(
      `添加${LIGHT_TYPE_LABELS[type]}`,
      p => normalizeLights(p.scene.lights),
      (ctx, value) => writeLights(ctx, value),
      [...current, light],
    );
    ports.select([lightNodeId(light.id)]);
  };

  const removeLight: SceneService['removeLight'] = id => {
    const current = normalizeLights(project().scene.lights);
    patchValue(
      '删除光源',
      p => normalizeLights(p.scene.lights),
      (ctx, value) => writeLights(ctx, value),
      current.filter(light => light.id !== id),
    );
    if (ports.selection().includes(lightNodeId(id))) ports.clearSelection();
  };

  const patchLight: SceneService['patchLight'] = (id, label, patch) => {
    patchValue(
      label,
      p => normalizeLights(p.scene.lights),
      (ctx, value) => writeLights(ctx, value),
      normalizeLights(project().scene.lights).map(light => {
        if (light.id !== id) return light;
        if (!patch.type || patch.type === light.type) return { ...light, ...patch };
        return {
          ...light,
          ...patch,
          intensity: convertLightIntensity(light.type, patch.type, patch.intensity ?? light.intensity),
        };
      }),
    );
  };

  return {
    previewTransform,
    commitTransform,
    commitPanelTransforms,
    setNodeVisible,
    setNodesVisible,
    setPanelsVisible,
    setAvatarDisplay,
    patchValue,
    commitReferenceOpacity,
    removeReference,
    commitReferenceImport,
    commitClearReferences,
    commitAvatarModel,
    commitEnvironmentImport,
    commitEnvironmentSource,
    commitEnvironmentReset,
    setSimulationConfig,
    setToneMapping,
    setRayTracingConfig,
    addLight,
    removeLight,
    patchLight,
  };
}
