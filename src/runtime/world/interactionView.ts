import type { Vec3 } from '@/base/math';
import type { Vec2 } from '@/model/types';
import type { Bounds, CameraHost } from '@/render/common';
import type { OverlayKit } from '@/runtime/world/overlayKit';
import type { PresenterHost } from '@/runtime/world/presenters/host';
import type { ClothSimInput, ParticlePickHit } from '@/sim/common';
import type { ClothSimulator } from '@/sim/solver';

import { evalBodyDistance, type AvatarCollider } from '@/avatar/collider';
import { add3, distance3, dot3, length3, scale3, sub3 } from '@/base/math';
import { trianglePointToPanel2D } from '@/pattern/panel';
import { projectWorldToNdc } from '@/render/common';
import {
  DRAG_GRAB_RADIUS_M, DRAG_MAX_REACH_M, PIN_HOVER_RADIUS_PX,
} from '@/runtime/engine/clothConstants';
import { grabWeightsAround } from '@/runtime/engine/clothDrag';
import { pinsByScreenDistance } from '@/runtime/engine/pinHover';
import { ClothPicker, type ClothSurfacePick } from '@/runtime/view/clothPicker';
import { bodyOccludesSegment } from '@/runtime/world/bodyOcclusion';
import { DragMarker } from '@/runtime/world/dragMarker';
import { PinMarkers } from '@/runtime/world/pinMarkers';
import { SelectionOverlay } from '@/runtime/world/selectionOverlay';

const DEFAULT_PICK_RADIUS_FACTOR = 0.03;

const PIN_OCCLUSION_TRIES = 3;

export interface ClothSurfacePoint {
  panelId: string;
  point: Vec2;
}

export interface MeasureReading {
  points: number;
  distanceCm: number | null;
}

export interface ClothSurface {
  positions: Float32Array;
  normals: Float32Array;
  uv: Float32Array;
}

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

export class InteractionView {
  private readonly picker: ClothPicker;
  private readonly pins: PinMarkers;
  private readonly selection = new SelectionOverlay();
  private readonly marker = new DragMarker();
  private drag: { center: Vec3; normal: Vec3 } | null = null;

  constructor(private readonly deps: InteractionViewDeps) {
    this.picker = new ClothPicker(deps.camera, {
      input: deps.input,
      trianglePanelIds: deps.trianglePanelIds,
      panelIds: () => deps.input()?.panels.map(panel => panel.panelId) ?? [],
      particlePositions: deps.positions,
      pickNearestParticle: (origin, dir, radius) =>
        deps.simulator()?.pickRay(origin, dir, radius) ?? null,
      pickParticleAtPoint: (point, radius, panelSlot) =>
        deps.simulator()?.pickPoint(point, radius, panelSlot) ?? null,
      bounds: deps.bounds,
      viewportHeight: () => deps.viewport().height,
    });
    this.pins = new PinMarkers();
  }

  pickParticle(ndcX: number, ndcY: number, radiusFactor = DEFAULT_PICK_RADIUS_FACTOR): ParticlePickHit | null {
    return this.picker.pickClothParticleAtScreen(ndcX, ndcY, radiusFactor);
  }

  pickSurface2D(ndcX: number, ndcY: number): ClothSurfacePoint | null {
    const picked = this.picker.pickSurfaceAtScreen(ndcX, ndcY);
    return picked ? this.toFlat(picked) : null;
  }

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
        return projectWorldToNdc(
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
      const distance = distance3(camera.position, point);
      const direction = {
        x: (point.x - camera.position.x) / (distance || 1),
        y: (point.y - camera.position.y) / (distance || 1),
        z: (point.z - camera.position.z) / (distance || 1),
      };
      if (!bodyOccludesSegment(signedDistance, camera.position, direction, distance)) return index;
    }

    return null;
  }

  setHoveredPin(particleIndex: number | null): void {
    this.pins.highlight(particleIndex);
  }

  pickPanel(ndcX: number, ndcY: number): string | null {
    return this.picker.pickPanelAtScreen(ndcX, ndcY);
  }

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

  extendSketch(ndcX: number, ndcY: number): ClothSurfacePoint | null {
    const picked = this.picker.pickSurfaceAtScreen(ndcX, ndcY);
    if (!picked) return null;
    this.deps.overlays.extendSketch(picked.world);
    return this.toFlat(picked);
  }

  endSketch(): void {
    this.deps.overlays.endSketch();
  }

  measure(ndcX: number, ndcY: number): MeasureReading | null {
    const picked = this.picker.pickSurfaceAtScreen(ndcX, ndcY);
    if (!picked) return null;
    const points = this.deps.overlays.addMeasurePoint(picked.world);
    if (points.length < 2) return { points: 1, distanceCm: null };
    return { points: 2, distanceCm: distance3(points[0]!, points[1]!) * 100 };
  }

  clearMeasurement(): void {
    this.deps.overlays.clearMeasurement();
  }

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
    const weights = grabWeightsAround(positions, center, DRAG_GRAB_RADIUS_M);
    if (!simulator.grab(weights, [center.x, center.y, center.z])) return false;
    this.drag = { center, normal: ray.direction };
    this.marker.show(
      hit.index, positions, this.deps.host, this.deps.camera.snapshot(), this.deps.viewport().height,
    );
    return true;
  }

  moveDrag(ndcX: number, ndcY: number): void {
    const drag = this.drag;
    const simulator = this.deps.simulator();
    if (!drag || !simulator) return;
    const ray = this.picker.screenRay(ndcX, ndcY);
    const denominator = dot3(drag.normal, ray.direction);
    if (Math.abs(denominator) < 1e-9) return;
    const t = dot3(drag.normal, sub3(drag.center, ray.origin)) / denominator;
    if (!(t > 0)) return;
    let point = add3(ray.origin, scale3(ray.direction, t));
    const offset = sub3(point, drag.center);
    const reach = length3(offset);
    if (reach > DRAG_MAX_REACH_M) point = add3(drag.center, scale3(offset, DRAG_MAX_REACH_M / reach));
    simulator.moveGrab([point.x, point.y, point.z]);
    this.marker.moveTip(point);
  }

  endDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.marker.hide(this.deps.host);
    this.deps.simulator()?.clearGrab();
  }

  dragForceN(): number | null {
    return this.deps.simulator()?.grabForceN() ?? null;
  }

  dragArrowHeadNdc(): { x: number; y: number } | null {
    const head = this.marker.arrowHeadWorld();
    if (!head) return null;
    const { width, height } = this.deps.viewport();
    return projectWorldToNdc(head, this.deps.camera.snapshot(), width / Math.max(1, height));
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  setSelectedPanels(panelIds: string[]): void {
    const ids = panelIds.filter(id => this.deps.hasTriangles(id));
    const surface = this.deps.surface();
    this.selection.apply(this.deps.host, surface, ids, this.deps.overlayTriangles(ids));
  }

  getSelectedPanelIds(): string[] {
    return this.selection.getSelected();
  }

  async setPin(particleIndex: number, pinned: boolean): Promise<boolean> {
    const simulator = this.deps.simulator();
    if (!simulator) return false;
    if (!await simulator.pin([particleIndex], pinned)) return false;
    if (pinned) this.pins.add(particleIndex, this.deps.positions(), this.deps.host);
    else this.pins.remove(particleIndex, this.deps.host);
    return true;
  }

  getPinMarkers(): readonly number[] {
    return this.pins.list();
  }

  async clearPins(): Promise<boolean> {
    const simulator = this.deps.simulator();
    if (!simulator) return false;
    const indices = simulator.pinned();
    const released = indices.length === 0 || await simulator.pin(indices, false);
    this.pins.clear(this.deps.host);
    return released;
  }

  carriedPinIndices(particleCount: number): number[] {
    const carried: number[] = [];
    for (const index of this.pins.list()) {
      if (index < particleCount) carried.push(index);
      else this.pins.remove(index, this.deps.host);
    }

    return carried;
  }

  followPositions(positions: Float32Array, surfacePositions?: Float32Array): void {
    this.pins.sync(positions);
    if (this.drag) {
      this.marker.sync(positions, this.deps.camera.snapshot(), this.deps.viewport().height);
    }

    const surface = this.deps.surface();
    if (surface) this.selection.updateSurface(surfacePositions ?? surface.positions, surface.normals);
  }

  reset(): void {
    this.selection.clear(this.deps.host);
    this.pins.clear(this.deps.host);
  }

  dispose(): void {
    this.endDrag();
    this.marker.dispose(this.deps.host);
    this.selection.dispose(this.deps.host);
    this.pins.dispose(this.deps.host);
  }

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
