import * as THREE from 'three/webgpu';
import type { ParticlePickHit } from '../../sim/picking';
import {
  isOrthographic, syncOrthoFrustum, viewportAspect, type RendererContext,
} from '../../render/renderer/rendererContext';
import {
  CAMERA_VIEW_FRAMES, fitCameraToBox, type CameraPreset, type ViewFrame,
} from './cameraFit';

export type { CameraPreset, ViewFrame } from './cameraFit';

/** Scene objects the camera framing is measured against, besides the cloth. */
export interface PickTargets {
  /** Merged cloth mesh, or null before the first build. */
  mesh: () => THREE.Mesh | null;
  /** Owning panel of each merged triangle, indexed by triangle number. */
  trianglePanelIds: () => (string | null)[];
  /** Particle indices of one merged triangle, or null when the triangle is unknown. */
  triangleParticles: (triangleIndex: number) => readonly number[] | null;
  /** Latest particle positions (flat xyz), or null before the cloth has any. */
  particlePositions: () => Float32Array | null;
  /** Panel ids in merged order, used to resolve a surface pick's panel slot. */
  panelIds: () => string[];
  /** Particle index lookup on the live solver. */
  pickNearestParticle: (origin: THREE.Vector3, dir: THREE.Vector3, radius: number) => ParticlePickHit | null;
  /** Particle closest to a surface point; `panelSlot` of -1 searches every panel. */
  pickParticleAtPoint: (point: THREE.Vector3, radius: number, panelSlot: number) => ParticlePickHit | null;
  /** Body and reference models counted by the scene bounds. */
  frameObjects: () => THREE.Object3D[];
}

/** Default box used before any scene object exists. */
const FALLBACK_BOX = new THREE.Box3(
  new THREE.Vector3(-0.3, 0, -0.3),
  new THREE.Vector3(0.3, 1.8, 0.3),
);

/** Screen↔world projection for the 3D viewport: rays, pick radius and camera framing. */
export class ClothPicker {
  private raycaster = new THREE.Raycaster();

  constructor(private ctx: RendererContext, private targets: PickTargets) { }

  /** Ray through a normalized device coordinate point of the main camera. */
  screenRay(ndcX: number, ndcY: number): THREE.Ray | null {
    const { camera, canvas } = this.ctx;
    if (!canvas.clientHeight) return null;
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY } as unknown as THREE.Vector2, camera);
    return this.raycaster.ray.clone();
  }

  /** World units per screen pixel at the ray origin, for a screen-stable pick radius. */
  private screenWorldScale(origin: THREE.Vector3): number {
    const height = Math.max(this.ctx.canvas.clientHeight, 1);
    const camera = this.ctx.camera;
    if (isOrthographic(camera)) {
      return (camera.top - camera.bottom) / camera.zoom / height;
    }
    const distance = Math.max(0.001, origin.distanceTo(this.focusTarget()));
    const fov = camera.fov * (Math.PI / 180);
    return (2 * Math.tan(fov / 2) * distance) / height;
  }

  /** World box covering the cloth, the body and every visible reference model. */
  sceneBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    const cloth = this.clothBounds();
    if (cloth) box.union(cloth);
    for (const object of this.targets.frameObjects()) {
      if (!object.visible) continue;
      object.updateWorldMatrix(false, true);
      const bounds = new THREE.Box3().setFromObject(object);
      if (!bounds.isEmpty()) box.union(bounds);
    }
    return box.isEmpty() ? FALLBACK_BOX.clone() : box;
  }

  /** Centre the camera orbits around: the whole scene box. */
  focusTarget(): THREE.Vector3 {
    return this.sceneBounds().getCenter(new THREE.Vector3());
  }

  /** Nearest cloth particle to the ray through a screen point. */
  pickClothParticleAtScreen(ndcX: number, ndcY: number, radiusFactor: number): ParticlePickHit | null {
    const ray = this.screenRay(ndcX, ndcY);
    const mesh = this.targets.mesh();
    if (!ray || !mesh) return null;
    mesh.updateWorldMatrix(false, false);
    const radius = radiusFactor * this.screenWorldScale(ray.origin) * 400;

    // The drawn surface owns the pick, so a click cannot land on a particle hidden behind the cloth.
    const surface = this.surfaceHit(ray, mesh);
    if (surface) {
      const particle = this.particleAtSurfaceHit(surface, mesh, radius);
      if (particle) return particle;
    }
    return this.nearestParticleOnRay(ray, mesh, radius);
  }

  /** First cloth triangle the ray crosses, or null when it misses the garment. */
  private surfaceHit(ray: THREE.Ray, mesh: THREE.Mesh): THREE.Intersection | null {
    this.raycaster.set(ray.origin, ray.direction);
    for (const hit of this.raycaster.intersectObject(mesh, false)) {
      if ((hit.faceIndex ?? -1) >= 0) return hit;
    }
    return null;
  }

  /**
   * Particle the clicked surface point sits closest to, taken from the panel that was clicked.
   * Without a hit there, one of the triangle's own corners carries the PIN.
   */
  private particleAtSurfaceHit(
    hit: THREE.Intersection, mesh: THREE.Mesh, radius: number,
  ): ParticlePickHit | null {
    const triangle = hit.faceIndex ?? -1;
    const point = mesh.worldToLocal(hit.point.clone());
    const panelId = this.targets.trianglePanelIds()[triangle] ?? null;
    const panelSlot = panelId ? this.targets.panelIds().indexOf(panelId) : -1;

    const picked = this.targets.pickParticleAtPoint(point, radius, panelSlot);
    if (picked) return picked;

    const corners = this.targets.triangleParticles(triangle);
    const positions = this.targets.particlePositions();
    if (!corners || !positions) return null;

    let index = -1;
    let distance = Infinity;
    for (const corner of corners) {
      const d = distanceToParticle(positions, corner, point);
      if (d < distance) { distance = d; index = corner; }
    }
    if (index < 0) return null;
    return { index, distance, panelIndex: panelSlot };
  }

  /** Nearest particle within the screen-scaled tolerance of the ray, ignoring what occludes it. */
  private nearestParticleOnRay(ray: THREE.Ray, mesh: THREE.Mesh, radius: number): ParticlePickHit | null {
    const origin = mesh.worldToLocal(ray.origin.clone());
    const end = mesh.worldToLocal(ray.origin.clone().add(ray.direction));
    const dir = end.sub(origin).normalize();
    return this.targets.pickNearestParticle(origin, dir, radius);
  }

  /** Raycasts the cloth surface and returns the owning panel of the first hit triangle. */
  pickPanelAtScreen(ndcX: number, ndcY: number): string | null {
    const mesh = this.targets.mesh();
    const ray = this.screenRay(ndcX, ndcY);
    if (!mesh || !ray) return null;
    mesh.updateWorldMatrix(false, false);
    const hit = this.surfaceHit(ray, mesh);
    if (!hit) return null;
    return this.targets.trianglePanelIds()[hit.faceIndex ?? -1] ?? null;
  }

  /** Moves the camera to a named preset view, framed on the whole scene box. */
  applyPreset(preset: CameraPreset): void {
    const frame = CAMERA_VIEW_FRAMES[preset];
    this.frameScene(frame.direction, frame.up);
  }

  /** Frames the scene box from the current view direction; keeps orbit direction, resets distance. */
  frameScene(direction?: THREE.Vector3, up?: THREE.Vector3): void {
    const { ctx } = this;
    const { camera, controls } = ctx;
    const box = this.sceneBounds();
    const center = box.getCenter(new THREE.Vector3());
    const dir = viewDirection(camera.position, controls.target, direction);
    const frame = toViewFrame(dir, up ?? camera.up);
    const aspect = viewportAspect(ctx);
    const fit = fitCameraToBox(box, frame, ctx.perspectiveCamera.fov, aspect);

    camera.up.copy(frame.up);
    camera.position.copy(center).add(frame.direction.clone().multiplyScalar(fit.distance));
    controls.target.copy(center);
    ctx.orthoViewHeight = fit.viewHeight;
    ctx.orthographicCamera.zoom = 1;
    syncOrthoFrustum(ctx, aspect);
    controls.update();
  }

  private clothBounds(): THREE.Box3 | null {
    const mesh = this.targets.mesh();
    if (!mesh) return null;
    const box = new THREE.Box3().setFromObject(mesh);
    return box.isEmpty() ? null : box;
  }
}

/** Distance from a flat-xyz particle array entry to a point. */
function distanceToParticle(positions: Float32Array, index: number, point: THREE.Vector3): number {
  const offset = index * 3;
  if (offset + 2 >= positions.length) return Infinity;
  return Math.hypot(positions[offset] - point.x, positions[offset + 1] - point.y, positions[offset + 2] - point.z);
}

/** Direction from the orbit target to the camera, or the supplied override. */
function viewDirection(position: THREE.Vector3, target: THREE.Vector3, override?: THREE.Vector3): THREE.Vector3 {
  const dir = (override ?? position.clone().sub(target)).clone().normalize();
  if (!Number.isFinite(dir.x) || dir.lengthSq() < 1e-6) return CAMERA_VIEW_FRAMES.front.direction.clone();
  return dir;
}

/** View frame for an arbitrary direction, substituting an up vector parallel to it. */
function toViewFrame(direction: THREE.Vector3, up: THREE.Vector3): ViewFrame {
  let safeUp = up.clone().normalize();
  if (Math.abs(safeUp.dot(direction)) > 0.999) {
    safeUp = Math.abs(direction.y) > 0.999
      ? new THREE.Vector3(0, 0, -Math.sign(direction.y))
      : new THREE.Vector3(0, 1, 0);
  }
  return { direction: direction.clone(), up: safeUp };
}
