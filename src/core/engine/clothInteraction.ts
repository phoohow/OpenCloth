import * as THREE from 'three/webgpu';
import type { RendererContext } from '../../render/renderer/rendererContext';
import type { ClothSimulator } from '../../sim/clothSimulator';
import type { ParticlePickHit } from '../../sim/picking';
import { evalBodyDistance } from '../../avatar/collider/avatarCollider';
import type { AvatarStage } from './avatarStage';
import type { ClothPicker } from './clothPicker';
import { DragMarker } from './dragMarker';
import type { PinMarkers } from './pinMarkers';
import { grabWeightsAround } from './clothDrag';
import { pinsByScreenDistance } from './pinHover';
import { bodyOccludesSegment } from './bodyOcclusion';
import {
  DRAG_GRAB_RADIUS_M, DRAG_GRAB_STRENGTH, DRAG_MAX_REACH_M, PIN_HOVER_RADIUS_PX,
} from './clothConstants';

/** Pins the hover may test for occlusion before giving up, keeping a large pin set cheap. */
const PIN_OCCLUSION_TRIES = 3;

/** What the engine lends the pointer gestures. */
export interface ClothInteractionHost {
  /** Cloth raycasts and the viewport camera. */
  readonly picker: ClothPicker;
  readonly avatar: AvatarStage;
  readonly pinMarkers: PinMarkers;
  readonly renderer: RendererContext;
  /** Merged particle positions from the last readback, or null before it. */
  positions(): Float32Array | null;
  /** Solver the drag pulls, or null while it is being rebuilt. */
  simulator(): ClothSimulator | null;
  /** Nearest particle under a screen ray, restricted to the panel that was hit. */
  pickParticle(ndcX: number, ndcY: number): ParticlePickHit | null;
}

/**
 * Pointer gestures on the cloth: what a hover would do, the grab that drags it, and the marker
 * that shows the grabbed point. Hovering decides everything, so the viewport keeps its camera
 * gestures wherever the cloth is not the front-most surface.
 */
export class ClothInteraction {
  private readonly host: ClothInteractionHost;
  /** In-flight pointer drag: the grabbed centre, its particle and the plane the pointer slides on. */
  private drag: { center: THREE.Vector3; plane: THREE.Plane; particle: number } | null = null;
  /** Ring drawn on the particle being pulled, so the grabbed point stays visible. */
  private readonly marker = new DragMarker();
  /** Scratch vectors of the hover pass, reused because it runs once per frame. */
  private readonly point = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(host: ClothInteractionHost) {
    this.host = host;
  }

  /** Signed distance to the body, or null when there is no visible body to occlude against. */
  private bodyDistance(): ((x: number, y: number, z: number) => number) | null {
    const collider = this.host.avatar.collider;
    const avatar = this.host.avatar.object;
    if (!collider || !avatar || !avatar.visible) return null;
    return (x, y, z) => evalBodyDistance(collider, x, y, z);
  }

  /**
   * True when the garment is the front-most surface under a screen point. Cloth hidden behind the
   * body (a panel behind a hip, the back under the spine) must not grab the pointer, otherwise the
   * cursor would offer a drag on something the user cannot see.
   */
  hoverClothAtScreen(ndcX: number, ndcY: number): boolean {
    const distance = this.host.picker.clothDistanceAtScreen(ndcX, ndcY);
    if (distance === null) return false;
    const signedDistance = this.bodyDistance();
    const ray = this.host.picker.screenRay(ndcX, ndcY);
    if (!signedDistance || !ray) return true;
    return !bodyOccludesSegment(signedDistance, ray.origin, ray.direction, distance);
  }

  /**
   * Pinned particle whose marker sits within `radiusPx` of a screen point, or null. The remove
   * cursor only appears when a click would actually release a pin, so hovering bare cloth keeps
   * the camera gestures.
   */
  hoverPinAtScreen(ndcX: number, ndcY: number, radiusPx = PIN_HOVER_RADIUS_PX): number | null {
    const positions = this.host.positions();
    if (!positions) return null;
    const camera = this.host.renderer.view.camera;
    const { canvas } = this.host.renderer.surface;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return null;

    const point = this.point;
    const ordered = pinsByScreenDistance(
      this.host.pinMarkers.list(),
      (index) => {
        const offset = index * 3;
        if (offset + 2 >= positions.length) return null;
        return point.set(positions[offset]!, positions[offset + 1]!, positions[offset + 2]!).project(camera);
      },
      ndcX, ndcY, width, height, radiusPx, PIN_OCCLUSION_TRIES,
    );
    if (!ordered.length) return null;

    const distanceToBody = this.bodyDistance();
    if (!distanceToBody) return ordered[0]!;
    // A pin behind the body is invisible, so it must not offer itself for removal either.
    for (const index of ordered) {
      if (!this.pinOccluded(index, positions, distanceToBody)) return index;
    }
    return null;
  }

  /** True when the body stands between the camera and the pin at `index`. */
  private pinOccluded(
    index: number,
    positions: Float32Array,
    distanceToBody: (x: number, y: number, z: number) => number,
  ): boolean {
    const offset = index * 3;
    if (offset + 2 >= positions.length) return true;
    const camera = this.host.renderer.view.camera;
    const point = this.point.set(positions[offset]!, positions[offset + 1]!, positions[offset + 2]!);
    const distance = camera.position.distanceTo(point);
    this.direction.copy(point).sub(camera.position).divideScalar(distance || 1);
    return bodyOccludesSegment(distanceToBody, camera.position, this.direction, distance);
  }

  /** Highlights the pin a remove click would release; null restores every marker. */
  setHoveredPin(particleIndex: number | null): void {
    this.host.pinMarkers.highlight(particleIndex);
  }

  /**
   * Grabs the cloth under a screen point: every particle within `DRAG_GRAB_RADIUS_M` of the picked
   * one gets a pull weight that falls off to its edge, and the pointer slides on a camera-facing
   * plane through the picked point. False when the point misses the cloth or no solver is running.
   */
  beginDrag(ndcX: number, ndcY: number): boolean {
    const simulator = this.host.simulator();
    if (!simulator) return false;
    const hit = this.host.pickParticle(ndcX, ndcY);
    const positions = this.host.positions();
    if (!hit || !positions || positions.length < (hit.index + 1) * 3) return false;
    const ray = this.host.picker.screenRay(ndcX, ndcY);
    if (!ray) return false;

    const center = new THREE.Vector3(
      positions[hit.index * 3]!, positions[hit.index * 3 + 1]!, positions[hit.index * 3 + 2]!,
    );
    const normal = ray.direction.clone().normalize();
    const weights = grabWeightsAround(positions, center, DRAG_GRAB_RADIUS_M, DRAG_GRAB_STRENGTH);
    if (!simulator.setGrab(weights, [center.x, center.y, center.z])) return false;
    this.drag = { center, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center), particle: hit.index };
    this.marker.show(hit.index, positions, this.host.renderer.surface.scene, this.host.renderer.view.camera);
    return true;
  }

  /** Moves the drag target to where the pointer ray crosses the plane it started on. */
  moveDrag(ndcX: number, ndcY: number): void {
    const drag = this.drag;
    const simulator = this.host.simulator();
    if (!drag || !simulator) return;
    const ray = this.host.picker.screenRay(ndcX, ndcY);
    if (!ray) return;
    const point = ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!point || !Number.isFinite(point.x + point.y + point.z)) return;
    // A camera change mid-drag can put the intersection far outside the garment; a clamp keeps
    // the pull from flinging the cloth across the scene.
    const offset = point.clone().sub(drag.center);
    if (offset.length() > DRAG_MAX_REACH_M) {
      point.copy(drag.center).addScaledVector(offset.normalize(), DRAG_MAX_REACH_M);
    }
    simulator.moveGrab([point.x, point.y, point.z]);
  }

  /** Releases the drag; the cloth keeps the velocity the pull gave it. */
  endDrag(): void {
    this.drag = null;
    this.marker.hide(this.host.renderer.surface.scene);
    this.host.simulator()?.clearGrab();
  }

  /** True while a pointer holds the cloth. */
  get dragging(): boolean {
    return this.drag !== null;
  }

  /** Keeps the grabbed-point marker on its particle after a readback. */
  syncMarker(positions: Float32Array | null): void {
    this.marker.sync(positions, this.host.renderer.view.camera);
  }

  /** Ends the drag and frees the marker. */
  dispose(): void {
    this.endDrag();
    this.marker.dispose(this.host.renderer.surface.scene);
  }
}
