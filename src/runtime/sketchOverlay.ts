import * as THREE from 'three/webgpu';
import type { SceneSlot } from '@/render';

/** Most samples one stroke draws; extra samples past this are ignored. */
const MAX_STROKE_POINTS = 2048;

/** Temporary polyline that follows a 3D sketch stroke while the pointer draws it. */
export class SketchOverlay {
  private line: THREE.Line | null = null;
  private pointCount = 0;

  /** Attaches a fresh stroke starting at a world point. */
  begin(scene: SceneSlot, point: THREE.Vector3): void {
    this.detach(scene);
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(new Float32Array(MAX_STROKE_POINTS * 3), 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color: '#ffd166', depthTest: false, transparent: true });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 4;
    line.frustumCulled = false;
    line.name = 'sketchStroke';
    this.line = line;
    this.pointCount = 0;
    scene.add(line);
    this.extend(point);
  }

  /** Appends one world point to the stroke. */
  extend(point: THREE.Vector3): void {
    const line = this.line;
    if (!line || this.pointCount >= MAX_STROKE_POINTS) return;
    const attribute = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const offset = this.pointCount * 3;
    (attribute.array as Float32Array)[offset] = point.x;
    (attribute.array as Float32Array)[offset + 1] = point.y;
    (attribute.array as Float32Array)[offset + 2] = point.z;
    attribute.needsUpdate = true;
    this.pointCount++;
    line.geometry.setDrawRange(0, this.pointCount);
  }

  /** Removes the stroke from the scene and frees its buffers. */
  detach(scene: SceneSlot): void {
    if (!this.line) return;
    scene.remove(this.line);
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
    this.line = null;
    this.pointCount = 0;
  }
}
