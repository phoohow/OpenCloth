/** Orbit camera of one viewport: projection, pointer gestures and neutral camera data. */

import type { Vec3 } from '@/base/math';
import { add3, cross3, normalize3, scale3, sub3 } from '@/base/math';
import { clamp } from '@/base/math';
import type {
  Bounds, CameraHost, CameraPose, CameraProjection, CameraState, Ray,
} from '@/render/common';

/** Distance multiplier of one zoom step. */
const ZOOM_FACTOR = 0.95;
/** Pitch limit, just short of the poles. */
const PITCH_LIMIT = Math.PI / 2 - 0.01;
/** Extra room left around a framed box. */
const FIT_MARGIN = 1.15;

interface Orbit {
  yaw: number;
  pitch: number;
  distance: number;
  target: Vec3;
}

/** Camera data and orbit input of one viewport, without three. */
export class CameraController implements CameraHost {
  private positionValue: Vec3 = { x: 0, y: 1.4, z: 3.2 };
  private targetValue: Vec3 = { x: 0, y: 0.9, z: 0 };
  private upValue: Vec3 = { x: 0, y: 1, z: 0 };
  private projectionValue: CameraProjection;
  private fov = 45;
  private viewHeight = 1;
  private aspectValue: number;
  private readonly listeners = new Set<() => void>();
  private readonly detach: () => void;
  private drag: { pointer: number; button: number; x: number; y: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    aspect: number,
    projection: CameraProjection = 'perspective',
  ) {
    this.projectionValue = projection;
    this.aspectValue = aspect;
    this.orbit = this.computeOrbit();
    this.detach = this.attachGestures();
  }

  private orbit: Orbit;

  update(): void {
    // Input is applied immediately; the hook exists for callers that advance one frame.
  }

  snapshot(aspect = this.aspectValue): CameraState {
    return {
      projection: this.projectionValue,
      position: this.positionValue,
      target: this.targetValue,
      up: this.upValue,
      fovDeg: this.fov,
      viewHeightMeters: this.viewHeight,
      aspect,
      near: 0.1,
      far: 100,
    };
  }

  projection(): CameraProjection {
    return this.projectionValue;
  }

  setProjection(projection: CameraProjection): void {
    if (this.projectionValue === projection) return;
    this.projectionValue = projection;
    this.emit();
  }

  setPose(pose: CameraPose): void {
    this.projectionValue = pose.projection;
    this.positionValue = { ...pose.position };
    this.targetValue = { ...pose.target };
    if (pose.up) this.upValue = { ...pose.up };
    this.fov = pose.fovDeg;
    this.viewHeight = pose.viewHeightMeters;
    this.orbit = this.computeOrbit();
    this.emit();
  }

  /** Centers the orbit target on a box and pulls back far enough to see it. */
  frame(bounds: Bounds): void {
    const center = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    };
    const size = {
      x: Math.max(0.1, bounds.max.x - bounds.min.x),
      y: Math.max(0.1, bounds.max.y - bounds.min.y),
      z: Math.max(0.1, bounds.max.z - bounds.min.z),
    };
    const direction = normalize3(sub3(this.positionValue, this.targetValue)) ?? { x: 0, y: 0, z: 1 };
    const radius = Math.hypot(size.x, size.y, size.z) / 2;
    const distance = Math.max(0.2, radius / Math.tan(this.fov * Math.PI / 360) * FIT_MARGIN);
    this.targetValue = center;
    this.positionValue = add3(center, scale3(direction, distance));
    this.viewHeight = Math.max(0.5, size.y * FIT_MARGIN);
    this.orbit = this.computeOrbit();
    this.emit();
  }

  ray(ndcX: number, ndcY: number, aspect = this.aspectValue): Ray {
    const forward = normalize3(sub3(this.targetValue, this.positionValue)) ?? { x: 0, y: 0, z: -1 };
    const right = normalize3(cross3(forward, this.upValue)) ?? { x: 1, y: 0, z: 0 };
    const up = normalize3(cross3(right, forward)) ?? { x: 0, y: 1, z: 0 };
    if (this.projectionValue === 'orthographic') {
      const halfHeight = this.viewHeight / 2;
      const halfWidth = halfHeight * Math.max(0.001, aspect);
      const origin = add3(
        add3(this.positionValue, scale3(right, ndcX * halfWidth)),
        scale3(up, ndcY * halfHeight),
      );
      return { origin, direction: forward };
    }
    const tanHalf = Math.tan(this.fov * Math.PI / 360);
    const direction = normalize3(add3(
      forward,
      add3(scale3(right, ndcX * tanHalf * aspect), scale3(up, ndcY * tanHalf)),
    )) ?? forward;
    return { origin: { ...this.positionValue }, direction };
  }

  resize(aspect: number): void {
    if (!(aspect > 0) || aspect === this.aspectValue) return;
    this.aspectValue = aspect;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.detach();
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private computeOrbit(): Orbit {
    const offset = sub3(this.positionValue, this.targetValue);
    const distance = Math.max(0.01, Math.hypot(offset.x, offset.y, offset.z));
    return {
      yaw: Math.atan2(offset.x, offset.z),
      pitch: Math.asin(clamp(offset.y / distance, -1, 1)),
      distance,
      target: { ...this.targetValue },
    };
  }

  private applyOrbit(): void {
    const cosPitch = Math.cos(this.orbit.pitch);
    const offset = {
      x: Math.sin(this.orbit.yaw) * cosPitch * this.orbit.distance,
      y: Math.sin(this.orbit.pitch) * this.orbit.distance,
      z: Math.cos(this.orbit.yaw) * cosPitch * this.orbit.distance,
    };
    this.targetValue = { ...this.orbit.target };
    this.positionValue = add3(this.orbit.target, offset);
    this.orbit = this.computeOrbit();
    this.emit();
  }

  private dolly(pixels: number): void {
    const factor = Math.pow(ZOOM_FACTOR, Math.abs(pixels) * 0.01);
    this.orbit.distance = Math.max(0.05, this.orbit.distance * (pixels > 0 ? factor : 1 / factor));
    this.applyOrbit();
  }

  private pan(dx: number, dy: number): void {
    const forward = normalize3(sub3(this.targetValue, this.positionValue)) ?? { x: 0, y: 0, z: -1 };
    const right = normalize3(cross3(forward, this.upValue)) ?? { x: 1, y: 0, z: 0 };
    const up = normalize3(cross3(right, forward)) ?? { x: 0, y: 1, z: 0 };
    const perPixel = this.projectionValue === 'orthographic'
      ? this.viewHeight / Math.max(1, this.canvas.clientHeight)
      : 2 * Math.tan(this.fov * Math.PI / 360) * this.orbit.distance / Math.max(1, this.canvas.clientHeight);
    this.orbit.target = add3(
      add3(this.orbit.target, scale3(right, -dx * perPixel)),
      scale3(up, dy * perPixel),
    );
    this.applyOrbit();
  }

  private attachGestures(): () => void {
    const onWheel = (event: WheelEvent) => {
      if (event.target !== this.canvas) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaMode === 1 ? event.deltaY * 16
        : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
      this.dolly(delta);
    };
    const onDown = (event: PointerEvent) => {
      if (this.drag) return;
      this.drag = { pointer: event.pointerId, button: event.button, x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      const drag = this.drag;
      if (!drag || drag.pointer !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.button === 2 || (drag.button === 0 && event.shiftKey)) {
        this.pan(dx, dy);
        return;
      }
      if (drag.button === 1) {
        this.dolly(dy);
        return;
      }
      if (drag.button === 0) {
        this.orbit.yaw -= dx * 0.006;
        this.orbit.pitch = clamp(this.orbit.pitch + dy * 0.006, -PITCH_LIMIT, PITCH_LIMIT);
        this.applyOrbit();
      }
    };
    const onUp = (event: PointerEvent) => {
      if (!this.drag || this.drag.pointer !== event.pointerId) return;
      this.drag = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    };
    const onContext = (event: Event) => event.preventDefault();

    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    this.canvas.addEventListener('pointerdown', onDown);
    this.canvas.addEventListener('pointermove', onMove);
    this.canvas.addEventListener('pointerup', onUp);
    this.canvas.addEventListener('pointercancel', onUp);
    this.canvas.addEventListener('contextmenu', onContext);
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
      this.canvas.removeEventListener('pointerdown', onDown);
      this.canvas.removeEventListener('pointermove', onMove);
      this.canvas.removeEventListener('pointerup', onUp);
      this.canvas.removeEventListener('pointercancel', onUp);
      this.canvas.removeEventListener('contextmenu', onContext);
    };
  }
}
