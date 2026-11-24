import { createSceneService } from '@/app';
import { useProjectStore, useUIStore } from '@/store';

export type { EngineRef, SceneService } from '@/app';

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
} = service;
