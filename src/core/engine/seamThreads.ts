import * as THREE from 'three/webgpu';
import type { Seam } from '../model/types';
import type { SeamPair } from '../build/seamPair';

/** Thread overlay drawn between paired seam edges; it dims as a seam closes. */
export class SeamThreads {
  private lines: THREE.LineSegments | null = null;
  private seams: Record<string, Seam> = {};
  /** Thread color of each seam, in the renderer's working color space. */
  private colors = new Map<string, THREE.Color>();

  /** Builds one line segment per seam pair and adds it to the scene. */
  attach(scene: THREE.Scene, pairs: SeamPair[], positions: Float32Array, seams: Record<string, Seam>): void {
    this.detach(scene);
    if (pairs.length === 0) return;
    const material = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.lines = new THREE.LineSegments(threadGeometry(pairs.length), material);
    this.lines.renderOrder = 3;
    this.lines.name = 'seamThreads';
    scene.add(this.lines);
    this.setSeams(seams);
    this.update(pairs, positions);
  }

  /** Sets the seam records whose thread color and visibility the overlay draws. */
  setSeams(seams: Record<string, Seam>): void {
    this.seams = seams;
    this.colors = new Map(
      Object.values(seams).map(seam => [seam.id, new THREE.Color(seam.threadColor)]),
    );
  }

  /** Moves the threads to the given positions and dims each one as its seam closes. */
  update(pairs: SeamPair[], positions: Float32Array): void {
    if (!this.lines) return;
    // The pair set changes when a dart closes, so the buffers are rebuilt rather than overrun.
    if (this.lines.geometry.getAttribute('position').count !== pairs.length * 2) {
      this.lines.geometry.dispose();
      this.lines.geometry = threadGeometry(pairs.length);
    }
    const pos = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.lines.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const carr = col.array as Float32Array;
    for (let i = 0; i < pairs.length; i++) {
      const { p0, p1, open, seamId } = pairs[i];
      const o = i * 6;
      arr[o] = positions[p0 * 3]; arr[o + 1] = positions[p0 * 3 + 1]; arr[o + 2] = positions[p0 * 3 + 2];
      arr[o + 3] = positions[p1 * 3]; arr[o + 4] = positions[p1 * 3 + 1]; arr[o + 5] = positions[p1 * 3 + 2];
      const shown = this.seams[seamId]?.stitchVisible !== false;
      const level = shown ? fadeLevel(distance(positions, p0, p1), open) : 0;
      const color = this.colors.get(seamId) ?? THREAD_FALLBACK;
      for (let vertex = 0; vertex < 2; vertex++) {
        carr[o + vertex * 3] = color.r * level;
        carr[o + vertex * 3 + 1] = color.g * level;
        carr[o + vertex * 3 + 2] = color.b * level;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /** Removes the overlay from the scene and frees its buffers. */
  detach(scene: THREE.Scene): void {
    if (!this.lines) return;
    scene.remove(this.lines);
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.lines = null;
  }
}

/** Position and color buffers sized for one segment per seam pair. */
function threadGeometry(pairCount: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pairCount * 6), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pairCount * 6), 3));
  return geometry;
}

/** Thread color used when a pair's seam record is gone. */
const THREAD_FALLBACK = new THREE.Color('#5cd9ff');

/** Bright while open, fading to black (invisible under additive blending) near closure. */
function fadeLevel(gap: number, open: number): number {
  return Math.min(1, gap / Math.max(open * 0.3, 0.01));
}

/** Gap between two merged particles. */
function distance(positions: Float32Array, a: number, b: number): number {
  return Math.hypot(
    positions[a * 3] - positions[b * 3],
    positions[a * 3 + 1] - positions[b * 3 + 1],
    positions[a * 3 + 2] - positions[b * 3 + 2],
  );
}
