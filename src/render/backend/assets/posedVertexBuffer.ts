import * as THREE from 'three/webgpu';

export class PosedVertexBuffer {
  readonly positions: Float32Array;
  readonly base: Float32Array;
  private readonly attribute: THREE.BufferAttribute;
  private readonly geometries: readonly THREE.BufferGeometry[];

  constructor(root: THREE.Object3D, source: Float32Array) {
    this.base = Float32Array.from(source);
    this.positions = Float32Array.from(source);
    this.attribute = new THREE.BufferAttribute(this.positions, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    const geometries = new Set<THREE.BufferGeometry>();
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      const geometry = mesh.geometry;
      const attribute = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!geometry || !attribute || attribute.array !== source) return;
      geometry.setAttribute('position', this.attribute);
      geometries.add(geometry);
    });
    this.geometries = [...geometries];
  }

  refresh(): void {
    this.attribute.needsUpdate = true;
    for (const geometry of this.geometries) {
      geometry.computeVertexNormals();
      geometry.boundingBox = null;
      geometry.boundingSphere = null;
    }
  }
}
