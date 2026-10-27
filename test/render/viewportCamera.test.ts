import { describe, expect, it } from 'vitest';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Camera, Vector3, WebGPURenderer } from 'three/webgpu';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const THREE = await import('three/webgpu');
const { setCameraProjection, syncOrthoFrustum, resizeRenderer, isOrthographic } =
  await import('../../src/render/renderer/rendererContext');
type RendererContext = import('../../src/render/renderer/rendererContext').RendererContext;

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

/** A context carrying both cameras and live orbit controls, without a GPU backend. */
function stubCtx(width = 800, height = 600): RendererContext {
  const canvas = fakeCanvas(width, height);
  const perspectiveCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  perspectiveCamera.position.set(0, 1.4, 3.2);
  const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  orthographicCamera.position.copy(perspectiveCamera.position);
  const controls = new OrbitControls<Camera>(perspectiveCamera, canvas);
  controls.enableDamping = false;
  controls.target.set(0, 0.9, 0);
  controls.update();
  return {
    renderer: { setSize: () => {} } as unknown as WebGPURenderer,
    scene: new THREE.Scene(), camera: perspectiveCamera, perspectiveCamera, orthographicCamera,
    projection: 'perspective', orthoViewHeight: 2, controls, canvas,
  } as unknown as RendererContext;
}

/** Where the camera ends up looking, as a unit direction. */
function viewAxis(camera: Camera): Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
}

describe('setCameraProjection', () => {
  it('activates the matching camera and hands it to the orbit controls', () => {
    const ctx = stubCtx();
    setCameraProjection(ctx, 'orthographic');
    expect(ctx.projection).toBe('orthographic');
    expect(ctx.camera).toBe(ctx.orthographicCamera);
    expect(ctx.controls.object).toBe(ctx.orthographicCamera);
    expect(isOrthographic(ctx.camera)).toBe(true);
  });

  it('keeps the viewpoint and the direction it looks in', () => {
    const ctx = stubCtx();
    const before = ctx.camera.position.clone();
    const axis = viewAxis(ctx.camera);
    setCameraProjection(ctx, 'orthographic');
    expect(ctx.camera.position.distanceTo(before)).toBeCloseTo(0);
    expect(viewAxis(ctx.camera).distanceTo(axis)).toBeCloseTo(0);
  });

  it('returns to the perspective camera with its field of view intact', () => {
    const ctx = stubCtx();
    ctx.perspectiveCamera.fov = 60;
    setCameraProjection(ctx, 'orthographic');
    setCameraProjection(ctx, 'perspective');
    expect(ctx.camera).toBe(ctx.perspectiveCamera);
    expect(ctx.perspectiveCamera.fov).toBe(60);
    expect(ctx.controls.object).toBe(ctx.perspectiveCamera);
  });

  it('ignores a request for the projection already in use', () => {
    const ctx = stubCtx();
    setCameraProjection(ctx, 'perspective');
    expect(ctx.camera).toBe(ctx.perspectiveCamera);
    expect(ctx.projection).toBe('perspective');
  });

  it('drives the orbit controls from the new camera after a swap', () => {
    const ctx = stubCtx();
    setCameraProjection(ctx, 'orthographic');
    ctx.orthographicCamera.position.set(0, 0.9, 3);
    ctx.controls.update();
    // The controls re-aim the active camera at their target, not the abandoned one.
    expect(viewAxis(ctx.orthographicCamera).distanceTo(new THREE.Vector3(0, 0, -1))).toBeCloseTo(0);
    expect(ctx.perspectiveCamera.position.z).not.toBe(3);
  });
});

describe('syncOrthoFrustum', () => {
  it('spans the stored view height and widens it by the aspect', () => {
    const ctx = stubCtx(800, 600);
    syncOrthoFrustum(ctx, 800 / 600);
    expect(ctx.orthographicCamera.top).toBeCloseTo(1);
    expect(ctx.orthographicCamera.bottom).toBeCloseTo(-1);
    expect(ctx.orthographicCamera.right / ctx.orthographicCamera.top).toBeCloseTo(800 / 600);
  });

  it('scales the frame with the view height set from the properties panel', () => {
    const ctx = stubCtx();
    ctx.orthoViewHeight = 5;
    syncOrthoFrustum(ctx, 1);
    expect(ctx.orthographicCamera.top).toBeCloseTo(2.5);
  });
});

describe('resizeRenderer', () => {
  it('refits both cameras to a new viewport size', () => {
    const ctx = stubCtx();
    resizeRenderer(ctx, 1600, 400);
    expect(ctx.perspectiveCamera.aspect).toBeCloseTo(4);
    expect(ctx.orthographicCamera.right / ctx.orthographicCamera.top).toBeCloseTo(4);
  });

  it('keeps the last drawing buffer while the pane is hidden', () => {
    const ctx = stubCtx();
    resizeRenderer(ctx, 0, 0);
    expect(ctx.perspectiveCamera.aspect).toBeCloseTo(800 / 600);
  });
});
