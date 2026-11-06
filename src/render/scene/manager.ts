/** The scene manager: the only owner of the three.js scene and of every drawn object. */

import * as THREE from 'three/webgpu';
import { LAYERS, LAYER_ORDER, layersWhere, type LayerId } from '@/render/scene/layers';
import { SLOT_LAYER, type SlotName } from '@/render/scene/slots';
import { createRevisions, type SceneRevisions } from '@/render/scene/revisions';

/** Bit of a trace mask that lets the path tracer see an object. A zero mask hides it from tracing. */
export const TRACE_VISIBLE = 1;

/** A change the path tracer has to pick up, one per revision counter it reads. */
export type StageChange = 'material' | 'transform' | 'visibility' | 'groups' | 'deform';

/** Container one slot owns; the runtime puts its objects here instead of into a scene. */
export interface StageSlot {
  readonly name: SlotName;
  readonly layer: LayerId;
  readonly group: THREE.Group;
  /** Objects currently in the slot, the slot group's children. */
  readonly objects: readonly THREE.Object3D[];
  add(object: THREE.Object3D): void;
  remove(object: THREE.Object3D): void;
  clear(): void;
  /** Sets the trace mask of an object of this slot; see {@link SceneMgr.setTraceMask}. */
  setTraceMask(object: THREE.Object3D, mask: number): void;
  /** Marks or unmarks a mesh as part of the pattern surface; see {@link SceneMgr.setSurface}. */
  markSurface(mesh: THREE.Mesh, isSurface: boolean): void;
  /** Announces a change the raster passes see for free but the path tracer must be told about. */
  markChanged(kind: StageChange): void;
}

/** Slot implementation backed by a group inside its layer. */
class Slot implements StageSlot {
  readonly group = new THREE.Group();

  constructor(
    readonly name: SlotName,
    readonly layer: LayerId,
    private readonly sceneMgr: SceneMgr,
  ) {
    this.group.name = `slot:${name}`;
  }

  get objects(): readonly THREE.Object3D[] {
    return this.group.children;
  }

  add(object: THREE.Object3D): void {
    if (object.parent === this.group) return;
    this.sceneMgr.markAttached();
    this.group.add(object);
  }

  remove(object: THREE.Object3D): void {
    if (object.parent !== this.group) return;
    this.group.remove(object);
    this.sceneMgr.markAttached();
  }

  clear(): void {
    if (this.group.children.length === 0) return;
    this.group.clear();
    this.sceneMgr.markAttached();
  }

  setTraceMask(object: THREE.Object3D, mask: number): void {
    this.sceneMgr.setTraceMask(object, mask);
  }

  markSurface(mesh: THREE.Mesh, isSurface: boolean): void {
    this.sceneMgr.setSurface(mesh, isSurface);
  }

  markChanged(kind: StageChange): void {
    this.sceneMgr.markChanged(kind);
  }
}

/**
 * Owns the three.js scene. Objects enter through a named slot, which fixes their layer, which in
 * turn fixes whether the raster passes, the path tracer, export and picking can see them.
 */
export class SceneMgr {
  readonly scene = new THREE.Scene();
  readonly revisions: SceneRevisions = createRevisions();
  private readonly layers = new Map<LayerId, THREE.Group>();
  private readonly slots = new Map<SlotName, Slot>();
  /** Trace masks per object; objects without an entry are visible to the tracer. */
  private readonly traceMasks = new Map<THREE.Object3D, number>();
  /** Meshes carrying the pattern surface; the diagnostic fills restyle these and nothing else. */
  private readonly surfaces = new Set<THREE.Mesh>();
  /** Url of the environment image in use, kept here rather than in `scene.userData`. */
  private environmentUrlValue = '';

  constructor() {
    for (const id of LAYER_ORDER) {
      const group = new THREE.Group();
      group.name = `layer:${id}`;
      group.visible = LAYERS[id].raster;
      this.scene.add(group);
      this.layers.set(id, group);
    }
  }

  /** Group of one layer, for passes that show and hide whole layers. */
  layer(id: LayerId): THREE.Group {
    const group = this.layers.get(id);
    if (!group) throw new Error(`unknown layer: ${id}`);
    return group;
  }

  /** Named slot; created on first use. */
  slot(name: SlotName): StageSlot {
    const existing = this.slots.get(name);
    if (existing) return existing;
    const layerId = SLOT_LAYER[name];
    const slot = new Slot(name, layerId, this);
    this.layer(layerId).add(slot.group);
    this.slots.set(name, slot);
    return slot;
  }

  /** Shows or hides one layer, used by the frame passes. */
  setLayerVisible(id: LayerId, visible: boolean): void {
    this.layer(id).visible = visible;
  }

  /** Restores every layer to the visibility its policy asks for. */
  resetLayerVisibility(): void {
    for (const id of LAYER_ORDER) this.setLayerVisible(id, LAYERS[id].raster);
  }

  /** World matrices for every object that takes part in this frame. */
  updateMatrixWorld(): void {
    this.scene.updateMatrixWorld(true);
  }

  /** Objects the exporter should contain: every visible object of an exportable layer. */
  exportables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const id of layersWhere(policy => policy.exportable)) {
      for (const object of this.objectsIn(id)) {
        if (object.visible) out.push(object);
      }
    }
    return out;
  }

  /** Every object of a layer, used by picking and by the wire layer. */
  objectsIn(id: LayerId): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const child of this.layer(id).children) out.push(...child.children);
    return out;
  }

  /** Objects a pointer pick can hit. */
  pickables(): THREE.Object3D[] {
    return layersWhere(policy => policy.pickable).flatMap(id => this.objectsIn(id));
  }

  /** Backdrop of the scene: an environment texture, a flat colour, or nothing. */
  setBackground(value: THREE.Texture | THREE.Color | null): void {
    this.scene.background = value;
  }

  /**
   * Runs `draw` with every layer the path tracer must not see hidden.
   *
   * The layer table says which layers the tracer reads (`LAYERS[id].trace`); without this the
   * tracer walks overlays, gizmos and line helpers too, and fails on geometry it cannot trace.
   */
  withoutUntracedLayers<T>(draw: () => T): T {
    const hidden: LayerId[] = [];
    for (const id of LAYER_ORDER) {
      const group = this.layer(id);
      if (LAYERS[id].trace || !group.visible) continue;
      group.visible = false;
      hidden.push(id);
    }
    try {
      return draw();
    } finally {
      for (const id of hidden) this.layer(id).visible = true;
    }
  }

  /**
   * Runs `draw` with the backdrop detached.
   *
   * A scene render always paints its background, as a full-screen mesh ahead of everything else.
   * Drawing that a second time — when a stage layers onto an image already on the target — would
   * cover the image underneath, so that stage hides the backdrop for its own draw.
   */
  withoutBackground<T>(draw: () => T): T {
    const background = this.scene.background;
    this.scene.background = null;
    try {
      return draw();
    } finally {
      this.scene.background = background;
    }
  }

  /** Backdrop and image-based lighting of the scene, plus the url they came from. */
  setEnvironment(texture: THREE.Texture | null, url = ''): void {
    this.scene.background = texture;
    this.scene.environment = texture;
    this.environmentUrlValue = texture ? url : '';
  }

  /**
   * Strength of the image-based lighting. The environment image itself is set separately; this is
   * the value the lighting settings own, so it is written from there and stored here.
   */
  setEnvironmentIntensity(value: number): void {
    this.scene.environmentIntensity = value;
  }

  /** Url of the environment image in use; empty while the flat backdrop stands in. */
  get environmentUrl(): string {
    return this.environmentUrlValue;
  }

  /** Bumps the topology version after a slot changed its content. */
  markAttached(): void {
    this.revisions.topology++;
  }

  /**
   * Announces a change the path tracer has to pick up; each kind is one revision counter.
   * Slots and the runtime call this instead of touching the counters, so nothing is silently lost.
   */
  markChanged(kind: StageChange): void {
    this.revisions[kind]++;
  }

  /** Sets the mask the path tracer reads for one object.
   *
   * The mask is the tracer's own visibility code: bit {@link TRACE_VISIBLE} keeps the object in the
   * traced image, a zero mask drops it while the raster passes still draw it. It is applied to
   * `object.visible` for the duration of a trace step, so the tracer never needs a second notion of
   * visibility, and the object's own flag survives untouched.
   */
  setTraceMask(object: THREE.Object3D, mask: number): void {
    if (this.traceMasks.get(object) === mask) return;
    this.traceMasks.set(object, mask);
    this.markChanged('visibility');
  }

  /**
   * Marks a mesh as part of the pattern surface.
   *
   * A fill replaces the surface material so the pattern can be read on its own; the body, the
   * reference models and the heatmap overlay must keep their own materials, so they never register
   * here. Membership, not layer, is what decides.
   */
  setSurface(mesh: THREE.Mesh, isSurface: boolean): void {
    if (isSurface) this.surfaces.add(mesh);
    else this.surfaces.delete(mesh);
  }

  /** Meshes the diagnostic fills apply to; empty before the garment is built. */
  surfaceMeshes(): readonly THREE.Mesh[] {
    return [...this.surfaces];
  }

  /** Mask of one object; {@link TRACE_VISIBLE} when it was never set. */
  traceMask(object: THREE.Object3D): number {
    return this.traceMasks.get(object) ?? TRACE_VISIBLE;
  }

  /**
   * Applies the masks to object visibility and returns the function that puts it back.
   * The tracer calls this around every capture and sync, so masked-out objects leave the TLAS.
   */
  applyTraceMasks(): () => void {
    if (this.traceMasks.size === 0) return noop;
    const restore: Array<() => void> = [];
    for (const [object, mask] of this.traceMasks) {
      const wanted = (mask & TRACE_VISIBLE) !== 0;
      const previous = object.visible;
      if (previous === wanted) continue;
      object.visible = wanted;
      restore.push(() => { object.visible = previous; });
    }
    return () => {
      for (let i = restore.length - 1; i >= 0; i--) restore[i]!();
    };
  }

  /** Frees every object the slots still hold. */
  dispose(): void {
    for (const slot of this.slots.values()) slot.clear();
    this.slots.clear();
    this.traceMasks.clear();
    this.surfaces.clear();
  }
}

/** Restore function of a trace step that masked nothing out. */
function noop(): void { }

