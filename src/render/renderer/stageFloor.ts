import * as THREE from 'three/webgpu';

/** Stage floor: a light translucent plane, drawn identically from either side. */
const FLOOR_COLOR = 0x7f8b99;

/** Floor alpha, low enough for the environment backdrop to read through. */
const FLOOR_OPACITY = 0.5;

/** Edge length of the stage floor and of its reference grid, in meters. */
const FLOOR_SIZE = 20;

/** Grid cells across the stage floor; one cell per meter. */
const GRID_DIVISIONS = 20;

/** Pale hairline grid tones: center axis, then cell lines. */
const GRID_COLOR_AXIS = 0xf6fafd;
const GRID_COLOR_CELL = 0xe4ebf2;

/** Grid line opacity for hairlines that read against the stage floor. */
const GRID_OPACITY = 0.5;

/** Adds the stage floor and its reference grid, both spanning one square. */
export function addStageFloor(scene: THREE.Scene): void {
  const grid = new THREE.GridHelper(FLOOR_SIZE, GRID_DIVISIONS, GRID_COLOR_AXIS, GRID_COLOR_CELL);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = GRID_OPACITY;
  // Drawn last so the lines stay on top of the floor from either side.
  grid.renderOrder = 1;
  scene.add(grid);

  const groundGeo = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE);
  const groundMat = new THREE.MeshBasicMaterial({
    color: FLOOR_COLOR,
    transparent: true,
    opacity: FLOOR_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.name = 'stageFloor';
  ground.rotation.x = -Math.PI / 2;
  // Sits just under y = 0 so the grid lines never z-fight with it.
  ground.position.y = -0.001;
  ground.userData.pathTracingMaterial = new THREE.MeshStandardMaterial({
    color: FLOOR_COLOR,
    roughness: 0.9,
    transparent: true,
    opacity: FLOOR_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  scene.add(ground);
}
