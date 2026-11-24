import type { ObjectTransform, ReferenceObjectRef } from '@/model/types';
import type { AssetHandle } from '@/render/common';
import type { EntityId } from '@/render/world';
import type { PresenterHost } from '@/runtime/world/presenters/host';

import { getModelBlob, putModelBlob } from '@/io/storage';
import { IDENTITY_TRANSFORM, cloneTransform } from '@/model';

export interface ReferenceObject {
  id: string;
  name: string;
  entity: EntityId;
  visible: boolean;
  opacity: number;
  transform: ObjectTransform;
}

export class ReferenceStage {
  private readonly objects = new Map<string, ReferenceObject>();
  private readonly handles = new Map<string, AssetHandle>();
  private generation = 0;
  private wanted = new Set<string>();
  private readonly pending = new Map<string, Promise<AssetHandle | null>>();

  list(): ReferenceObject[] {
    return Array.from(this.objects.values());
  }

  async ensure(host: PresenterHost, references: ReferenceObjectRef[], generation = this.generation): Promise<void> {
    for (const ref of references) {
      if (generation !== this.generation) return;
      if (this.objects.has(ref.id) || (!ref.objectKey && !ref.objectUrl)) continue;
      const handle = await this.loadOnce(host, ref);
      if (!handle) continue;
      if (generation !== this.generation) {
        if (!this.wanted.has(ref.id)) host.assets.release(ref.id);
        return;
      }

      this.add(host, handle, ref);
    }
  }

  async reconcile(host: PresenterHost, references: ReferenceObjectRef[]): Promise<void> {
    const generation = ++this.generation;
    this.wanted = new Set(references.map(ref => ref.id));
    for (const held of this.list()) {
      if (!this.wanted.has(held.id)) this.remove(host, held.id);
    }

    await this.ensure(host, references, generation);
  }

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

  place(id: string, transform: ObjectTransform): void {
    const object = this.objects.get(id);
    if (!object) return;
    object.transform = cloneTransform(transform);
    this.handles.get(id)?.pose(transform);
  }

  remove(host: PresenterHost, id: string): void {
    const object = this.objects.get(id);
    if (!object) return;
    host.unbind(object.entity);
    host.writer.destroyEntity(object.entity);
    host.assets.release(id);
    this.objects.delete(id);
    this.handles.delete(id);
  }

  clear(host: PresenterHost): void {
    this.generation += 1;
    this.wanted.clear();
    for (const id of Array.from(this.objects.keys())) this.remove(host, id);
  }

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
