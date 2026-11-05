import type { MutableRefObject } from 'react';
import type {
  AvatarDisplay, LightType, ObjectTransform, Project, RayTracingConfig, ReferenceObjectRef, SceneLight,
  SimulationConfig, ToneMappingMode,
} from '@/model/types';
import type { Command, ProjectContext } from '@/commands';
import {
  LIGHT_TYPE_LABELS, createLight, normalizeLights, normalizeRayTracing,
} from '@/model';
import { SetGlobalMeshResolutionCommand } from '@/commands';
import type { GarmentEngine } from '@/runtime/garmentEngine';
import {
  AVATAR_NODE_ID, lightNodeId, readTransform, referenceObjectId, writeTransform,
} from '@/model';

/** Live engine of the 3D viewport, null before the first render. */
export type EngineRef = MutableRefObject<GarmentEngine | null>;

/** Host callbacks the scene service needs from the composition root. */
export interface SceneServicePorts {
  /** Current project data. */
  project(): Project;
  /** Runs an edit through the project undo history. */
  execute(command: Command): void;
  /** Current outliner selection. */
  selection(): string[];
  /** Selects outliner rows. */
  select(ids: string[]): void;
  /** Clears the outliner selection. */
  clearSelection(): void;
  /** Signals that the reference object list changed. */
  notifyRefObjectsChanged(): void;
}

/** Scene edits shared by the viewports, panels and menu; bound to the host once. */
export interface SceneService {
  previewTransform(nodeId: string, transform: ObjectTransform, engineRef: EngineRef): void;
  commitTransform(nodeId: string, transform: ObjectTransform, engineRef: EngineRef, label?: string): void;
  setPanelsVisible(panelIds: string[], visible: boolean): void;
  setReferencesVisible(refIds: string[], visible: boolean, engineRef: EngineRef): void;
  setAvatarVisible(visible: boolean, engineRef: EngineRef): void;
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
  commitEnvironmentReset(): void;
  setSimulationConfig(label: string, patch: Partial<SimulationConfig>): void;
  setGlobalMeshResolution(cm: number): void;
  setToneMapping(mode: ToneMappingMode): void;
  setRayTracingConfig(label: string, patch: Partial<RayTracingConfig>): void;
  addLight(type: LightType): void;
  removeLight(id: string): void;
  patchLight(id: string, label: string, patch: Partial<SceneLight>): void;
  setLightsEnabled(ids: string[], enabled: boolean): void;
  setEnvironmentEnabled(enabled: boolean): void;
  setSeamsStitchVisible(seamIds: string[], visible: boolean): void;
  setProductionVisible(kind: ProductionKind, ids: string[], visible: boolean): void;
}

/** Production object kinds that carry their own visibility flag. */
export type ProductionKind = 'print' | 'topstitch' | 'trim';

/** Builds the scene service over the host's project, history and selection. */
export function createSceneService(ports: SceneServicePorts): SceneService {
  const project = () => ports.project();

  /** Places an avatar or reference object on the live scene without changing project data. */
  const previewTransform: SceneService['previewTransform'] = (nodeId, transform, engineRef) => {
    if (nodeId === AVATAR_NODE_ID) {
      engineRef.current?.applyAvatarTransform({ ...project().avatar, transform });
      return;
    }
    if (nodeId.startsWith('@ref:')) {
      engineRef.current?.setReferenceTransform(referenceObjectId(nodeId), transform);
    }
  };

  /** Writes a scene transform; panel edits rebuild the cloth, other edits only move the object. */
  const commitTransform: SceneService['commitTransform'] = (nodeId, transform, engineRef, label = '修改变换') => {
    const before = readTransform(project(), nodeId);
    if (!before) return;

    const apply = (ctx: ProjectContext, value: ObjectTransform) => {
      writeTransform(ctx.project, nodeId, value);
      if (nodeId === AVATAR_NODE_ID) {
        engineRef.current?.applyAvatarTransform(ctx.project.avatar);
        return;
      }
      if (nodeId.startsWith('@ref:')) {
        engineRef.current?.setReferenceTransform(referenceObjectId(nodeId), value);
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

  /** Runs an undoable edit of one value, restoring the value captured before the edit. */
  const patchValue: SceneService['patchValue'] = (label, read, write, value) => {
    const before = read(project());
    if (Object.is(before, value)) return;
    ports.execute({
      label,
      execute: ctx => write(ctx, value),
      undo: ctx => write(ctx, before),
    });
  };

  function applyPanelVisibility(ctx: ProjectContext, ids: string[], values: boolean[]): void {
    ids.forEach((id, i) => {
      const panel = ctx.project.pattern.panels[id];
      if (panel) panel.visible = values[i];
    });
    // Visibility is a draw-only flag, so the cloth keeps simulating.
  }

  /** Sets viewport visibility for a set of panels as one undoable step. */
  const setPanelsVisible: SceneService['setPanelsVisible'] = (panelIds, visible) => {
    const before = panelIds.map(id => project().pattern.panels[id]?.visible ?? true);
    ports.execute({
      label: visible ? '显示版片' : '隐藏版片',
      execute: ctx => applyPanelVisibility(ctx, panelIds, panelIds.map(() => visible)),
      undo: ctx => applyPanelVisibility(ctx, panelIds, before),
    });
  };

  function applyReferenceVisibility(
    ctx: ProjectContext, ids: string[], values: boolean[], engineRef: EngineRef,
  ): void {
    ids.forEach((id, i) => {
      const ref = (ctx.project.scene.referenceObjects ?? []).find(r => r.id === id);
      if (ref) ref.visible = values[i];
      engineRef.current?.setReferenceVisible(id, values[i]);
    });
    ctx.project.scene = { ...ctx.project.scene };
    ports.notifyRefObjectsChanged();
  }

  /** Sets viewport visibility for a set of reference objects as one undoable step. */
  const setReferencesVisible: SceneService['setReferencesVisible'] = (refIds, visible, engineRef) => {
    const refs = project().scene.referenceObjects ?? [];
    const before = refIds.map(id => refs.find(r => r.id === id)?.visible ?? true);
    ports.execute({
      label: visible ? '显示参考物体' : '隐藏参考物体',
      execute: ctx => applyReferenceVisibility(ctx, refIds, refIds.map(() => visible), engineRef),
      undo: ctx => applyReferenceVisibility(ctx, refIds, before, engineRef),
    });
  };

  function applyAvatarDisplay(ctx: ProjectContext, display: AvatarDisplay, engineRef: EngineRef): void {
    ctx.project.avatar.display = display;
    engineRef.current?.applyAvatarDisplay(display);
  }

  /** Sets the avatar's viewport display mode. */
  const setAvatarDisplay: SceneService['setAvatarDisplay'] = (display, engineRef, label = '修改模特显示') => {
    patchValue(
      label,
      p => p.avatar.display,
      (ctx, value) => applyAvatarDisplay(ctx, value, engineRef),
      display,
    );
  };

  /** Switches the avatar between shown and hidden in the viewport. */
  const setAvatarVisible: SceneService['setAvatarVisible'] = (visible, engineRef) => {
    setAvatarDisplay(visible ? 'visible' : 'hidden', engineRef, visible ? '显示模特' : '隐藏模特');
  };

  /** Sets a reference object's opacity on the live scene and in the project. */
  const commitReferenceOpacity: SceneService['commitReferenceOpacity'] = (refId, opacity, engineRef) => {
    patchValue(
      '修改参考物体透明度',
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

  /** Drops a reference object from the project; the viewport scene follows the list. */
  const removeReference: SceneService['removeReference'] = refId => {
    const current = project().scene.referenceObjects ?? [];
    patchValue(
      '删除参考物体',
      p => p.scene.referenceObjects ?? [],
      (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, referenceObjects: v }; },
      current.filter(r => r.id !== refId),
    );
    ports.notifyRefObjectsChanged();
  };

  /** Adds an imported reference object record; the viewport keeps its scene meshes in sync. */
  const commitReferenceImport: SceneService['commitReferenceImport'] = record => {
    patchValue(
      '导入参考物体',
      p => p.scene.referenceObjects ?? [],
      (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, referenceObjects: v }; },
      [...(project().scene.referenceObjects ?? []), record],
    );
    ports.notifyRefObjectsChanged();
  };

  /** Removes every reference object record from the scene list. */
  const commitClearReferences: SceneService['commitClearReferences'] = () => {
    patchValue(
      '清除全部参考物体',
      p => p.scene.referenceObjects ?? [],
      (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, referenceObjects: v }; },
      [],
    );
    ports.notifyRefObjectsChanged();
  };

  /** Points the avatar at a stored model blob; the viewport rebuilds the body and cloth. */
  const commitAvatarModel: SceneService['commitAvatarModel'] = (objectKey, modelName) => {
    const current = project();
    patchValue(
      '导入模特',
      p => p.avatar,
      (ctx, v) => { ctx.project.avatar = { ...v }; },
      {
        ...current.avatar, source: 'glb', glbObjectKey: objectKey, modelName, display: 'visible',
        glbUrl: undefined, heightCm: current.avatar.params.heightCm,
      },
    );
  };

  /** Stores an imported environment image in the lights block. */
  const commitEnvironmentImport: SceneService['commitEnvironmentImport'] = (objectKey, name) => {
    const lights = project().scene.lights;
    patchValue(
      '导入环境图',
      p => p.scene.lights,
      (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, lights: v }; },
      { ...lights, iblObjectKey: objectKey, iblName: name, iblUrl: undefined },
    );
  };

  /** Reverts the environment image to the bundled one. */
  const commitEnvironmentReset: SceneService['commitEnvironmentReset'] = () => {
    const lights = project().scene.lights;
    patchValue(
      '恢复内置环境图',
      p => p.scene.lights,
      (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, lights: v }; },
      { ...lights, iblObjectKey: undefined, iblName: undefined, iblUrl: undefined },
    );
  };

  /** Edits one global simulation field; the solver reads the block every step. */
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

  /** Applies one mesh edge length to every panel through the project's undo history. */
  const setGlobalMeshResolution: SceneService['setGlobalMeshResolution'] = cm => {
    ports.execute(new SetGlobalMeshResolutionCommand(cm));
  };

  /** Edits the tone-mapping mode. */
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

  /** Edits one or more WebGPU ray tracing settings. */
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

  /** Stores a light list back into the project; the viewport rebuilds its lights from the change. */
  function writeLights(ctx: ProjectContext, lights: SceneLight[]): void {
    ctx.project.scene = { ...ctx.project.scene, lights: { ...ctx.project.scene.lights, lights } };
  }

  /** Adds a light of this type and selects it in the outliner. */
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

  /** Removes one light from the scene. */
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

  /** Edits the listed fields of one light. */
  const patchLight: SceneService['patchLight'] = (id, label, patch) => {
    patchValue(
      label,
      p => normalizeLights(p.scene.lights),
      (ctx, value) => writeLights(ctx, value),
      normalizeLights(project().scene.lights).map(light => light.id === id ? { ...light, ...patch } : light),
    );
  };

  /** Turns the listed lights on or off in the viewport. */
  const setLightsEnabled: SceneService['setLightsEnabled'] = (ids, enabled) => {
    patchValue(
      enabled ? '开启光源' : '关闭光源',
      p => normalizeLights(p.scene.lights),
      (ctx, value) => writeLights(ctx, value),
      normalizeLights(project().scene.lights).map(light => ids.includes(light.id) ? { ...light, enabled } : light),
    );
  };

  /** Turns the environment light on or off, keeping its image and strength. */
  const setEnvironmentEnabled: SceneService['setEnvironmentEnabled'] = enabled => {
    patchValue(
      enabled ? '开启环境光' : '关闭环境光',
      p => p.scene.lights.iblEnabled,
      (ctx, value) => {
        ctx.project.scene = { ...ctx.project.scene, lights: { ...ctx.project.scene.lights, iblEnabled: value } };
      },
      enabled,
    );
  };

  function applySeamStitch(ctx: ProjectContext, seamIds: string[], values: boolean[]): void {
    seamIds.forEach((id, i) => {
      const seam = ctx.project.pattern.seams[id];
      if (seam) seam.stitchVisible = values[i];
    });
  }

  /** Shows or hides the stitched thread of the listed seams in the 3D viewport. */
  const setSeamsStitchVisible: SceneService['setSeamsStitchVisible'] = (seamIds, visible) => {
    const before = seamIds.map(id => project().pattern.seams[id]?.stitchVisible ?? true);
    ports.execute({
      label: visible ? '显示缝纫线' : '隐藏缝纫线',
      execute: ctx => applySeamStitch(ctx, seamIds, seamIds.map(() => visible)),
      undo: ctx => applySeamStitch(ctx, seamIds, before),
    });
  };

  /** Pattern collection backing one production object kind. */
  function productionRecords(
    pattern: Project['pattern'], kind: ProductionKind,
  ): Record<string, { visible: boolean }> {
    return kind === 'print' ? pattern.prints : kind === 'topstitch' ? pattern.topstitches : pattern.trims;
  }

  function applyProductionVisibility(
    ctx: ProjectContext, kind: ProductionKind, ids: string[], values: boolean[],
  ): void {
    const records = productionRecords(ctx.project.pattern, kind);
    ids.forEach((id, i) => { records[id].visible = values[i]; });
  }

  /** Sets viewport visibility of print, topstitch and trim records as one undoable step. */
  const setProductionVisible: SceneService['setProductionVisible'] = (kind, ids, visible) => {
    if (ids.length === 0) return;
    const records = productionRecords(project().pattern, kind);
    const before = ids.map(id => records[id]?.visible ?? true);
    ports.execute({
      label: visible ? '显示生产物件' : '隐藏生产物件',
      execute: ctx => applyProductionVisibility(ctx, kind, ids, ids.map(() => visible)),
      undo: ctx => applyProductionVisibility(ctx, kind, ids, before),
    });
  };

  return {
    previewTransform,
    commitTransform,
    setPanelsVisible,
    setReferencesVisible,
    setAvatarVisible,
    setAvatarDisplay,
    patchValue,
    commitReferenceOpacity,
    removeReference,
    commitReferenceImport,
    commitClearReferences,
    commitAvatarModel,
    commitEnvironmentImport,
    commitEnvironmentReset,
    setSimulationConfig,
    setGlobalMeshResolution,
    setToneMapping,
    setRayTracingConfig,
    addLight,
    removeLight,
    patchLight,
    setLightsEnabled,
    setEnvironmentEnabled,
    setSeamsStitchVisible,
    setProductionVisible,
  };
}
