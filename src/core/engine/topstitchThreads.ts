import * as THREE from 'three/webgpu';
import type { Pattern, Project, Topstitch, Vec2 } from '../model/types';
import type { ClothSimInput } from '../../sim/clothSimulator';
import type { TriangleMesh } from '../../pattern/triangulate/triangulate';
import { topstitchRows } from '../../pattern/panel/productionGeometry';

/** Width of one thread ribbon, in meters. */
const THREAD_WIDTH_M = 0.0008;
/** Lift above the cloth surface so the thread does not z-fight, in meters. */
const THREAD_OFFSET_M = 0.0004;

/** One drawn topstitch segment between two merged cloth particles. */
export interface TopstitchSegment {
  a: number;
  b: number;
  /** Stitch colour shared by both endpoints. */
  color: string;
}

/** Topstitch records of one panel that the overlay draws. */
function visibleTopstitches(pattern: Pattern, panelId: string): Topstitch[] {
  return Object.values(pattern.topstitches ?? {}).filter(
    stitch => stitch.panelId === panelId && stitch.visible !== false,
  );
}

/**
 * Line segments of every visible topstitch, mapped onto merged particle indices. Each sampled
 * row point snaps to its nearest mesh vertex, so the thread rides the cloth instead of floating.
 */
export function topstitchSegments(project: Project, panels: ClothSimInput['panels']): TopstitchSegment[] {
  const pattern = project.pattern;
  const segments: TopstitchSegment[] = [];
  for (const panel of panels) {
    if (pattern.panels[panel.panelId]?.visible === false) continue;
    for (const stitch of visibleTopstitches(pattern, panel.panelId)) {
      for (const row of topstitchRows(pattern, stitch)) {
        let previous = -1;
        for (const point of row) {
          const local = nearestVertex(panel.mesh, point);
          if (local < 0 || local === previous) continue;
          if (previous >= 0) {
            segments.push({ a: panel.vertexOffset + previous, b: panel.vertexOffset + local, color: stitch.color });
          }
          previous = local;
        }
      }
    }
  }
  return segments;
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

/**
 * Ribbon mesh of every stitch segment, drawn above the cloth and exported as `topstitchMesh`.
 * Positions are rewritten every simulation frame.
 */
export class TopstitchThreads {
  private mesh: THREE.Mesh | null = null;
  private segments: TopstitchSegment[] = [];
  /** Reused normal so the per-segment update allocates nothing. */
  private readonly normalScratch = new THREE.Vector3();

  /** Builds one ribbon quad per stitch step and adds it to the scene. */
  attach(
    scene: THREE.Scene, segments: TopstitchSegment[], positions: Float32Array, normals?: Float32Array,
  ): void {
    this.detach(scene);
    if (segments.length === 0) return;
    this.segments = segments;
    this.mesh = new THREE.Mesh(ribbonGeometry(segments), threadMaterial());
    this.mesh.name = 'topstitchMesh';
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.update(positions, normals);
  }

  /** Moves every ribbon quad onto the current particle positions and normals. */
  update(positions: Float32Array, normals?: Float32Array): void {
    if (!this.mesh) return;
    const attr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < this.segments.length; i++) {
      const { a, b } = this.segments[i];
      const o = i * 18;
      const a3 = a * 3, b3 = b * 3;
      if (a3 + 2 >= positions.length || b3 + 2 >= positions.length) {
        arr.fill(0, o, o + 18);
        continue;
      }
      const ax = positions[a3]!, ay = positions[a3 + 1]!, az = positions[a3 + 2]!;
      const bx = positions[b3]!, by = positions[b3 + 1]!, bz = positions[b3 + 2]!;
      const n = this.normalAt(a, b, normals);
      const tx = bx - ax, ty = by - ay, tz = bz - az;
      const tLen = Math.hypot(tx, ty, tz);
      let sx = 0, sy = 0, sz = 0;
      if (tLen > 1e-9) {
        // Side = normal × tangent, scaled to half the thread width.
        sx = (n.y * tz - n.z * ty) / tLen;
        sy = (n.z * tx - n.x * tz) / tLen;
        sz = (n.x * ty - n.y * tx) / tLen;
        const sLen = Math.hypot(sx, sy, sz) || 1;
        const half = THREAD_WIDTH_M / 2 / sLen;
        sx *= half; sy *= half; sz *= half;
      }
      const ox = n.x * THREAD_OFFSET_M, oy = n.y * THREAD_OFFSET_M, oz = n.z * THREAD_OFFSET_M;
      const axo = ax + ox, ayo = ay + oy, azo = az + oz;
      const bxo = bx + ox, byo = by + oy, bzo = bz + oz;
      // Two triangles: a-side / a+side / b+side and a-side / b+side / b-side.
      const quads = [
        axo - sx, ayo - sy, azo - sz,
        axo + sx, ayo + sy, azo + sz,
        bxo + sx, byo + sy, bzo + sz,
        axo - sx, ayo - sy, azo - sz,
        bxo + sx, byo + sy, bzo + sz,
        bxo - sx, byo - sy, bzo - sz,
      ];
      arr.set(quads, o);
    }
    attr.needsUpdate = true;
  }

  /** Surface normal at a segment: the average of both endpoint normals, or up as a fallback. */
  private normalAt(a: number, b: number, normals?: Float32Array): THREE.Vector3 {
    if (normals && a * 3 + 2 < normals.length && b * 3 + 2 < normals.length) {
      const x = normals[a * 3]! + normals[b * 3]!;
      const y = normals[a * 3 + 1]! + normals[b * 3 + 1]!;
      const z = normals[a * 3 + 2]! + normals[b * 3 + 2]!;
      const len = Math.hypot(x, y, z);
      if (len > 1e-9) return this.normalScratch.set(x / len, y / len, z / len);
    }
    return this.normalScratch.set(0, 1, 0);
  }

  /** Shows or hides the overlay together with the cloth mesh beneath it. */
  setVisible(visible: boolean): void {
    if (this.mesh) this.mesh.visible = visible;
  }

  /** Removes the overlay from the scene and frees its buffers. */
  detach(scene: THREE.Scene): void {
    if (!this.mesh) return;
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
    this.segments = [];
  }
}

/** Position, colour and index-free triangle buffers sized for one ribbon per stitch step. */
function ribbonGeometry(segments: TopstitchSegment[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments.length * 18), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segments.length * 18), 3));
  const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
  const arr = colors.array as Float32Array;
  const cache = new Map<string, THREE.Color>();
  segments.forEach((segment, i) => {
    let color = cache.get(segment.color);
    if (!color) {
      color = new THREE.Color(segment.color);
      cache.set(segment.color, color);
    }
    for (let vertex = 0; vertex < 6; vertex++) {
      const o = i * 18 + vertex * 3;
      arr[o] = color.r;
      arr[o + 1] = color.g;
      arr[o + 2] = color.b;
    }
  });
  return geometry;
}

/** Thread material drawn over the cloth surface. */
function threadMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}
