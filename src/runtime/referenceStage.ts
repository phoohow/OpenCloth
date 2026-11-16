/** Reference models in the scene, held as assets and world entities. */

import type { ObjectTransform, ReferenceObjectRef } from '@/model/types';
import { IDENTITY_TRANSFORM, cloneTransform } from '@/model';
import { getModelBlob, putModelBlob } from '@/io/storage';
import type { AssetHandle } from '@/render/common';
import type { EntityId } from '@/render/world';
import type { PresenterHost } from '@/runtime/presenters/host';

/** A model placed in the scene for reference, not simulated. */
export interface ReferenceObject {
  id: string;
  name: string;
  entity: EntityId;
  visible: boolean;
  opacity: number;
  transform: ObjectTransform;
}

/** Reference objects held in the scene, keyed by their project record id. */
export class ReferenceStage {
  private readonly objects = new Map<string, ReferenceObject>();
  private readonly handles = new Map<string, AssetHandle>();
  /** Bumped by every reconcile, so a load that lost the race adds nothing to the new list. */
  private generation = 0;
  /** Ids the current reconcile wants, so a stale load knows whether its slot is still claimed. */
  private wanted = new Set<string>();
  /** Loads already in flight, so two reconciles never read the same model twice. */
  private readonly pending = new Map<string, Promise<AssetHandle | null>>();

  /** Reference objects currently in the scene. */
  list(): ReferenceObject[] {
    return Array.from(this.objects.values());
  }

  /** Loads stored models that are not in the scene yet. */
  async ensure(host: PresenterHost, references: ReferenceObjectRef[], generation = this.generation): Promise<void> {
    for (const ref of references) {
      if (generation !== this.generation) return;
      if (this.objects.has(ref.id) || (!ref.objectKey && !ref.objectUrl)) continue;
      const handle = await this.loadOnce(host, ref);
      if (!handle) continue;
      // A newer reconcile may have started while this model was loading; it owns the slot now.
      if (generation !== this.generation) {
        if (!this.wanted.has(ref.id)) host.assets.release(ref.id);
        return;
      }
      this.add(host, handle, ref);
    }
  }

  /** Keeps scene entities in sync with the project list: drops strays, loads missing entries. */
  async reconcile(host: PresenterHost, references: ReferenceObjectRef[]): Promise<void> {
    const generation = ++this.generation;
    this.wanted = new Set(references.map(ref => ref.id));
    for (const held of this.list()) {
      if (!this.wanted.has(held.id)) this.remove(host, held.id);
    }
    await this.ensure(host, references, generation);
  }

  /** Reads one model once, even when two reconciles ask for it before it lands. */
  private loadOnce(host: PresenterHost, ref: ReferenceObjectRef): Promise<AssetHandle | null> {
    const running = this.pending.get(ref.id);
    if (running) return running;
    const run = (ref.objectUrl
      ? host.assets.load(ref.id, { kind: 'model', url: ref.objectUrl, targetHeight: 0 })
      : this.loadStored(host, ref)
    ).finally(() => { this.pending.delete(ref.id); });
    this.pending.set(ref.id, run);
    return run;
  }

  /** Stores a model file and adds it to the scene; returns the project record for the list. */
  async importFile(host: PresenterHost, file: File, id: string): Promise<ReferenceObjectRef> {
    const objectKey = `object-${id}`;
    await putModelBlob(objectKey, file);
    const handle = await host.assets.load(id, {
      kind: 'model',
      data: await file.arrayBuffer(),
      fileName: file.name,
      targetHeight: 0,
    });
    this.add(host, handle, {
      id, name: file.name, objectKey, visible: true, opacity: 0.5,
      transform: cloneTransform(IDENTITY_TRANSFORM),
    });
    return {
      id, name: file.name, objectKey, visible: true, opacity: 0.5, transform: cloneTransform(),
    };
  }

  /** Adds a loaded asset under the record's id, replacing any object already held. */
  add(host: PresenterHost, handle: AssetHandle, ref: ReferenceObjectRef): ReferenceObject {
    if (this.objects.has(ref.id)) this.remove(host, ref.id);
    const transform = ref.transform ?? IDENTITY_TRANSFORM;
    handle.pose(transform);
    handle.setAppearance({ opacity: ref.opacity });
    handle.setDisplay(ref.visible ? 'visible' : 'hidden');
    const entity = host.writer.createEntity({
      layer: 'underlay',
      tags: ['reference', `reference:${ref.id}`],
      mesh: { kind: 'asset', key: ref.id },
    });
    host.bind(ref.id, entity);
    const object: ReferenceObject = {
      id: ref.id, name: ref.name, entity, visible: ref.visible,
      opacity: ref.opacity, transform: cloneTransform(transform),
    };
    this.objects.set(ref.id, object);
    this.handles.set(ref.id, handle);
    return object;
  }

  setVisible(host: PresenterHost, id: string, visible: boolean): void {
    const object = this.objects.get(id);
    if (!object) return;
    object.visible = visible;
    const handle = this.handles.get(id);
    handle?.setDisplay(visible ? 'visible' : 'hidden');
    host.writer.touch('visibility');
  }

  setOpacity(host: PresenterHost, id: string, opacity: number): void {
    const object = this.objects.get(id);
    if (!object) return;
    object.opacity = opacity;
    this.handles.get(id)?.setAppearance({ opacity });
    host.writer.touch('material');
  }

  /** Places a reference object at its stored scene transform. */
  place(id: string, transform: ObjectTransform): void {
    const object = this.objects.get(id);
    if (!object) return;
    object.transform = cloneTransform(transform);
    this.handles.get(id)?.pose(transform);
  }

  /** Removes an object from the scene and releases its asset. */
  remove(host: PresenterHost, id: string): void {
    const object = this.objects.get(id);
    if (!object) return;
    host.unbind(object.entity);
    host.writer.destroyEntity(object.entity);
    host.assets.release(id);
    this.objects.delete(id);
    this.handles.delete(id);
  }

  /** Removes every reference object, used when the viewport tears the scene down. */
  clear(host: PresenterHost): void {
    // A load still in flight must not add an entity to the torn-down scene.
    this.generation += 1;
    this.wanted.clear();
    for (const id of Array.from(this.objects.keys())) this.remove(host, id);
  }


  /** Loads one reference object from the local blob store; null when the key no longer resolves. */
  private async loadStored(host: PresenterHost, ref: ReferenceObjectRef): Promise<AssetHandle | null> {
    const blob = ref.objectKey ? await getModelBlob(ref.objectKey) : null;
    if (!blob) return null;
    return host.assets.load(ref.id, {
      kind: 'model',
      data: await blob.arrayBuffer(),
      fileName: ref.name,
      targetHeight: 0,
    });
  }
}
