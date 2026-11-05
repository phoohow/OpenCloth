import * as THREE from 'three/webgpu';

/** Radius of the marker spheres placed on measured points, in meters. */
const MARKER_RADIUS = 0.006;

/** Temporary two-point measurement: a segment with one marker per placed surface point. */
export class MeasureOverlay {
  private group: THREE.Group | null = null;
  private line: THREE.Line | null = null;
  private markers: THREE.Mesh[] = [];

  /** Draws the placed points; the segment only shows once there are two. */
  setPoints(scene: THREE.Scene, points: THREE.Vector3[]): void {
    if (points.length === 0) {
      this.clear(scene);
      return;
    }
    this.ensure(scene);
    const line = this.line!;
    const attribute = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const first = points[0]!;
    const second = points[1] ?? first;
    attribute.setXYZ(0, first.x, first.y, first.z);
    attribute.setXYZ(1, second.x, second.y, second.z);
    attribute.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    line.visible = points.length >= 2;

    this.markers.forEach((marker, i) => {
      const point = points[i];
      marker.visible = !!point;
      if (point) marker.position.copy(point);
    });
  }

  /** Removes the measurement from the scene and frees its buffers. */
  clear(scene: THREE.Scene): void {
    if (!this.group) return;
    scene.remove(this.group);
    this.line?.geometry.dispose();
    for (const marker of this.markers) {
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    (this.line?.material as THREE.Material | undefined)?.dispose();
    this.group = null;
    this.line = null;
    this.markers = [];
  }

  private ensure(scene: THREE.Scene): void {
    if (this.group) return;
    const group = new THREE.Group();
    group.name = 'measure3d';
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(new Float32Array(6), 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#ffd166', depthTest: false }));
    line.renderOrder = 4;
    line.frustumCulled = false;
    group.add(line);

    const markerGeometry = new THREE.SphereGeometry(MARKER_RADIUS, 12, 8);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: '#ffd166', depthTest: false });
    for (let i = 0; i < 2; i++) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.renderOrder = 4;
      group.add(marker);
      this.markers.push(marker);
    }
    this.line = line;
    this.group = group;
    scene.add(group);
  }
}
