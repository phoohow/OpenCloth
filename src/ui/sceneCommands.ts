import { createSceneService } from '@/runtime';
import { useProjectStore, useUIStore } from '@/store';

export type { EngineRef, ProductionKind, SceneService } from '@/runtime';

/** Scene service bound to the project store's history and the UI store's selection. */
const service = createSceneService({
  project: () => useProjectStore.getState().project,
  execute: command => useProjectStore.getState().executeCommand(command),
  selection: () => useUIStore.getState().selection,
  select: ids => useUIStore.getState().select(ids),
  clearSelection: () => useUIStore.getState().clearSelection(),
  notifyRefObjectsChanged: () => useUIStore.getState().bumpRefObjects(),
});

export const {
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
} = service;
