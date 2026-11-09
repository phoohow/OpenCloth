/** Pointer gestures on the cloth: picking, hovering, dragging, sketching, pins and selection. */

import type { Vec3 } from '@/base/geom';
import type { Bounds, CameraHost, CameraState } from '@/render/common';
import type { Vec2 } from '@/model/types';
import type { ClothSimInput, ClothSimulator, ParticlePickHit } from '@/sim';
import { evalBodyDistance, type AvatarCollider } from '@/avatar/collider';
import type { PresenterHost } from '@/runtime/presenters/host';
import { ClothPicker, type ClothSurfacePick } from '@/runtime/clothPicker';
import { PinMarkers } from '@/runtime/pinMarkers';
import { SelectionOverlay } from '@/runtime/selectionOverlay';
import { DragMarker } from '@/runtime/dragMarker';
import type { OverlayKit } from '@/runtime/overlayKit';
import { trianglePointToPanel2D } from '@/base/geom/panelSurface';
import { bodyOccludesSegment } from '@/runtime/bodyOcclusion';
import { pinsByScreenDistance } from '@/runtime/pinHover';
import { grabWeightsAround } from '@/runtime/clothDrag';
import {
  DRAG_GRAB_RADIUS_M, DRAG_GRAB_STRENGTH, DRAG_MAX_REACH_M, PIN_HOVER_RADIUS_PX,
} from '@/runtime/clothConstants';

/** A cloth surface point resolved to its panel's flat pattern coordinates. */
export interface ClothSurfacePoint {
  panelId: string;
  point: Vec2;
}

/** Pending 3D measurement: placed points and the distance once two exist, in centimetres. */
export interface MeasureReading {
  points: number;
  distanceCm: number | null;
}

/** Cloth surface arrays the overlays and picks share. */
export interface ClothSurface {
  positions: Float32Array;
  normals: Float32Array;
  uv: Float32Array;
}

/** What the interaction view reads from the rest of the engine. */
export interface InteractionViewDeps {
  host: PresenterHost;
  camera: CameraHost;
  overlays: OverlayKit;
  avatarVisible: () => boolean;
  collider: () => AvatarCollider | null;
  input: () => ClothSimInput | null;
  trianglePanelIds: () => (string | null)[];
  simulator: () => ClothSimulator | null;
  simReady: () => boolean;
  positions: () => Float32Array | null;
  surface: () => ClothSurface | null;
  overlayTriangles: (panelIds: string[]) => Uint32Array;
  hasTriangles: (panelId: string) => boolean;
  bounds: () => Bounds;
  viewport: () => { width: number; height: number };
}

/** Default screen tolerance for particle picking, as a fraction of viewport height. */
const DEFAULT_PICK_RADIUS_FACTOR = 0.03;

/** Pins the hover may test for occlusion before giving up. */
const PIN_OCCLUSION_TRIES = 3;

/** Drawn markers and the gestures that resolve against them. */
export class InteractionView {
  private readonly picker: ClothPicker;
  private readonly pins: PinMarkers;
  private readonly selection = new SelectionOverlay();
  private readonly marker = new DragMarker();
  /** In-flight pointer drag. */
  private drag: { center: Vec3; normal: Vec3; particle: number } | null = null;

  constructor(private readonly deps: InteractionViewDeps) {
    this.picker = new ClothPicker(deps.camera, {
      input: deps.input,
      trianglePanelIds: deps.trianglePanelIds,
      panelIds: () => deps.input()?.panels.map(panel => panel.panelId) ?? [],
      particlePositions: deps.positions,
      pickNearestParticle: (origin, dir, radius) =>
        deps.simulator()?.pickNearestParticle(origin, dir, radius) ?? null,
      pickParticleAtPoint: (point, radius, panelSlot) =>
        deps.simulator()?.pickNearestAtPoint(point, radius, panelSlot) ?? null,
      bounds: deps.bounds,
      viewportHeight: () => deps.viewport().height,
    });
    this.pins = new PinMarkers();
  }

  /** Nearest cloth particle to the ray through a screen point. */
  pickParticle(ndcX: number, ndcY: number, radiusFactor = DEFAULT_PICK_RADIUS_FACTOR): ParticlePickHit | null {
    return this.picker.pickClothParticleAtScreen(ndcX, ndcY, radiusFactor);
  }

  /** Cloth surface point under a screen position, in its panel's flat pattern coordinates. */
  pickSurface2D(ndcX: number, ndcY: number): ClothSurfacePoint | null {
    const picked = this.picker.pickSurfaceAtScreen(ndcX, ndcY);
    return picked ? this.toFlat(picked) : null;
  }

  /** True when the garment is the front-most surface under a screen point. */
  hoverCloth(ndcX: number, ndcY: number): boolean {
    const distance = this.picker.clothDistanceAtScreen(ndcX, ndcY);
    if (distance === null) return false;
    if (!this.deps.avatarVisible()) return true;
    const collider = this.deps.collider();
    const ray = this.picker.screenRay(ndcX, ndcY);
    if (!collider) return true;
    return !bodyOccludesSegment(
      (x, y, z) => evalBodyDistance(collider, x, y, z),
      ray.origin, ray.direction, distance,
    );
  }

  /** Pinned particle whose marker sits within `radiusPx` of a screen point, or null. */
  hoverPin(ndcX: number, ndcY: number, radiusPx = PIN_HOVER_RADIUS_PX): number | null {
    const positions = this.deps.positions();
    if (!positions) return null;
    const camera = this.deps.camera.snapshot();
    const { width, height } = this.deps.viewport();
    if (!width || !height) return null;
    const ordered = pinsByScreenDistance(
      this.pins.list(),
      index => {
        const offset = index * 3;
        if (offset + 2 >= positions.length) return null;
        return projectToNdc(
          { x: positions[offset]!, y: positions[offset + 1]!, z: positions[offset + 2]! }, camera,
        );
      },
      ndcX, ndcY, width, height, radiusPx, PIN_OCCLUSION_TRIES,
    );
    if (!ordered.length) return null;
    if (!this.deps.avatarVisible()) return ordered[0]!;
    const collider = this.deps.collider();
    if (!collider) return ordered[0]!;
    const signedDistance = (x: number, y: number, z: number) => evalBodyDistance(collider, x, y, z);
    for (const index of ordered) {
      const offset = index * 3;
      const point = { x: positions[offset]!, y: positions[offset + 1]!, z: positions[offset + 2]! };
      const distance = distanceBetween(camera.position, point);
      const direction = {
        x: (point.x - camera.position.x) / (distance || 1),
        y: (point.y - camera.position.y) / (distance || 1),
        z: (point.z - camera.position.z) / (distance || 1),
      };
      if (!bodyOccludesSegment(signedDistance, camera.position, direction, distance)) return index;
    }
    return null;
  }

  /** Highlights the pin a remove click would release; null restores every marker. */
  setHoveredPin(particleIndex: number | null): void {
    this.pins.highlight(particleIndex);
  }

  /** Raycasts the cloth surface and returns the owning panel of the hit triangle. */
  pickPanel(ndcX: number, ndcY: number): string | null {
    return this.picker.pickPanelAtScreen(ndcX, ndcY);
  }

  /** Starts a 3D sketch stroke on the cloth; returns the pattern point the press landed on. */
  beginSketch(ndcX: number, ndcY: number): ClothSurfacePoint | null {
    const picked = this.picker.pickSurfaceAtScreen(ndcX, ndcY);
    const flat = picked ? this.toFlat(picked) : null;
    if (!picked || !flat) {
      this.deps.overlays.endSketch();
      return null;
    }
    this.deps.overlays.beginSketch(picked.world);
    return flat;
  }

  /** Adds the cloth surface point under the pointer to the active sketch stroke. */
  extendSketch(ndcX: number, ndcY: number): ClothSurfacePoint | null {
    const picked = this.picker.pickSurfaceAtScreen(ndcX, ndcY);
    if (!picked) return null;
    this.deps.overlays.extendSketch(picked.world);
    return this.toFlat(picked);
  }

  /** Drops the sketch stroke overlay. */
  endSketch(): void {
    this.deps.overlays.endSketch();
  }

  /** Places one measurement point; the third call starts a new measurement. */
  measure(ndcX: number, ndcY: number): MeasureReading | null {
    const picked = this.picker.pickSurfaceAtScreen(ndcX, ndcY);
    if (!picked) return null;
    const points = this.deps.overlays.addMeasurePoint(picked.world);
    if (points.length < 2) return { points: 1, distanceCm: null };
    return { points: 2, distanceCm: distanceBetween(points[0]!, points[1]!) * 100 };
  }

  /** Drops the measurement overlay and its placed points. */
  clearMeasurement(): void {
    this.deps.overlays.clearMeasurement();
  }

  /** Grabs the cloth under a screen point; false when the point misses it. */
  beginDrag(ndcX: number, ndcY: number): boolean {
    const simulator = this.deps.simulator();
    if (!simulator) return false;
    const hit = this.pickParticle(ndcX, ndcY);
    const positions = this.deps.positions();
    if (!hit || !positions || positions.length < (hit.index + 1) * 3) return false;
    const ray = this.picker.screenRay(ndcX, ndcY);
    const center = {
      x: positions[hit.index * 3]!,
      y: positions[hit.index * 3 + 1]!,
      z: positions[hit.index * 3 + 2]!,
    };
    const weights = grabWeightsAround(positions, center, DRAG_GRAB_RADIUS_M, DRAG_GRAB_STRENGTH);
    if (!simulator.setGrab(weights, [center.x, center.y, center.z])) return false;
    this.drag = { center, normal: ray.direction, particle: hit.index };
    this.marker.show(hit.index, positions, this.deps.host, this.deps.camera.snapshot());
    return true;
  }

  /** Moves the drag target to where the pointer ray crosses the plane it started on. */
  moveDrag(ndcX: number, ndcY: number): void {
    const drag = this.drag;
    const simulator = this.deps.simulator();
    if (!drag || !simulator) return;
    const ray = this.picker.screenRay(ndcX, ndcY);
    const denominator = dot(drag.normal, ray.direction);
    if (Math.abs(denominator) < 1e-9) return;
    const t = dot(drag.normal, sub(drag.center, ray.origin)) / denominator;
    if (!(t > 0)) return;
    let point = add(ray.origin, scale(ray.direction, t));
    const offset = sub(point, drag.center);
    const reach = length(offset);
    if (reach > DRAG_MAX_REACH_M) point = add(drag.center, scale(offset, DRAG_MAX_REACH_M / reach));
    simulator.moveGrab([point.x, point.y, point.z]);
  }

  /** Releases the drag; the cloth keeps the velocity the pull gave it. */
  endDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.marker.hide(this.deps.host);
    this.deps.simulator()?.clearGrab();
  }

  /** True while a pointer holds the cloth. */
  get dragging(): boolean {
    return this.drag !== null;
  }

  /** Highlights the listed panels; ids without cloth triangles are ignored. */
  setSelectedPanels(panelIds: string[]): void {
    const ids = panelIds.filter(id => this.deps.hasTriangles(id));
    const surface = this.deps.surface();
    this.selection.apply(this.deps.host, surface, ids, this.deps.overlayTriangles(ids));
  }

  /** Selected panel ids, in selection order. */
  getSelectedPanelIds(): string[] {
    return this.selection.getSelected();
  }

  /** Pin or unpin a cloth particle and update its marker. */
  async setPin(particleIndex: number, pinned: boolean): Promise<boolean> {
    const simulator = this.deps.simulator();
    if (!simulator) return false;
    if (!await simulator.setParticlePin(particleIndex, pinned)) return false;
    if (pinned) this.pins.add(particleIndex, this.deps.positions(), this.deps.host);
    else this.pins.remove(particleIndex, this.deps.host);
    return true;
  }

  /** Particle indices carrying a PIN marker. */
  getPinMarkers(): readonly number[] {
    return this.pins.list();
  }

  /** Releases every pinned particle in one solver pass and drops all markers. */
  async clearPins(): Promise<boolean> {
    const simulator = this.deps.simulator();
    if (!simulator) return false;
    const indices = simulator.getPinnedParticles();
    const released = indices.length === 0 || await simulator.setParticlePins(indices, false);
    this.pins.clear(this.deps.host);
    return released;
  }

  /** Marked particles a simulator rebuild re-applies; markers past the particle count are dropped. */
  carriedPinIndices(particleCount: number): number[] {
    const carried: number[] = [];
    for (const index of this.pins.list()) {
      if (index < particleCount) carried.push(index);
      else this.pins.remove(index, this.deps.host);
    }
    return carried;
  }

  /** Moves the markers and the drag ring onto a new set of positions. */
  followPositions(positions: Float32Array): void {
    this.pins.sync(positions);
    if (this.drag) this.marker.sync(positions, this.deps.camera.snapshot());
    const surface = this.deps.surface();
    if (surface) this.selection.updateSurface(surface.positions, surface.normals);
  }

  /** Drops the selection highlight and every pin marker. */
  reset(): void {
    this.selection.clear(this.deps.host);
    this.pins.clear(this.deps.host);
  }

  /** Ends the drag and frees the overlays. */
  dispose(): void {
    this.endDrag();
    this.marker.dispose(this.deps.host);
    this.selection.dispose(this.deps.host);
    this.pins.dispose(this.deps.host);
  }

  /** Flat pattern point of a surface pick, or null when the triangle has no panel. */
  private toFlat(picked: ClothSurfacePick): ClothSurfacePoint | null {
    const input = this.deps.input();
    const panel = picked.panelSlot >= 0 ? input?.panels[picked.panelSlot] : null;
    if (!panel) return null;
    const point = trianglePointToPanel2D(
      panel.vertexOffset, panel.mesh.positions, picked.particles, picked.weights,
    );
    return point ? { panelId: panel.panelId, point } : null;
  }
}

/** Projects a world point to normalized device coordinates. */
function projectToNdc(point: Vec3, camera: CameraState): Vec3 | null {
  const forward = normalize(sub(camera.target, camera.position));
  if (!forward) return null;
  const right = normalize(cross(forward, camera.up));
  if (!right) return null;
  const up = cross(right, forward);
  const rel = sub(point, camera.position);
  const depth = dot(rel, forward);
  if (depth <= camera.near) return null;
  const x = dot(rel, right);
  const y = dot(rel, up);
  if (camera.projection === 'orthographic') {
    const halfHeight = Math.max(0.001, camera.viewHeightMeters) / 2;
    const halfWidth = halfHeight * Math.max(0.001, camera.aspect);
    return { x: x / halfWidth, y: y / halfHeight, z: (depth - camera.near) / (camera.far - camera.near) };
  }
  const tanHalf = Math.tan(camera.fovDeg * Math.PI / 360);
  return {
    x: x / (depth * tanHalf * Math.max(0.001, camera.aspect)),
    y: y / (depth * tanHalf),
    z: (depth - camera.near) / (camera.far - camera.near),
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v: Vec3): Vec3 | null {
  const size = length(v);
  return size > 1e-9 ? { x: v.x / size, y: v.y / size, z: v.z / size } : null;
}

function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
