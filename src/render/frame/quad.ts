/** Full-screen quad shared by the post passes. */

import * as THREE from 'three/webgpu';

/** Camera both quad passes draw with; a unit square fills its clip volume exactly. */
const QUAD_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
QUAD_CAMERA.position.z = 1;

/** Geometry of the quad, shared by every pass. */
const QUAD_GEOMETRY = new THREE.PlaneGeometry(2, 2);

/** One reusable mesh whose material each pass swaps in. */
const QUAD_MESH: THREE.Mesh<THREE.PlaneGeometry, THREE.Material> = new THREE.Mesh(
  QUAD_GEOMETRY, new THREE.MeshBasicMaterial(),
);
QUAD_MESH.frustumCulled = false;

/** Scene holding the quad, so the renderer has something to walk. */
const QUAD_SCENE = new THREE.Scene();
QUAD_SCENE.add(QUAD_MESH);

/** Draws a full-screen material into the given target, or the canvas when null. */
export function drawFullScreen(
  renderer: THREE.WebGPURenderer,
  material: THREE.Material,
  target: THREE.RenderTarget | null,
): void {
  QUAD_MESH.material = material;
  renderer.setRenderTarget(target);
  renderer.render(QUAD_SCENE, QUAD_CAMERA);
}
