import type { MutableRefObject } from 'react';
import type {
  AvatarDisplay, LightType, ObjectTransform, Project, RayTracingConfig, ReferenceObjectRef, SceneLight,
  SimulationConfig, ToneMappingMode,
} from '../core/model/types';
import type { ProjectContext } from '../core/command/command';
import {
  LIGHT_TYPE_LABELS, createLight, normalizeLights, normalizeRayTracing,
} from '../core/model/defaults';
import { useProjectStore, useUIStore } from '../store/stores';
import type { GarmentEngine } from '../core/engine/garmentEngine';
import {
  AVATAR_NODE_ID, lightNodeId, readTransform, referenceObjectId, writeTransform,
} from './sceneTree';

/** Live engine of the 3D viewport, null before the first render. */
export type EngineRef = MutableRefObject<GarmentEngine | null>;

const project = () => useProjectStore.getState().project;

/** Places an avatar or reference object on the live scene without changing project data. */
export function previewTransform(nodeId: string, transform: ObjectTransform, engineRef: EngineRef): void {
  if (nodeId === AVATAR_NODE_ID) {
    engineRef.current?.applyAvatarTransform({ ...project().avatar, transform });
    return;
  }
  if (nodeId.startsWith('@ref:')) {
    engineRef.current?.setReferenceTransform(referenceObjectId(nodeId), transform);
  }
}

/** Writes a scene transform; panel edits rebuild the cloth, other edits only move the object. */
export function commitTransform(
  nodeId: string, transform: ObjectTransform, engineRef: EngineRef, label = '修改变换',
): void {
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
      useUIStore.getState().bumpRefObjects();
      return;
    }
  };

  useProjectStore.getState().executeCommand({
    label,
    execute: ctx => apply(ctx, transform),
    undo: ctx => apply(ctx, before),
  });
}

function applyPanelVisibility(ctx: ProjectContext, ids: string[], values: boolean[]): void {
  ids.forEach((id, i) => {
    const panel = ctx.project.pattern.panels[id];
    if (panel) panel.visible = values[i];
  });
  // Visibility is a draw-only flag, so the cloth keeps simulating.
}

/** Sets viewport visibility for a set of panels as one undoable step. */
export function setPanelsVisible(panelIds: string[], visible: boolean): void {
  const before = panelIds.map(id => project().pattern.panels[id]?.visible ?? true);
  useProjectStore.getState().executeCommand({
    label: visible ? '显示版型片' : '隐藏版型片',
    execute: ctx => applyPanelVisibility(ctx, panelIds, panelIds.map(() => visible)),
    undo: ctx => applyPanelVisibility(ctx, panelIds, before),
  });
}

function applyReferenceVisibility(ctx: ProjectContext, ids: string[], values: boolean[], engineRef: EngineRef): void {
  ids.forEach((id, i) => {
    const ref = (ctx.project.scene.referenceObjects ?? []).find(r => r.id === id);
    if (ref) ref.visible = values[i];
    engineRef.current?.setReferenceVisible(id, values[i]);
  });
  ctx.project.scene = { ...ctx.project.scene };
  useUIStore.getState().bumpRefObjects();
}

/** Sets viewport visibility for a set of reference objects as one undoable step. */
export function setReferencesVisible(refIds: string[], visible: boolean, engineRef: EngineRef): void {
  const refs = project().scene.referenceObjects ?? [];
  const before = refIds.map(id => refs.find(r => r.id === id)?.visible ?? true);
  useProjectStore.getState().executeCommand({
    label: visible ? '显示参考物体' : '隐藏参考物体',
    execute: ctx => applyReferenceVisibility(ctx, refIds, refIds.map(() => visible), engineRef),
    undo: ctx => applyReferenceVisibility(ctx, refIds, before, engineRef),
  });
}

function applyAvatarDisplay(ctx: ProjectContext, display: AvatarDisplay, engineRef: EngineRef): void {
  ctx.project.avatar.display = display;
  engineRef.current?.applyAvatarDisplay(display);
}

/** Switches the avatar between shown and hidden in the viewport. */
export function setAvatarVisible(visible: boolean, engineRef: EngineRef): void {
  setAvatarDisplay(visible ? 'visible' : 'hidden', engineRef, visible ? '显示人体' : '隐藏人体');
}

/** Sets the avatar's viewport display mode. */
export function setAvatarDisplay(display: AvatarDisplay, engineRef: EngineRef, label = '修改人体显示'): void {
  patchValue(
    label,
    p => p.avatar.display,
    (ctx, value) => applyAvatarDisplay(ctx, value, engineRef),
    display,
  );
}

/** Runs an undoable edit of one value, restoring the value captured before the edit. */
export function patchValue<T>(
  label: string,
  read: (p: Project) => T,
  write: (ctx: ProjectContext, value: T) => void,
  value: T,
): void {
  const before = read(project());
  if (Object.is(before, value)) return;
  useProjectStore.getState().executeCommand({
    label,
    execute: ctx => write(ctx, value),
    undo: ctx => write(ctx, before),
  });
}

/** Sets a reference object's opacity on the live scene and in the project. */
export function commitReferenceOpacity(refId: string, opacity: number, engineRef: EngineRef): void {
  patchValue(
    '修改参考物体透明度',
    p => (p.scene.referenceObjects ?? []).find(r => r.id === refId)?.opacity ?? 1,
    (ctx, v) => {
      const ref = (ctx.project.scene.referenceObjects ?? []).find(r => r.id === refId);
      if (ref) ref.opacity = v;
      engineRef.current?.setReferenceOpacity(refId, v);
      ctx.project.scene = { ...ctx.project.scene };
      useUIStore.getState().bumpRefObjects();
    },
    opacity,
  );
}

/** Drops a reference object from the project; the viewport scene follows the list. */
export function removeReference(refId: string): void {
  const current = project().scene.referenceObjects ?? [];
  patchValue(
    '删除参考物体',
    p => p.scene.referenceObjects ?? [],
    (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, referenceObjects: v }; },
    current.filter(r => r.id !== refId),
  );
  useUIStore.getState().bumpRefObjects();
}

/** Adds an imported reference object record; the viewport keeps its scene meshes in sync. */
export function commitReferenceImport(record: ReferenceObjectRef): void {
  patchValue(
    '导入参考物体',
    p => p.scene.referenceObjects ?? [],
    (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, referenceObjects: v }; },
    [...(project().scene.referenceObjects ?? []), record],
  );
  useUIStore.getState().bumpRefObjects();
}

/** Removes every reference object record from the scene list. */
export function commitClearReferences(): void {
  patchValue(
    '清除全部参考物体',
    p => p.scene.referenceObjects ?? [],
    (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, referenceObjects: v }; },
    [],
  );
  useUIStore.getState().bumpRefObjects();
}

/** Points the avatar at a stored model blob; the viewport rebuilds the body and cloth. */
export function commitAvatarModel(objectKey: string, modelName: string): void {
  const current = project();
  patchValue(
    '导入模特',
    p => p.avatar,
    (ctx, v) => { ctx.project.avatar = { ...v }; },
    {
      ...current.avatar, source: 'glb', glbObjectKey: objectKey, modelName,
      glbUrl: undefined, heightCm: current.avatar.params.heightCm,
    },
  );
}

/** Stores an imported environment image in the lights block. */
export function commitEnvironmentImport(objectKey: string, name: string): void {
  const lights = project().scene.lights;
  patchValue(
    '导入环境图',
    p => p.scene.lights,
    (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, lights: v }; },
    { ...lights, iblObjectKey: objectKey, iblName: name, iblUrl: undefined },
  );
}

/** Reverts the environment image to the bundled one. */
export function commitEnvironmentReset(): void {
  const lights = project().scene.lights;
  patchValue(
    '恢复内置环境图',
    p => p.scene.lights,
    (ctx, v) => { ctx.project.scene = { ...ctx.project.scene, lights: v }; },
    { ...lights, iblObjectKey: undefined, iblName: undefined, iblUrl: undefined },
  );
}

/** Edits one global simulation field; the solver reads the block every step. */
export function setSimulationConfig(label: string, patch: Partial<SimulationConfig>): void {
  patchValue(
    label,
    p => p.scene.simulation,
    (ctx, value) => {
      ctx.project.scene = { ...ctx.project.scene, simulation: value };
    },
    { ...project().scene.simulation, ...patch },
  );
}

/** Edits the tone-mapping mode. */
export function setToneMapping(mode: ToneMappingMode): void {
  patchValue(
    '修改色调映射',
    p => p.scene.render.toneMapping,
    (ctx, value) => {
      ctx.project.scene = { ...ctx.project.scene, render: { ...ctx.project.scene.render, toneMapping: value } };
    },
    mode,
  );
}

/** Edits one or more WebGPU ray tracing settings. */
export function setRayTracingConfig(label: string, patch: Partial<RayTracingConfig>): void {
  patchValue(
    label,
    p => normalizeRayTracing(p.scene.render.rayTracing),
    (ctx, value) => {
      ctx.project.scene = { ...ctx.project.scene, render: { ...ctx.project.scene.render, rayTracing: value } };
    },
    { ...normalizeRayTracing(project().scene.render.rayTracing), ...patch },
  );
}

/** Stores a light list back into the project; the viewport rebuilds its lights from the change. */
function writeLights(ctx: ProjectContext, lights: SceneLight[]): void {
  ctx.project.scene = { ...ctx.project.scene, lights: { ...ctx.project.scene.lights, lights } };
}

/** Adds a light of this type and selects it in the outliner. */
export function addLight(type: LightType): void {
  const current = normalizeLights(project().scene.lights);
  const light = createLight(type, current.filter(l => l.type === type).length + 1);
  patchValue(
    `添加${LIGHT_TYPE_LABELS[type]}`,
    p => normalizeLights(p.scene.lights),
    (ctx, value) => writeLights(ctx, value),
    [...current, light],
  );
  useUIStore.getState().select([lightNodeId(light.id)]);
}

/** Removes one light from the scene. */
export function removeLight(id: string): void {
  const current = normalizeLights(project().scene.lights);
  patchValue(
    '删除光源',
    p => normalizeLights(p.scene.lights),
    (ctx, value) => writeLights(ctx, value),
    current.filter(light => light.id !== id),
  );
  const { selection, clearSelection } = useUIStore.getState();
  if (selection.includes(lightNodeId(id))) clearSelection();
}

/** Edits the listed fields of one light. */
export function patchLight(id: string, label: string, patch: Partial<SceneLight>): void {
  patchValue(
    label,
    p => normalizeLights(p.scene.lights),
    (ctx, value) => writeLights(ctx, value),
    normalizeLights(project().scene.lights).map(light => light.id === id ? { ...light, ...patch } : light),
  );
}

/** Turns the listed lights on or off in the viewport. */
export function setLightsEnabled(ids: string[], enabled: boolean): void {
  patchValue(
    enabled ? '开启光源' : '关闭光源',
    p => normalizeLights(p.scene.lights),
    (ctx, value) => writeLights(ctx, value),
    normalizeLights(project().scene.lights).map(light => ids.includes(light.id) ? { ...light, enabled } : light),
  );
}

/** Turns the environment light on or off, keeping its image and strength. */
export function setEnvironmentEnabled(enabled: boolean): void {
  patchValue(
    enabled ? '开启环境光' : '关闭环境光',
    p => p.scene.lights.iblEnabled,
    (ctx, value) => {
      ctx.project.scene = { ...ctx.project.scene, lights: { ...ctx.project.scene.lights, iblEnabled: value } };
    },
    enabled,
  );
}

/** Shows or hides the stitched thread of the listed seams in the 3D viewport. */
export function setSeamsStitchVisible(seamIds: string[], visible: boolean): void {
  const before = seamIds.map(id => project().pattern.seams[id]?.stitchVisible ?? true);
  useProjectStore.getState().executeCommand({
    label: visible ? '显示缝纫线' : '隐藏缝纫线',
    execute: ctx => applySeamStitch(ctx, seamIds, seamIds.map(() => visible)),
    undo: ctx => applySeamStitch(ctx, seamIds, before),
  });
}

/** Marks each seam's thread drawn or not; a draw-only flag that never rebuilds the cloth. */
function applySeamStitch(ctx: ProjectContext, seamIds: string[], values: boolean[]): void {
  seamIds.forEach((id, i) => {
    const seam = ctx.project.pattern.seams[id];
    if (seam) seam.stitchVisible = values[i];
  });
}
