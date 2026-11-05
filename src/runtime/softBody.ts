import * as THREE from 'three/webgpu';
import type { MeshCollider } from '@/avatar/collider';
import { meshTrianglesFromObject } from '@/runtime/avatarMeshCollider';
import { AVATAR_OVERLAY_NAME } from '@/runtime/clothConstants';

/** Radius a cloth contact presses the body within, in meters. */
const SOFT_RADIUS_M = 0.06;
/** Fraction of the cloth indentation the body yields. */
const SOFT_YIELD = 0.35;
/** Deepest body indentation kept, in meters. */
const SOFT_MAX_DEPTH_M = 0.008;
/** Share of a new target applied per update, which also damps jitter. */
const SOFT_RELAX = 0.35;
/** Spatial hash cell edge for soft-vertex queries, in meters. */
const SOFT_CELL_M = 0.06;

/** One body vertex that can be pressed inward. */
interface SoftVertex {
  mesh: THREE.Mesh;
  index: number;
  restX: number;
  restY: number;
  restZ: number;
  /** Inward direction in mesh-local space. */
  dirX: number;
  dirY: number;
  dirZ: number;
  /** Rest position in world space, for the spatial hash. */
  worldX: number;
  worldY: number;
  worldZ: number;
  depth: number;
}

/** One mesh carrying soft vertices and its untouched position copy. */
interface SoftMesh {
  mesh: THREE.Mesh;
  positions: Float32Array;
  rest: Float32Array;
}

/** Names of detail meshes that stay rigid while the torso deforms. */
const RIGID_DETAIL = /eye|lash|brow|teeth|tongue/i;

/** Cells a soft vertex may be stored under; keyed by integer cell coordinates. */
function cellKey(x: number, y: number, z: number): string {
  return `${Math.floor(x / SOFT_CELL_M)}_${Math.floor(y / SOFT_CELL_M)}_${Math.floor(z / SOFT_CELL_M)}`;
}

/**
 * Compresses the chest and abdomen under cloth pressure by moving body vertices inward and
 * refreshing the mesh collider's triangle positions. Soft vertices are fixed at attach time.
 */
export class SoftBodyDeformer {
  private root: THREE.Object3D | null = null;
  private meshCollider: MeshCollider | null = null;
  private soft: SoftVertex[] = [];
  private meshes: SoftMesh[] = [];
  private readonly grid = new Map<string, number[]>();
  private enabled = false;

  /** True while the deformer has soft vertices and is enabled. */
  get active(): boolean { return this.enabled && this.soft.length > 0; }

  /** Collects chest and abdomen vertices of one avatar; a same-root attach is a no-op. */
  attach(root: THREE.Object3D | null, meshCollider: MeshCollider | null): void {
    if (!root || !meshCollider) return;
    if (this.root === root && this.meshCollider === meshCollider) return;
    this.root = root;
    this.meshCollider = meshCollider;
    this.meshes = [];
    this.soft = [];
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const min = bounds.min, max = bounds.max;
    const height = max.y - min.y;
    const centerX = (min.x + max.x) / 2;
    const centerZ = (min.z + max.z) / 2;
    const y0 = min.y + height * 0.45;
    const y1 = min.y + height * 0.78;
    const halfWidth = (max.x - min.x) * 0.3;
    const world = new THREE.Vector3();
    const worldDir = new THREE.Vector3();
    const inv = new THREE.Matrix4();

    const seenGeometry = new Set<string>();
    root.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh || !mesh.geometry) return;
      if (mesh.name === AVATAR_OVERLAY_NAME || RIGID_DETAIL.test(mesh.name)) return;
      if (seenGeometry.has(mesh.geometry.uuid)) return;
      seenGeometry.add(mesh.geometry.uuid);
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!position) return;
      const array = position.array as Float32Array;
      const rest = array.slice();
      inv.copy(mesh.matrixWorld).invert();
      const localSoft: SoftVertex[] = [];
      for (let i = 0; i < position.count; i++) {
        world.set(array[i * 3]!, array[i * 3 + 1]!, array[i * 3 + 2]!).applyMatrix4(mesh.matrixWorld);
        if (world.y < y0 || world.y > y1) continue;
        if (Math.abs(world.x - centerX) > halfWidth) continue;
        if (Math.abs(world.z - centerZ) < 0.02) continue;
        worldDir.set(centerX - world.x, 0, centerZ - world.z);
        if (worldDir.lengthSq() < 1e-8) continue;
        worldDir.normalize().transformDirection(inv).normalize();
        localSoft.push({
          mesh, index: i,
          restX: array[i * 3]!, restY: array[i * 3 + 1]!, restZ: array[i * 3 + 2]!,
          dirX: worldDir.x, dirY: worldDir.y, dirZ: worldDir.z,
          worldX: world.x, worldY: world.y, worldZ: world.z,
          depth: 0,
        });
      }
      if (localSoft.length === 0) return;
      this.meshes.push({ mesh, positions: array, rest });
      this.soft.push(...localSoft);
    });

    this.grid.clear();
    this.soft.forEach((vertex, index) => {
      const key = cellKey(vertex.worldX, vertex.worldY, vertex.worldZ);
      const list = this.grid.get(key);
      if (list) list.push(index);
      else this.grid.set(key, [index]);
    });
  }

  /** Switches soft deformation on or off; turning it off restores the rest body. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.restore();
  }

  /**
   * Moves soft vertices toward a target depth derived from the cloth contact move. Returns true
   * when any position or collider triangle changed and the GPU collider needs a refresh.
   */
  update(clothPositions: Float32Array, contactMove: Float32Array): boolean {
    if (!this.active) return false;
    const targets = new Float64Array(this.soft.length);
    const radiusSq = SOFT_RADIUS_M * SOFT_RADIUS_M;
    const count = Math.min(Math.floor(clothPositions.length / 3), contactMove.length);
    for (let i = 0; i < count; i++) {
      const move = contactMove[i]!;
      if (!Number.isFinite(move) || move <= 0) continue;
      const px = clothPositions[i * 3]!;
      const py = clothPositions[i * 3 + 1]!;
      const pz = clothPositions[i * 3 + 2]!;
      const base = Math.min(move * SOFT_YIELD, SOFT_MAX_DEPTH_M);
      const cx = Math.floor(px / SOFT_CELL_M);
      const cy = Math.floor(py / SOFT_CELL_M);
      const cz = Math.floor(pz / SOFT_CELL_M);
      for (let oz = -1; oz <= 1; oz++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const list = this.grid.get(`${cx + ox}_${cy + oy}_${cz + oz}`);
            if (!list) continue;
            for (const index of list) {
              const vertex = this.soft[index]!;
              const dx = vertex.worldX - px;
              const dy = vertex.worldY - py;
              const dz = vertex.worldZ - pz;
              const distanceSq = dx * dx + dy * dy + dz * dz;
              if (distanceSq > radiusSq) continue;
              const falloff = 1 - Math.sqrt(distanceSq) / SOFT_RADIUS_M;
              const target = base * falloff * falloff;
              if (target > targets[index]!) targets[index] = target;
            }
          }
        }
      }
    }

    let changed = false;
    let maxDepth = 0;
    for (let i = 0; i < this.soft.length; i++) {
      const vertex = this.soft[i]!;
      const target = targets[i]!;
      const next = vertex.depth * (1 - SOFT_RELAX) + target * SOFT_RELAX;
      if (Math.abs(next - vertex.depth) > 1e-6) changed = true;
      vertex.depth = next;
      maxDepth = Math.max(maxDepth, next);
    }
    if (!changed && maxDepth < 1e-5) return false;

    for (const vertex of this.soft) {
      const p = vertex.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = p.array as Float32Array;
      array[vertex.index * 3] = vertex.restX - vertex.dirX * vertex.depth;
      array[vertex.index * 3 + 1] = vertex.restY - vertex.dirY * vertex.depth;
      array[vertex.index * 3 + 2] = vertex.restZ - vertex.dirZ * vertex.depth;
    }
    for (const entry of this.meshes) {
      const attr = entry.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.needsUpdate = true;
      entry.mesh.geometry.computeVertexNormals();
    }
    this.refreshCollider();
    return true;
  }

  /** Puts every soft vertex back at its rest position and refreshes the collider triangles. */
  restore(): boolean {
    if (!this.root) return false;
    let hadDepth = false;
    for (const entry of this.meshes) {
      const attr = entry.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      (attr.array as Float32Array).set(entry.rest);
      attr.needsUpdate = true;
      entry.mesh.geometry.computeVertexNormals();
    }
    for (const vertex of this.soft) {
      if (vertex.depth > 1e-6) hadDepth = true;
      vertex.depth = 0;
    }
    if (hadDepth) this.refreshCollider();
    return hadDepth;
  }

  /** Copies deformed world triangles back into the collider; the cell grid is left as it is. */
  private refreshCollider(): void {
    if (!this.root || !this.meshCollider) return;
    const triangles = meshTrianglesFromObject(this.root);
    if (triangles.length === this.meshCollider.vertices.length) {
      this.meshCollider.vertices.set(triangles);
    }
  }
}
