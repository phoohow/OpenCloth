import * as THREE from 'three/webgpu';
import type { Vec2 } from '@/model/types';
import type { ClothSimInput } from '@/sim';
import type { ClothSimulator } from '@/sim';
import type { ParticlePickHit } from '@/sim';
import type { Renderer } from '@/render';
import type { AvatarStage } from '@/runtime/avatarStage';
import { ClothPicker, type ClothSurfacePick } from '@/runtime/clothPicker';
import { ClothInteraction } from '@/runtime/clothInteraction';
import { PinMarkers } from '@/runtime/pinMarkers';
import { SelectionOverlay } from '@/runtime/selectionOverlay';
import type { OverlayKit } from '@/runtime/overlayKit';
import { trianglePointToPanel2D } from '@/common/geom/panelSurface';
import type { SceneSlot } from '@/render';

/** A cloth surface point resolved to its panel's flat pattern coordinates. */
export interface ClothSurfacePoint {
  /** Owning panel id. */
  panelId: string;
  /** Pattern-space point, in centimetres. */
  point: Vec2;
}

/** Pending 3D measurement: placed points and the distance once two exist, in centimetres. */
export interface MeasureReading {
  points: number;
  distanceCm: number | null;
}

/** Default screen tolerance for particle picking, as a fraction of viewport height. */
const DEFAULT_PICK_RADIUS_FACTOR = 0.03;

/** What the interaction view reads from the rest of the engine. */
export interface InteractionViewDeps {
  /** Selection highlight. */
  slot: SceneSlot;
  /** Pin markers. */
  pinSlot: SceneSlot;
  /** Drag marker. */
  markerSlot: SceneSlot;
  renderer: Renderer;
  overlays: OverlayKit;
  avatar: AvatarStage;
  /** Merged cloth the picks land on. */
  input: () => ClothSimInput | null;
  /** Merged render mesh the picks run against. */
  mesh: () => THREE.Mesh | null;
  /** Owning panel of each merged triangle, indexed by triangle number. */
  trianglePanelIds: () => (string | null)[];
  simulator: () => ClothSimulator | null;
  simReady: () => boolean;
  /** Particle positions the markers and drags follow. */
  positions: () => Float32Array | null;
  geometry: () => THREE.BufferGeometry | null;
  /** Merged triangles of the listed panels, for the selection highlight. */
  overlayTriangles: (panelIds: string[]) => Uint32Array;
  /** Whether a panel contributes cloth triangles. */
  hasTriangles: (panelId: string) => boolean;
  /** Objects a camera framing counts. */
  frameObjects: () => THREE.Object3D[];
}

/**
 * Everything the pointer does to the cloth: picking, hovering, dragging, sketching, measuring,
 * pinning and the panel selection highlight.
 */
export class InteractionView {
  private readonly picker: ClothPicker;
  private readonly interaction: ClothInteraction;
  private readonly pins = new PinMarkers();
  private readonly selection = new SelectionOverlay();

  constructor(private readonly deps: InteractionViewDeps) {
    this.picker = new ClothPicker(deps.renderer, {
      mesh: deps.mesh,
      trianglePanelIds: deps.trianglePanelIds,
      triangleParticles: triangle => mergedTriangleParticles(deps.input(), triangle),
      particlePositions: deps.positions,
      panelIds: () => deps.input()?.panels.map(panel => panel.panelId) ?? [],
      pickNearestParticle: (origin, direction, radius) =>
        deps.simulator()?.pickNearestParticle(origin, direction, radius) ?? null,
      pickParticleAtPoint: (point, radius, panelSlot) =>
        deps.simulator()?.pickNearestAtPoint(point, radius, panelSlot) ?? null,
      frameObjects: deps.frameObjects,
    });
    this.interaction = new ClothInteraction({
      picker: this.picker,
      avatar: deps.avatar,
      pinMarkers: this.pins,
      markerSlot: deps.markerSlot,
      renderer: deps.renderer,
      positions: deps.positions,
      simulator: () => (deps.simReady() ? deps.simulator() : null),
      pickParticle: (ndcX, ndcY) => this.picker.pickClothParticleAtScreen(ndcX, ndcY, DEFAULT_PICK_RADIUS_FACTOR),
    });
  }

  /** Picker the camera presets and refit gestures run through. */
  get targets(): ClothPicker { return this.picker; }

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
    return this.interaction.hoverClothAtScreen(ndcX, ndcY);
  }

  /** Pinned particle whose marker sits within `radiusPx` of a screen point, or null. */
  hoverPin(ndcX: number, ndcY: number, radiusPx?: number): number | null {
    return this.interaction.hoverPinAtScreen(ndcX, ndcY, radiusPx);
  }

  /** Highlights the pin a remove click would release; null restores every marker. */
  setHoveredPin(particleIndex: number | null): void {
    this.interaction.setHoveredPin(particleIndex);
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

  /**
   * Places one measurement point on the cloth surface. The third call starts a new measurement;
   * the reading reports the distance once two points exist.
   */
  measure(ndcX: number, ndcY: number): MeasureReading | null {
    const picked = this.picker.pickSurfaceAtScreen(ndcX, ndcY);
    if (!picked) return null;
    const points = this.deps.overlays.addMeasurePoint(picked.world);
    if (points.length < 2) return { points: 1, distanceCm: null };
    return { points: 2, distanceCm: points[0]!.distanceTo(points[1]!) * 100 };
  }

  /** Drops the measurement overlay and its placed points. */
  clearMeasurement(): void {
    this.deps.overlays.clearMeasurement();
  }

  /** Grabs the cloth under a screen point for a pointer drag; false when the point misses it. */
  beginDrag(ndcX: number, ndcY: number): boolean {
    return this.interaction.beginDrag(ndcX, ndcY);
  }

  /** Moves the drag target to where the pointer ray crosses the plane it started on. */
  moveDrag(ndcX: number, ndcY: number): void {
    this.interaction.moveDrag(ndcX, ndcY);
  }

  /** Releases the pointer drag; the cloth keeps the velocity the pull gave it. */
  endDrag(): void {
    this.interaction.endDrag();
  }

  /** Highlights the listed panels; ids without cloth triangles are ignored. */
  setSelectedPanels(panelIds: string[]): void {
    const ids = panelIds.filter(id => this.deps.hasTriangles(id));
    const geometry = this.deps.input() ? this.deps.geometry() : null;
    this.selection.apply(this.deps.slot, geometry, ids, this.deps.overlayTriangles(ids));
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
    if (pinned) this.addPinMarker(particleIndex);
    else this.pins.remove(particleIndex, this.deps.pinSlot);
    return true;
  }

  /** Particle indices carrying a PIN marker, that is, the points pinned by hand. */
  getPinMarkers(): readonly number[] {
    return this.pins.list();
  }

  /** Releases every pinned particle in one solver pass and drops all markers. */
  async clearPins(): Promise<boolean> {
    const simulator = this.deps.simulator();
    if (!simulator) return false;
    const indices = simulator.getPinnedParticles();
    const released = indices.length === 0 || await simulator.setParticlePins(indices, false);
    this.pins.clear(this.deps.pinSlot);
    return released;
  }

  /** Marked particles a simulator rebuild re-applies; markers past the particle count are dropped. */
  carriedPinIndices(particleCount: number): number[] {
    const carried: number[] = [];
    for (const index of this.pins.list()) {
      if (index < particleCount) carried.push(index);
      else this.pins.remove(index, this.deps.pinSlot);
    }
    return carried;
  }

  /** Moves the markers and the drag target onto a new set of positions. */
  followPositions(positions: Float32Array): void {
    this.pins.sync(positions);
    this.interaction.syncMarker(positions);
  }

  /** Drops the selection highlight and every pin marker. */
  reset(): void {
    this.selection.clear(this.deps.slot);
    this.pins.clear(this.deps.pinSlot);
  }

  /** Frees the selection overlay and pin markers. */
  dispose(): void {
    this.selection.dispose(this.deps.slot);
    this.pins.dispose(this.deps.pinSlot);
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

  private addPinMarker(particleIndex: number): void {
    const positions = this.deps.positions();
    if (positions) this.pins.add(particleIndex, positions, this.deps.pinSlot);
  }
}

/** Triangle particles of the merged input, or null when the triangle is out of range. */
function mergedTriangleParticles(input: ClothSimInput | null, triangle: number): readonly number[] | null {
  if (!input || triangle < 0 || triangle * 3 + 2 >= input.indices.length) return null;
  const base = triangle * 3;
  return [input.indices[base]!, input.indices[base + 1]!, input.indices[base + 2]!];
}
