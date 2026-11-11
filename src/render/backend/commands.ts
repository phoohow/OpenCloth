/** Command recording for one frame: targets, scene draws and full-screen blits. */

import * as THREE from 'three/webgpu';
import type { CameraState, DrawStage } from '@/render/common';
import type { SceneHandle, TargetHandle, TextureHandle } from '@/render/backend/types';

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

/** Resolves the three scene behind a neutral GPU scene handle. */
export type SceneResolver = (handle: SceneHandle, stage: DrawStage) => THREE.Scene;

/** Records the draws of one frame against the GPU renderer. */
export class Commands {
  private sceneResolver: SceneResolver | null = null;
  private readonly perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  private readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

  constructor(private readonly renderer: THREE.WebGPURenderer) { }

  /** Installs the resolver once the scene store exists. */
  bindScene(resolver: SceneResolver): void {
    this.sceneResolver = resolver;
  }

  /** Binds a target; `clear` maps to the renderer's auto-clear for the next draw. */
  setTarget(target: TargetHandle | null, clear = true): void {
    this.renderer.setRenderTarget(target);
    this.renderer.autoClear = clear;
  }

  /** Draws one stage of a scene root with the camera of the view. */
  drawScene(scene: SceneHandle, stage: DrawStage, camera: CameraState): void {
    const root = this.sceneResolver?.(scene, stage);
    if (!root) return;
    this.renderer.render(root, this.camera(camera));
  }

  /** Three camera matching a neutral camera state; also used by the trace probe. */
  cameraFor(state: CameraState): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.camera(state);
  }

  /** Draws a full-screen material into the bound target. */
  drawMaterial(material: THREE.Material): void {
    QUAD_MESH.material = material;
    this.renderer.render(QUAD_SCENE, QUAD_CAMERA);
  }

  /** Copies one texture into a target; the renderer requires the canvas target unbound. */
  copy(source: TextureHandle, target: TargetHandle): void {
    this.renderer.setRenderTarget(null);
    this.renderer.copyTextureToTexture(source, target.texture);
  }

  /** Reads an 8-bit target back as RGBA bytes; the target must not be bound any more. */
  async readTarget(target: TargetHandle, width: number, height: number): Promise<Uint8Array> {
    const pixels = await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
    return pixels as Uint8Array;
  }

  /** Leaves no target bound; called at the end of every frame. */
  restore(): void {
    this.renderer.setRenderTarget(null);
    this.renderer.autoClear = true;
  }

  /** Three camera matching a neutral camera state. */
  private camera(data: CameraState): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    const position = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
    const target = new THREE.Vector3(data.target.x, data.target.y, data.target.z);
    const up = new THREE.Vector3(data.up.x, data.up.y, data.up.z);
    if (data.projection === 'orthographic') {
      const camera = this.orthographic;
      const height = Math.max(0.001, data.viewHeightMeters);
      const width = height * Math.max(0.001, data.aspect);
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.position.copy(position);
      camera.up.copy(up);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      return camera;
    }
    const camera = this.perspective;
    camera.fov = data.fovDeg;
    camera.aspect = Math.max(0.001, data.aspect);
    camera.position.copy(position);
    camera.up.copy(up);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return camera;
  }
}
