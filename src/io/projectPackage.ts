import type { Project } from '../core/model/types';
import { readFileAsDataUrl } from './codec';
import { getModelBlob } from './objectStore';

/**
 * Returns a copy of the project with imported models and environment maps embedded as data URLs,
 * so a downloaded `.ocproj.json` opens on another machine without the local object store.
 */
export async function embedProjectAssets(project: Project): Promise<Project> {
  const snapshot = structuredClone(project);

  const avatar = snapshot.avatar;
  if (avatar.source === 'glb' && !avatar.glbUrl && avatar.glbObjectKey) {
    const url = await storedDataUrl(avatar.glbObjectKey, avatar.modelName ?? 'avatar.glb');
    if (url) {
      avatar.glbUrl = url;
      delete avatar.glbObjectKey;
    }
  }

  for (const ref of snapshot.scene.referenceObjects ?? []) {
    if (ref.objectUrl || !ref.objectKey) continue;
    const url = await storedDataUrl(ref.objectKey, ref.name);
    if (url) {
      ref.objectUrl = url;
      delete ref.objectKey;
    }
  }

  const lights = snapshot.scene.lights;
  if (!lights.iblUrl && lights.iblObjectKey) {
    const url = await storedDataUrl(lights.iblObjectKey, lights.iblName ?? 'environment.hdr');
    if (url) {
      lights.iblUrl = url;
      delete lights.iblObjectKey;
    }
  }

  return snapshot;
}

/** Reads one stored blob as a data URL; missing or unavailable bytes leave the reference untouched. */
async function storedDataUrl(key: string, name: string): Promise<string | null> {
  try {
    const blob = await getModelBlob(key);
    if (!blob) return null;
    const file = blob instanceof File ? blob : new File([blob], name);
    return await readFileAsDataUrl(file);
  } catch {
    return null;
  }
}
