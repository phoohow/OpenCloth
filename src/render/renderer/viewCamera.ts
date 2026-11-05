import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraProjection } from '../../core/model/types';
import type { ViewportSurface } from './viewportSurface';

/** Either camera the viewport can render with. */
export type ViewportCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/** Whether the viewport is currently looking through the orthographic camera. */
export function isOrthographic(camera: ViewportCamera): camera is THREE.OrthographicCamera {
  return (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
}

/** Half-depth of the orthographic clip range in meters; linear depth keeps this generous. */
const ORTHO_CLIP_RANGE = 100;

/** Distance multiplier of one zoom step; the same curve OrbitControls uses for its own zoom. */
const ZOOM_FACTOR = 0.95;

/** The two cameras, the active projection and the orbit gestures of one viewport. */
export class ViewCamera {
  readonly perspectiveCamera: THREE.PerspectiveCamera;
  readonly orthographicCamera: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  projection: CameraProjection = 'perspective';
  /** World height the orthographic frustum spans while `orthographicCamera.zoom` is 1. */
  orthoViewHeight = 1;
  private active: ViewportCamera;
  /** Removes the listeners that drive the camera dolly. */
  private detachZoom?: () => void;

  constructor(private readonly surface: ViewportSurface) {
    const aspect = surface.aspect();
    const perspective = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    perspective.position.set(0, 1.4, 3.2);

    const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -ORTHO_CLIP_RANGE, ORTHO_CLIP_RANGE);
    orthographic.position.copy(perspective.position);
    orthographic.up.copy(perspective.up);
    orthographic.lookAt(0, 0.9, 0);

    const controls = new OrbitControls<THREE.Camera>(perspective, surface.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    // One finger turns, two fingers dolly and truck; stated so a phone keeps those gestures
    // even if a later three release changes the library defaults.
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.target.set(0, 0.9, 0);
    controls.update();

    this.perspectiveCamera = perspective;
    this.orthographicCamera = orthographic;
    this.controls = controls;
    this.active = perspective;
    this.detachZoom = attachZoomGestures(controls, surface.canvas);
    this.syncFrustum();
  }

  /** Camera the viewport renders, picks and frames with right now. */
  get camera(): ViewportCamera {
    return this.active;
  }

  /** Rebuilds the orthographic frustum from the stored view height and the given aspect. */
  syncFrustum(aspect = this.surface.aspect()): void {
    const camera = this.orthographicCamera;
    const height = Math.max(0.001, this.orthoViewHeight);
    const width = height * aspect;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
  }

  /**
   * Swaps the viewport between perspective and orthographic cameras.
   * Both share position, orientation and orbit target; framing stays where it was.
   */
  setProjection(projection: CameraProjection): void {
    if (this.projection === projection) return;
    const from = this.active;
    const to = projection === 'perspective' ? this.perspectiveCamera : this.orthographicCamera;
    to.position.copy(from.position);
    to.up.copy(from.up);
    to.quaternion.copy(from.quaternion);
    this.active = to;
    this.projection = projection;
    this.controls.object = to;
    this.syncFrustum();
    this.controls.update();
  }

  /** Matches both cameras to a new viewport aspect. */
  resize(aspect: number): void {
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    this.syncFrustum(aspect);
  }

  dispose(): void {
    this.detachZoom?.();
    this.controls.dispose();
  }
}

/**
 * Dollies the camera on the wheel and on a middle-button drag: scrolling or dragging down moves
 * closer, up pulls away. OrbitControls maps both gestures the other way and exposes no switch,
 * so its wheel zoom is replaced by a capture-phase listener and its middle-button dolly by a
 * drag handler of our own.
 * Returns the detach function.
 */
function attachZoomGestures(controls: OrbitControls, canvas: HTMLCanvasElement): () => void {
  const dolly = (pixels: number) => {
    if (pixels === 0) return;
    const factor = Math.pow(ZOOM_FACTOR, Math.abs(pixels) * 0.01 * controls.zoomSpeed);
    if (pixels > 0) controls.dollyIn(factor);
    else controls.dollyOut(factor);
  };

  const onWheel = (event: WheelEvent) => {
    if (event.target !== canvas || !controls.enabled || !controls.enableZoom) return;
    event.preventDefault();
    event.stopPropagation();
    // Normalise line and page deltas to pixels before deriving the step.
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
    dolly(delta);
  };

  controls.mouseButtons.MIDDLE = null;
  let dragPointer: number | null = null;
  let dragY = 0;
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 1 || !controls.enabled || !controls.enableZoom) return;
    event.preventDefault();
    dragPointer = event.pointerId;
    dragY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== dragPointer) return;
    dolly(event.clientY - dragY);
    dragY = event.clientY;
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId === dragPointer) dragPointer = null;
  };

  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);

  return () => {
    window.removeEventListener('wheel', onWheel, { capture: true });
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerEnd);
    canvas.removeEventListener('pointercancel', onPointerEnd);
  };
}
