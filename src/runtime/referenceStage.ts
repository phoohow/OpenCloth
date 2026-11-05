import * as THREE from 'three/webgpu';
import type { ObjectTransform, ReferenceObjectRef } from '@/model/types';
import { IDENTITY_TRANSFORM, cloneTransform } from '@/model';
import { loadModelFromFile, loadModelFromUrl } from '@/io/importers';
import { getModelBlob, putModelBlob } from '@/io/storage';
import { applyTransform } from '@/runtime/objectTransforms';

/** A model placed in the scene for reference, not simulated. */
export interface ReferenceObject {
  id: string;
  name: string;
  group: THREE.Group;
  visible: boolean;
  opacity: number;
}

/** Reference objects held in the scene, keyed by their project record id. */
export class ReferenceStage {
  private objects: Map<string, ReferenceObject> = new Map();

  /** Reference objects currently in the scene. */
  list(): ReferenceObject[] {
    return Array.from(this.objects.values());
  }

  /** Loads stored models that are not in the scene yet. */
  async ensure(references: ReferenceObjectRef[], scene: THREE.Scene): Promise<void> {
    for (const ref of references) {
      if (this.objects.has(ref.id) || (!ref.objectKey && !ref.objectUrl)) continue;
      const loaded = ref.objectUrl
        ? await loadModelFromUrl(ref.objectUrl, { targetHeight: 0 })
        : await this.loadStored(ref);
      if (!loaded) continue;
      this.add(loaded.group, ref.id, scene, ref.opacity);
      this.setVisible(ref.id, ref.visible);
      this.place(ref.id, ref.transform ?? IDENTITY_TRANSFORM);
    }
  }

  /** Loads one reference object from the local blob store; null when the key no longer resolves. */
  private async loadStored(ref: ReferenceObjectRef) {
    const blob = ref.objectKey ? await getModelBlob(ref.objectKey) : null;
    if (!blob) return null;
    return loadModelFromFile(new File([blob], ref.name), { targetHeight: 0 });
  }

  /** Keeps scene meshes in sync with the project list: drops strays, loads missing entries. */
  async reconcile(references: ReferenceObjectRef[], scene: THREE.Scene): Promise<void> {
    const wanted = new Set(references.map(r => r.id));
    for (const held of this.list()) {
      if (!wanted.has(held.id)) this.remove(held.id, scene);
    }
    await this.ensure(references, scene);
  }

  /** Stores a model file and adds it to the scene; returns the project record for the list. */
  async importFile(file: File, id: string, scene: THREE.Scene): Promise<ReferenceObjectRef> {
    const objectKey = `object-${id}`;
    await putModelBlob(objectKey, file);
    const loaded = await loadModelFromFile(file, { targetHeight: 0 });
    this.add(loaded.group, id, scene, 0.5);
    return {
      id, name: file.name, objectKey, visible: true, opacity: 0.5, transform: cloneTransform(),
    };
  }

  /** Adds an already loaded model group, replacing any object already held under the id. */
  add(group: THREE.Group, id: string, scene: THREE.Scene, opacity = 0.5): ReferenceObject {
    if (this.objects.has(id)) this.remove(id, scene);
    group.name = `reference:${id}`;
    setGroupOpacity(group, opacity);
    scene.add(group);
    const obj: ReferenceObject = { id, name: group.name, group, visible: true, opacity };
    this.objects.set(id, obj);
    return obj;
  }

  setVisible(id: string, visible: boolean): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    obj.visible = visible;
    obj.group.visible = visible;
  }

  setOpacity(id: string, opacity: number): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    obj.opacity = opacity;
    setGroupOpacity(obj.group, opacity);
  }

  /** Places a reference object at its stored scene transform. */
  place(id: string, transform: ObjectTransform): void {
    const obj = this.objects.get(id);
    if (obj) applyTransform(obj.group, transform);
  }

  /** Removes an object from the scene and disposes its geometries and materials. */
  remove(id: string, scene: THREE.Scene): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    scene.remove(obj.group);
    obj.group.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) mat.dispose();
    });
    this.objects.delete(id);
  }

  /** Removes every reference object, used when the viewport tears the scene down. */
  clear(scene: THREE.Scene): void {
    for (const id of Array.from(this.objects.keys())) this.remove(id, scene);
  }
}

/** Fades a group's meshes, keeping depth writing only for near-opaque surfaces. */
export function setGroupOpacity(group: THREE.Group, opacity: number): void {
  group.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      (m as THREE.MeshStandardMaterial).transparent = opacity < 1;
      (m as THREE.MeshStandardMaterial).opacity = opacity;
      (m as THREE.MeshStandardMaterial).depthWrite = opacity >= 0.95;
    }
  });
}
