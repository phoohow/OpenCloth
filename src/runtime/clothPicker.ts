/** Screen rays, cloth surface intersection and particle picking, without three. */

import { distance3, type Vec3 } from '@/base/math';
import { distance3AtPoint, intersectRayTriangle3 } from '@/base/geom';
import { degToRad } from '@/base/math';
import type { Bounds, CameraHost, CameraState, Ray } from '@/render/common';
import type { ClothSimInput, ParticlePickHit } from '@/sim';

/** Cloth surface hit: the triangle, its owning panel slot and the barycentric position on it. */
export interface ClothSurfacePick {
  triangle: number;
  panelSlot: number;
  particles: [number, number, number];
  weights: [number, number, number];
  local: Vec3;
  world: Vec3;
}

/** What the picker reads from the engine. */
export interface PickTargets {
  /** Current merged cloth, positions and triangles. */
  input: () => ClothSimInput | null;
  /** Owning panel of each merged triangle, indexed by triangle number. */
  trianglePanelIds: () => (string | null)[];
  panelIds: () => string[];
  particlePositions: () => Float32Array | null;
  pickNearestParticle: (origin: Vec3, dir: Vec3, radius: number) => ParticlePickHit | null;
  pickParticleAtPoint: (point: Vec3, radius: number, panelSlot: number) => ParticlePickHit | null;
  /** Bounds of every framed object, in world space. */
  bounds: () => Bounds;
  /** Viewport height in CSS pixels, for a screen-stable pick radius. */
  viewportHeight: () => number;
}

/** Screen↔world projection and cloth picking of one viewport. */
export class ClothPicker {
  constructor(private readonly camera: CameraHost, private readonly targets: PickTargets) { }

  /** Ray through a normalized device coordinate point. */
  screenRay(ndcX: number, ndcY: number): Ray {
    return this.camera.ray(ndcX, ndcY);
  }

  /** Distance along the screen ray to the nearest cloth triangle, or null when it misses. */
  clothDistanceAtScreen(ndcX: number, ndcY: number): number | null {
    const hit = this.surfaceHit(this.screenRay(ndcX, ndcY));
    return hit ? hit.distance : null;
  }

  /** Nearest cloth particle to the ray through a screen point. */
  pickClothParticleAtScreen(ndcX: number, ndcY: number, radiusFactor: number): ParticlePickHit | null {
    const ray = this.screenRay(ndcX, ndcY);
    const input = this.targets.input();
    if (!input) return null;
    const radius = radiusFactor * this.screenWorldScale(ray.origin) * 400;

    const surface = this.surfaceHit(ray);
    if (surface) {
      const particle = this.particleAtSurfaceHit(surface, input, radius);
      if (particle) return particle;
    }
    return this.targets.pickNearestParticle(ray.origin, ray.direction, radius);
  }

  /** Raycasts the cloth surface and returns the owning panel of the first hit triangle. */
  pickPanelAtScreen(ndcX: number, ndcY: number): string | null {
    const hit = this.surfaceHit(this.screenRay(ndcX, ndcY));
    return hit ? this.targets.trianglePanelIds()[hit.triangle] ?? null : null;
  }

  /** Cloth surface point under a screen position, with the panel and barycentric weights. */
  pickSurfaceAtScreen(ndcX: number, ndcY: number): ClothSurfacePick | null {
    const input = this.targets.input();
    if (!input) return null;
    const hit = this.surfaceHit(this.screenRay(ndcX, ndcY));
    if (!hit) return null;
    const panelId = this.targets.trianglePanelIds()[hit.triangle] ?? null;
    return {
      triangle: hit.triangle,
      panelSlot: panelId ? this.targets.panelIds().indexOf(panelId) : -1,
      particles: input.indices.subarray(hit.triangle * 3, hit.triangle * 3 + 3) as unknown as [number, number, number],
      weights: [hit.weights[0], hit.weights[1], hit.weights[2]],
      local: hit.point,
      world: hit.point,
    };
  }

  /** Scene box the camera frames. */
  sceneBounds(): Bounds {
    return this.targets.bounds();
  }

  /** World units per screen pixel at the ray origin. */
  private screenWorldScale(origin: Vec3): number {
    const height = Math.max(1, this.targets.viewportHeight());
    const camera = this.camera.snapshot();
    if (camera.projection === 'orthographic') return camera.viewHeightMeters / height;
    const distance = Math.max(0.001, distance3(origin, camera.target));
    const fov = degToRad(camera.fovDeg);
    return (2 * Math.tan(fov / 2) * distance) / height;
  }

  /** First cloth triangle the ray crosses, with its barycentric weights. */
  private surfaceHit(ray: Ray): {
    triangle: number; distance: number; point: Vec3; weights: [number, number, number];
  } | null {
    const input = this.targets.input();
    if (!input) return null;
    const positions = input.positions;
    const indices = input.indices;
    let best: { triangle: number; distance: number; point: Vec3; weights: [number, number, number] } | null = null;
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = indices[i]! * 3;
      const b = indices[i + 1]! * 3;
      const c = indices[i + 2]! * 3;
      const hit = intersectTriangle(
        ray,
        { x: positions[a]!, y: positions[a + 1]!, z: positions[a + 2]! },
        { x: positions[b]!, y: positions[b + 1]!, z: positions[b + 2]! },
        { x: positions[c]!, y: positions[c + 1]!, z: positions[c + 2]! },
      );
      if (!hit || (best && hit.distance >= best.distance)) continue;
      best = {
        triangle: i / 3,
        distance: hit.distance,
        point: {
          x: ray.origin.x + ray.direction.x * hit.distance,
          y: ray.origin.y + ray.direction.y * hit.distance,
          z: ray.origin.z + ray.direction.z * hit.distance,
        },
        weights: hit.weights,
      };
    }
    return best;
  }

  /**
   * Particle the clicked surface point sits closest to, taken from the panel that was clicked.
   * Without a hit there, one of the triangle's own corners carries the PIN.
   */
  private particleAtSurfaceHit(
    hit: { triangle: number; point: Vec3 }, input: ClothSimInput, radius: number,
  ): ParticlePickHit | null {
    const panelId = this.targets.trianglePanelIds()[hit.triangle] ?? null;
    const panelSlot = panelId ? this.targets.panelIds().indexOf(panelId) : -1;
    const picked = this.targets.pickParticleAtPoint(hit.point, radius, panelSlot);
    if (picked) return picked;

    const positions = this.targets.particlePositions();
    if (!positions) return null;
    let index = -1;
    let distance = Infinity;
    for (let corner = 0; corner < 3; corner++) {
      const particle = input.indices[hit.triangle * 3 + corner]!;
      const d = distanceToParticle(positions, particle, hit.point);
      if (d < distance) { distance = d; index = particle; }
    }
    return index < 0 ? null : { index, distance, panelIndex: panelSlot };
  }
}

/** Moller-Trumbore intersection returning the distance and barycentric weights. */
function intersectTriangle(
  ray: Ray, p0: Vec3, p1: Vec3, p2: Vec3,
): { distance: number; weights: [number, number, number] } | null {
  const hit = intersectRayTriangle3(ray.origin, ray.direction, p0, p1, p2);
  return hit ? { distance: hit.distance, weights: [1 - hit.u - hit.v, hit.u, hit.v] } : null;
}

function distanceToParticle(positions: Float32Array, index: number, point: Vec3): number {
  return distance3AtPoint(positions, index, point);
}

export type { CameraState, Ray };
