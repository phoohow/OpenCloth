import { describe, expect, it } from 'vitest';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Camera, Group, Object3D, Vector3, WebGPURenderer } from 'three/webgpu';
import type { CameraPreset } from '../../../src/core/engine/cameraFit';
import { CAMERA_VIEW_FRAMES } from '../../../src/core/engine/cameraFit';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const THREE = await import('three/webgpu');
const { ClothPicker } = await import('../../../src/core/engine/clothPicker');
const { setCameraProjection } = await import('../../../src/render/renderer/rendererContext');
type RendererContext = import('../../../src/render/renderer/rendererContext').RendererContext;

/** A canvas stub sized like a viewport, with the listeners OrbitControls attaches ignored. */
function fakeCanvas(width: number, height: number) {
  const noop = () => {};
  const ownerDocument = { addEventListener: noop, removeEventListener: noop };
  return {
    clientWidth: width, clientHeight: height, ownerDocument,
    style: { touchAction: '' },
    addEventListener: noop, removeEventListener: noop,
    getRootNode: () => ownerDocument,
    setPointerCapture: noop, releasePointerCapture: noop,
    hasPointerCapture: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
  } as unknown as HTMLCanvasElement;
}

/** A body-sized box standing on the floor. */
function bodyGroup(): Group {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.4));
  mesh.position.set(0, 0.9, 0);
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

/** Viewport, picker and orbit controls over a scene holding one body. */
function stubScene(width = 800, height = 600) {
  const canvas = fakeCanvas(width, height);
  const perspectiveCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  perspectiveCamera.position.set(0, 1.4, 3.2);
  const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  const controls = new OrbitControls<Camera>(perspectiveCamera, canvas);
  controls.enableDamping = false;
  controls.target.set(0, 0.9, 0);
  const ctx = {
    renderer: { setSize: () => {} } as unknown as WebGPURenderer,
    scene: new THREE.Scene(), camera: perspectiveCamera, perspectiveCamera, orthographicCamera,
    projection: 'perspective', orthoViewHeight: 1, controls, canvas,
  } as unknown as RendererContext;
  const body = bodyGroup();
  const picker = new ClothPicker(ctx, {
    mesh: () => null,
    trianglePanelIds: () => [],
    triangleParticles: () => null,
    particlePositions: () => null,
    panelIds: () => [],
    pickNearestParticle: () => null,
    pickParticleAtPoint: () => null,
    frameObjects: () => [body],
  });
  return { ctx, picker, body };
}

/** Every corner of the scene box, in clip space for the active camera. */
function clippedCorners(ctx: RendererContext, body: Object3D): Vector3[] {
  body.updateWorldMatrix(false, true);
  const box = new THREE.Box3().setFromObject(body);
  ctx.camera.updateMatrixWorld();
  const matrix = new THREE.Matrix4().multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
  const min = box.min;
  const max = box.max;
  return [
    new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(min.x, max.y, min.z), new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z), new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, max.z), new THREE.Vector3(max.x, max.y, max.z),
  ].map(corner => corner.applyMatrix4(matrix));
}

/** Whether the whole box lands inside the viewport, which is what "看不全" complains about. */
function fullyInFrame(ctx: RendererContext, body: Object3D): boolean {
  return clippedCorners(ctx, body).every(p => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z <= 1 && p.z >= -1);
}

describe('ClothPicker.sceneBounds', () => {
  it('counts the body it is framing', () => {
    const { picker } = stubScene();
    const box = picker.sceneBounds();
    expect(box.getCenter(new THREE.Vector3()).y).toBeCloseTo(0.9);
    expect(picker.focusTarget().y).toBeCloseTo(0.9);
  });

  it('drops a hidden reference model from the box', () => {
    const reference = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 1));
    reference.position.set(5, 0.5, 0);
    const canvas = fakeCanvas(800, 600);
    const perspectiveCamera = new THREE.PerspectiveCamera(45, 1.33, 0.1, 100);
    const ctx = {
      renderer: { setSize: () => {} } as unknown as WebGPURenderer,
      scene: new THREE.Scene(), camera: perspectiveCamera, perspectiveCamera,
      orthographicCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100),
      projection: 'perspective', orthoViewHeight: 1,
      controls: new OrbitControls<Camera>(perspectiveCamera, canvas), canvas,
    } as unknown as RendererContext;
    const picker = new ClothPicker(ctx, {
      mesh: () => null,
      trianglePanelIds: () => [],
      triangleParticles: () => null,
      particlePositions: () => null,
      panelIds: () => [],
      pickNearestParticle: () => null,
      pickParticleAtPoint: () => null,
      frameObjects: () => [bodyGroup(), reference],
    });
    const withReference = picker.sceneBounds().getSize(new THREE.Vector3()).x;
    reference.visible = false;
    expect(picker.sceneBounds().getSize(new THREE.Vector3()).x).toBeLessThan(withReference);
  });
});

describe('ClothPicker.applyPreset', () => {
  const presets = Object.keys(CAMERA_VIEW_FRAMES) as CameraPreset[];

  it.each(presets)('frames the whole scene in the %s view', preset => {
    const { ctx, picker, body } = stubScene();
    picker.applyPreset(preset);
    expect(fullyInFrame(ctx, body), preset).toBe(true);
  });

  it('frames a portrait viewport that a fixed radius clipped', () => {
    const { ctx, picker, body } = stubScene(400, 900);
    picker.applyPreset('front');
    expect(fullyInFrame(ctx, body)).toBe(true);
  });

  it('puts the camera on the side the preset names', () => {
    const { ctx, picker } = stubScene();
    picker.applyPreset('left');
    expect(ctx.camera.position.x).toBeLessThan(0);
    expect(ctx.camera.position.z).toBeCloseTo(0, 1);
    picker.applyPreset('bottom');
    expect(ctx.camera.position.y).toBeLessThan(picker.focusTarget().y);
  });

  it('rolls the top and bottom views onto their own up vector', () => {
    const { ctx, picker } = stubScene();
    picker.applyPreset('top');
    expect(ctx.camera.up.z).toBeCloseTo(-1);
    picker.applyPreset('bottom');
    expect(ctx.camera.up.z).toBeCloseTo(1);
  });

  it('pulls further back for a bigger garment', () => {
    const small = stubScene();
    small.picker.applyPreset('front');
    const smallDistance = small.ctx.camera.position.length();
    const large = stubScene();
    large.body.scale.set(2, 2, 2);
    large.body.updateMatrixWorld(true);
    large.picker.applyPreset('front');
    expect(large.ctx.camera.position.length()).toBeGreaterThan(smallDistance);
  });
});

describe('ClothPicker.frameScene', () => {
  it('keeps the orbit direction and only changes the distance', () => {
    const { ctx, picker } = stubScene();
    picker.applyPreset('frontRight');
    const before = ctx.camera.position.clone().sub(ctx.controls.target).normalize();
    // Pull the camera back along the same ray, the way a wheel zoom would.
    ctx.camera.position.copy(ctx.controls.target).add(before.clone().multiplyScalar(12));
    picker.frameScene();
    const after = ctx.camera.position.clone().sub(ctx.controls.target).normalize();
    expect(after.distanceTo(before)).toBeCloseTo(0);
    expect(ctx.camera.position.distanceTo(ctx.controls.target)).toBeLessThan(12);
  });

  it('refits the orthographic frame when the projection swaps', () => {
    const { ctx, picker, body } = stubScene();
    picker.applyPreset('front');
    setCameraProjection(ctx, 'orthographic');
    picker.frameScene();
    expect(ctx.orthographicCamera.zoom).toBe(1);
    expect(fullyInFrame(ctx, body)).toBe(true);
  });
});
