import * as THREE from 'three/webgpu';
import type { Project, TrimKind, Vec2 } from '@/model/types';
import type { ClothSimInput } from '@/sim';
import type { TriangleMesh } from '@/pattern/triangulate';
import type { StageSlot } from '@/render';

/** One 3D trim placed on the cloth. */
export interface TrimInstance {
  trimId: string;
  kind: TrimKind;
  color: string;
  /** Merged cloth particle the trim rides. */
  particle: number;
  /** Trim diameter in meters. */
  diameter: number;
}

/** Axis of the base geometry that must point along the cloth normal. */
type TrimAxis = 'x' | 'y' | 'z' | 'none';

const TRIM_AXIS: Record<TrimKind, TrimAxis> = {
  button: 'y',
  eyelet: 'z',
  rivet: 'none',
  snap: 'y',
};

/** Distance a trim sits above the cloth surface, in meters. */
const TRIM_LIFT_M = 0.0003;

/** Trims of visible panels, each snapped to the nearest merged cloth particle. */
export function trimInstances(project: Project, panels: ClothSimInput['panels']): TrimInstance[] {
  const pattern = project.pattern;
  const out: TrimInstance[] = [];
  for (const panel of panels) {
    if (pattern.panels[panel.panelId]?.visible === false) continue;
    const trims = Object.values(pattern.trims ?? {}).filter(
      trim => trim.panelId === panel.panelId && trim.visible !== false,
    );
    if (trims.length === 0) continue;
    for (const trim of trims) {
      const local = nearestVertex(panel.mesh, trim.pos);
      if (local < 0) continue;
      out.push({
        trimId: trim.id,
        kind: trim.kind,
        color: trim.color,
        particle: panel.vertexOffset + local,
        diameter: Math.max(0.4, trim.sizeMm / 10) / 100,
      });
    }
  }
  return out;
}

/** Mesh vertex nearest to a pattern point, or -1 for an empty mesh. */
function nearestVertex(mesh: TriangleMesh, point: Vec2): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const dx = mesh.positions[i * 2] - point.x;
    const dy = mesh.positions[i * 2 + 1] - point.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Instanced 3D trims drawn above the cloth and exported as the `trims` group. */
export class TrimInstances {
  private group: THREE.Group | null = null;
  private meshes: Array<{ mesh: THREE.InstancedMesh; instances: TrimInstance[] }> = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly normal = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();

  /** Builds one instanced mesh per trim kind and adds the group to the scene. */
  attach(
    scene: StageSlot,
    instances: TrimInstance[],
    positions: Float32Array,
    normals?: Float32Array,
  ): void {
    this.detach(scene);
    if (instances.length === 0) return;
    const group = new THREE.Group();
    group.name = 'trims';
    const material = trimMaterial();
    for (const kind of Object.keys(TRIM_AXIS) as TrimKind[]) {
      const list = instances.filter(instance => instance.kind === kind);
      if (list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(trimGeometry(kind), material, list.length);
      mesh.frustumCulled = false;
      mesh.name = `trims-${kind}`;
      list.forEach((instance, index) => {
        mesh.setColorAt(index, new THREE.Color(instance.color));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
      this.meshes.push({ mesh, instances: list });
    }
    this.group = group;
    scene.add(group);
    this.update(positions, normals);
  }

  /** Rewrites every instance transform from the current cloth positions and normals. */
  update(positions: Float32Array, normals?: Float32Array): void {
    if (!this.group) return;
    for (const { mesh, instances } of this.meshes) {
      instances.forEach((instance, index) => {
        const o = instance.particle * 3;
        if (o + 2 >= positions.length) {
          this.matrix.makeScale(0, 0, 0);
          mesh.setMatrixAt(index, this.matrix);
          return;
        }
        const n = this.normalAt(instance.particle, normals);
        this.position.set(
          positions[o]! + n.x * TRIM_LIFT_M,
          positions[o + 1]! + n.y * TRIM_LIFT_M,
          positions[o + 2]! + n.z * TRIM_LIFT_M,
        );
        this.scale.set(instance.diameter, instance.diameter, instance.diameter);
        orientToNormal(this.quaternion, this.axis, TRIM_AXIS[instance.kind], n);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        mesh.setMatrixAt(index, this.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Shows or hides the trims together with the cloth beneath them. */
  setVisible(visible: boolean): void {
    if (this.group) this.group.visible = visible;
  }

  /** Removes the group from the scene and frees its geometries and material. */
  detach(scene: StageSlot): void {
    if (!this.group) return;
    scene.remove(this.group);
    let material: THREE.Material | null = null;
    for (const { mesh } of this.meshes) {
      mesh.geometry.dispose();
      material = mesh.material as THREE.Material;
      mesh.dispose();
    }
    material?.dispose();
    this.meshes = [];
    this.group = null;
  }

  /** Cloth normal at one particle, or up when the readback carries none. */
  private normalAt(particle: number, normals?: Float32Array): THREE.Vector3 {
    const o = particle * 3;
    if (normals && o + 2 < normals.length) {
      const x = normals[o]!, y = normals[o + 1]!, z = normals[o + 2]!;
      const len = Math.hypot(x, y, z);
      if (len > 1e-9) return this.normal.set(x / len, y / len, z / len);
    }
    return this.normal.set(0, 1, 0);
  }
}

/** Rotates a trim so its base axis points along the cloth normal. */
function orientToNormal(
  quaternion: THREE.Quaternion,
  axis: THREE.Vector3,
  kind: TrimAxis,
  normal: THREE.Vector3,
): void {
  if (kind === 'none') {
    quaternion.set(0, 0, 0, 1);
    return;
  }
  if (kind === 'x') axis.set(1, 0, 0);
  else if (kind === 'y') axis.set(0, 1, 0);
  else axis.set(0, 0, 1);
  quaternion.setFromUnitVectors(axis, normal);
}

/** Base geometry of one trim kind, sized to a unit diameter. */
function trimGeometry(kind: TrimKind): THREE.BufferGeometry {
  if (kind === 'button') return new THREE.CylinderGeometry(0.5, 0.5, 0.16, 20);
  if (kind === 'eyelet') return new THREE.TorusGeometry(0.45, 0.1, 10, 24);
  if (kind === 'snap') return new THREE.CylinderGeometry(0.5, 0.5, 0.1, 20);
  const geometry = new THREE.SphereGeometry(0.5, 16, 10);
  geometry.scale(1, 1, 0.35);
  return geometry;
}

/** Shared metal material for every trim instance. */
function trimMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.55,
    roughness: 0.35,
    side: THREE.DoubleSide,
  });
}
