/** The scene manager: the only owner of the three.js scene and of every drawn object. */

import * as THREE from 'three/webgpu';
import type { CameraProjection, LightConfig } from '@/model/types';
import type { RenderContext } from '@/render/context';
import { LAYERS, LAYER_ORDER, layersWhere, type LayerId } from '@/render/scene/layers';
import { SLOT_LAYER, type SlotName } from '@/render/scene/slots';
import { createRevisions, type SceneRevisions } from '@/render/scene/revisions';
import { SceneCamera, type ViewportCamera } from '@/render/scene/camera';
import { SceneLights } from '@/render/scene/lights';

/** Bit of a trace mask that lets the path tracer see an object. A zero mask hides it from tracing. */
export const TRACE_VISIBLE = 1;

/** A change the path tracer has to pick up, one per revision counter it reads. */
export type SceneRevisionKind = 'material' | 'transform' | 'visibility' | 'groups' | 'deform';

/** Container one slot owns; the runtime puts its objects here instead of into a scene. */
export interface SceneSlot {
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
  /** Marks or unmarks a mesh as a pattern surface; see {@link SceneMgr.setPatternSurface}. */
  markPatternSurface(mesh: THREE.Mesh, isPattern: boolean): void;
  /** Announces a change the raster passes see for free but the path tracer must be told about. */
  markRevision(kind: SceneRevisionKind): void;
}

/** Slot implementation backed by a group inside its layer. */
class Slot implements SceneSlot {
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
    this.group.add(object);
    this.markAttached();
  }

  remove(object: THREE.Object3D): void {
    if (object.parent !== this.group) return;
    this.group.remove(object);
    this.sceneMgr.clearTraceMask(object);
    this.markAttached();
  }

  clear(): void {
    if (this.group.children.length === 0) return;
    for (const child of this.group.children) this.sceneMgr.clearTraceMask(child);
    this.group.clear();
    this.markAttached();
  }

  /** Bumps the topology only for layers the tracer walks; gizmos never enter its BVH. */
  private markAttached(): void {
    if (LAYERS[this.layer].trace) this.sceneMgr.markAttached();
  }

  setTraceMask(object: THREE.Object3D, mask: number): void {
    this.sceneMgr.setTraceMask(object, mask);
  }

  markPatternSurface(mesh: THREE.Mesh, isPattern: boolean): void {
    this.sceneMgr.setPatternSurface(mesh, isPattern);
  }

  markRevision(kind: SceneRevisionKind): void {
    this.sceneMgr.markRevision(kind);
  }
}

/**
 * Owns the three.js scene and everything attached to it: layers, slots, the camera, the lights and
 * the change counters. Objects enter through a named slot, which fixes their layer, which in turn
 * fixes whether the raster passes, the path tracer, export and picking can see them.
 */
export class SceneMgr {
  readonly scene = new THREE.Scene();
  readonly revisions: SceneRevisions = createRevisions();
  private readonly layers = new Map<LayerId, THREE.Group>();
  private readonly slots = new Map<SlotName, Slot>();
  private readonly lights: SceneLights;
  private cameraValue: SceneCamera | null = null;
  /** Set by the Renderer once its tracer exists; a headless scene leaves it a no-op. */
  private lightInvalidator: () => void = noop;
  /** Trace masks per object; objects without an entry are visible to the tracer. */
  private readonly traceMasks = new Map<THREE.Object3D, number>();
  /** Meshes carrying the pattern surface; the diagnostic fills restyle these and nothing else. */
  private readonly patternSurfaces = new Set<THREE.Mesh>();
  /** Cached copy of `patternSurfaces`, invalidated on membership changes. */
  private patternSurfaceList: readonly THREE.Mesh[] | null = null;
  /** Url of the environment image in use, kept here rather than in `scene.userData`. */
  private environmentUrlValue = '';

  constructor(ctx?: RenderContext) {
    for (const id of LAYER_ORDER) {
      const group = new THREE.Group();
      group.name = `layer:${id}`;
      group.visible = LAYERS[id].raster;
      this.scene.add(group);
      this.layers.set(id, group);
    }
    this.lights = new SceneLights(this, () => this.lightInvalidator());
    if (ctx) this.cameraValue = new SceneCamera(ctx);
  }

  /** The viewport camera; a scene built without a render context has none. */
  get camera(): SceneCamera {
    if (!this.cameraValue) throw new Error('scene has no camera');
    return this.cameraValue;
  }

  /** Rebuilds the scene lights from the project's lighting settings. */
  applyLights(config: LightConfig): void {
    this.lights.applyConfig(config);
  }

  /** Lets the lighting tell the path tracer that lights or the environment changed. */
  setLightInvalidator(invalidate: () => void): void {
    this.lightInvalidator = invalidate;
  }

  /** Matches the camera to a new viewport aspect. */
  resizeCamera(aspect: number): void {
    this.camera.resize(aspect);
  }

  /** Swaps the camera between perspective and orthographic. */
  setCameraProjection(projection: CameraProjection): void {
    this.camera.setProjection(projection);
  }

  /** The camera the viewport renders, picks and frames with. */
  activeCamera(): ViewportCamera {
    return this.camera.camera;
  }

  /** Group of one layer, for passes that show and hide whole layers. */
  layer(id: LayerId): THREE.Group {
    const group = this.layers.get(id);
    if (!group) throw new Error(`unknown layer: ${id}`);
    return group;
  }

  /** Named slot; created on first use. */
  slot(name: SlotName): SceneSlot {
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
   * Drawing that a second time — when a pass layers onto an image already on the target — would
   * cover the image underneath, so that pass hides the backdrop for its own draw.
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
  markRevision(kind: SceneRevisionKind): void {
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
    if (mask === TRACE_VISIBLE) {
      this.clearTraceMask(object);
      return;
    }
    if (this.traceMasks.get(object) === mask) return;
    this.traceMasks.set(object, mask);
    this.markRevision('visibility');
  }

  /** Forgets an object's mask as it leaves the scene; it defaults to visible again. */
  clearTraceMask(object: THREE.Object3D): void {
    if (!this.traceMasks.delete(object)) return;
    this.markRevision('visibility');
  }

  /**
   * Marks a mesh as a pattern surface.
   *
   * A fill replaces the surface material so the pattern can be read on its own; the body, the
   * reference models and the heatmap overlay must keep their own materials, so they never register
   * here. Membership, not layer, is what decides.
   */
  setPatternSurface(mesh: THREE.Mesh, isPattern: boolean): void {
    if (isPattern === this.patternSurfaces.has(mesh)) return;
    if (isPattern) this.patternSurfaces.add(mesh);
    else this.patternSurfaces.delete(mesh);
    this.patternSurfaceList = null;
  }

  /** Meshes the diagnostic fills apply to; empty before the garment is built. */
  patternSurfaceMeshes(): readonly THREE.Mesh[] {
    return this.patternSurfaceList ??= [...this.patternSurfaces];
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

  /** Frees the camera, the lights and every object the slots still hold. */
  dispose(): void {
    this.cameraValue?.dispose();
    this.cameraValue = null;
    this.lights.dispose();
    for (const slot of this.slots.values()) slot.clear();
    this.slots.clear();
    this.traceMasks.clear();
    this.patternSurfaces.clear();
    this.patternSurfaceList = null;
  }
}

/** Restore function of a trace step that masked nothing out. */
function noop(): void { }

