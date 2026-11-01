import * as THREE from 'three/webgpu';
import type { Pattern, Project, Topstitch, Vec2 } from '../model/types';
import type { ClothSimInput } from '../../sim/clothSimulator';
import type { TriangleMesh } from '../../pattern/triangulate/triangulate';
import { topstitchRows } from '../../pattern/panel/productionGeometry';

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

/** Topstitch overlay drawn above the cloth; positions are rewritten every simulation frame. */
export class TopstitchThreads {
  private lines: THREE.LineSegments | null = null;
  private segments: TopstitchSegment[] = [];

  /** Builds one line segment per stitch step and adds it to the scene. */
  attach(scene: THREE.Scene, segments: TopstitchSegment[], positions: Float32Array): void {
    this.detach(scene);
    if (segments.length === 0) return;
    this.segments = segments;
    this.lines = new THREE.LineSegments(threadGeometry(segments), stitchMaterial());
    this.lines.renderOrder = 4;
    this.lines.name = 'topstitchThreads';
    scene.add(this.lines);
    this.update(positions);
  }

  /** Moves every segment onto the current particle positions. */
  update(positions: Float32Array): void {
    if (!this.lines) return;
    const attr = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < this.segments.length; i++) {
      const { a, b } = this.segments[i];
      const o = i * 6;
      const a3 = a * 3, b3 = b * 3;
      // A rebuilt layout can briefly size the positions past the segments; those stay at zero.
      if (a3 + 2 < positions.length && b3 + 2 < positions.length) {
        arr[o] = positions[a3]; arr[o + 1] = positions[a3 + 1]; arr[o + 2] = positions[a3 + 2];
        arr[o + 3] = positions[b3]; arr[o + 4] = positions[b3 + 1]; arr[o + 5] = positions[b3 + 2];
      } else {
        arr[o] = 0; arr[o + 1] = 0; arr[o + 2] = 0;
        arr[o + 3] = 0; arr[o + 4] = 0; arr[o + 5] = 0;
      }
    }
    attr.needsUpdate = true;
  }

  /** Shows or hides the overlay together with the cloth mesh beneath it. */
  setVisible(visible: boolean): void {
    if (this.lines) this.lines.visible = visible;
  }

  /** Removes the overlay from the scene and frees its buffers. */
  detach(scene: THREE.Scene): void {
    if (!this.lines) return;
    scene.remove(this.lines);
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.lines = null;
    this.segments = [];
  }
}

/** Position and colour buffers sized for one segment per stitch step. */
function threadGeometry(segments: TopstitchSegment[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments.length * 6), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segments.length * 6), 3));
  const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
  const arr = colors.array as Float32Array;
  const cache = new Map<string, THREE.Color>();
  segments.forEach((segment, i) => {
    let color = cache.get(segment.color);
    if (!color) {
      color = new THREE.Color(segment.color);
      cache.set(segment.color, color);
    }
    for (let vertex = 0; vertex < 2; vertex++) {
      const o = i * 6 + vertex * 3;
      arr[o] = color.r;
      arr[o + 1] = color.g;
      arr[o + 2] = color.b;
    }
  });
  return geometry;
}

/** Thread material drawn over the cloth surface. */
function stitchMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
}
