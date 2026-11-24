import type { SceneHandle, TargetHandle, TextureHandle } from '@/render/backend/types';
import type { CameraState, DrawStage } from '@/render/common';

import * as THREE from 'three/webgpu';

const QUAD_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);

const QUAD_GEOMETRY = new THREE.PlaneGeometry(2, 2);

const QUAD_MESH: THREE.Mesh<THREE.PlaneGeometry, THREE.Material> = new THREE.Mesh(
  QUAD_GEOMETRY, new THREE.MeshBasicMaterial(),
);

const QUAD_SCENE = new THREE.Scene();

export type SceneResolver = (handle: SceneHandle, stage: DrawStage) => THREE.Scene;

export class Commands {
  private sceneResolver: SceneResolver | null = null;
  private readonly perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  private readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

  constructor(private readonly renderer: THREE.WebGPURenderer) {}

  bindScene(resolver: SceneResolver): void {
    this.sceneResolver = resolver;
  }

  setTarget(target: TargetHandle | null, clear = true): void {
    this.renderer.setRenderTarget(target);
    this.renderer.autoClear = clear;
  }

  drawScene(scene: SceneHandle, stage: DrawStage, camera: CameraState): void {
    const root = this.sceneResolver?.(scene, stage);
    if (!root) return;
    this.renderer.render(root, this.camera(camera));
  }

  cameraFor(state: CameraState): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.camera(state);
  }

  drawMaterial(material: THREE.Material): void {
    QUAD_MESH.material = material;
    this.renderer.render(QUAD_SCENE, QUAD_CAMERA);
  }

  copy(source: TextureHandle, target: TargetHandle): void {
    this.renderer.setRenderTarget(null);
    this.renderer.copyTextureToTexture(source, target.texture);
  }

  async readTarget(target: TargetHandle, width: number, height: number): Promise<Uint8Array> {
    const pixels = await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
    return pixels as Uint8Array;
  }

  restore(): void {
    this.renderer.setRenderTarget(null);
    this.renderer.autoClear = true;
  }

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

QUAD_CAMERA.position.z = 1;

QUAD_MESH.frustumCulled = false;

QUAD_SCENE.add(QUAD_MESH);
