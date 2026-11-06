import * as THREE from 'three/webgpu';
import type { SceneMgr } from '@/render/scene/manager';
import type { TraceProxySink } from '@/render/scene/tracePort';

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

/** World width of a grid line in the ray-traced stand-in, in meters. */
const GRID_PROXY_WIDTH = 0.0012;

/**
 * Adds the stage floor and its reference grid.
 *
 * The grid is a `LineSegments` so the raster passes keep a crisp one-pixel hairline, and a mesh of
 * thin quads alongside it so the path tracer has a surface to hit. Only one of the two is visible
 * at a time; the tracer swaps them through the proxy sink.
 */
export function buildStageFloor(sceneMgr: SceneMgr, proxies?: TraceProxySink): void {
  const slot = sceneMgr.slot('floorGrid');
  const grid = new THREE.GridHelper(FLOOR_SIZE, GRID_DIVISIONS, GRID_COLOR_AXIS, GRID_COLOR_CELL);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = GRID_OPACITY;
  // Drawn last so the lines stay on top of the floor from either side.
  grid.renderOrder = 1;
  slot.add(grid);

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
  sceneMgr.slot('floor').add(ground);

  if (!proxies) return;
  proxies.registerMaterial(ground, new THREE.MeshStandardMaterial({
    color: FLOOR_COLOR,
    roughness: 0.9,
    transparent: true,
    opacity: FLOOR_OPACITY,
    side: THREE.DoubleSide,
  }));
  const proxy = gridQuadProxy();
  slot.add(proxy);
  proxy.visible = false;
  proxies.registerGeometry(grid, proxy);
}

/** Mesh of thin quads tracing every grid line, the surface the path tracer intersects. */
function gridQuadProxy(): THREE.Mesh {
  const half = FLOOR_SIZE / 2;
  const step = FLOOR_SIZE / GRID_DIVISIONS;
  const halfWidth = GRID_PROXY_WIDTH / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const axis = new THREE.Color(GRID_COLOR_AXIS);
  const cell = new THREE.Color(GRID_COLOR_CELL);

  const quad = (ax: number, az: number, bx: number, bz: number, color: THREE.Color) => {
    const base = positions.length / 3;
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz) || 1;
    const nx = (-dz / length) * halfWidth;
    const nz = (dx / length) * halfWidth;
    positions.push(
      ax + nx, 0, az + nz,
      bx + nx, 0, bz + nz,
      bx - nx, 0, bz - nz,
      ax - nx, 0, az - nz,
    );
    for (let i = 0; i < 4; i++) {
      normals.push(0, 1, 0);
      colors.push(color.r, color.g, color.b);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let i = 0; i <= GRID_DIVISIONS; i++) {
    const offset = -half + i * step;
    const color = i === GRID_DIVISIONS / 2 ? axis : cell;
    quad(offset, -half, offset, half, color);
    quad(-half, offset, half, offset, color);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: GRID_OPACITY,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'stageGridProxy';
  return mesh;
}
