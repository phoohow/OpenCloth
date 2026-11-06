/** Render targets one frame draws into, pooled by size and format. */

import * as THREE from 'three/webgpu';
import type { ViewportDevice } from '@/render/device/viewport';

/** Size of one set of targets. */
export interface FrameSize {
  /** Drawing-buffer size, in device pixels. */
  width: number;
  height: number;
  /** Path-traced size, in CSS pixels scaled by the tracer's own render scale. */
  traceWidth: number;
  traceHeight: number;
}

/** Sizes of the buffers one frame needs, from the drawing surface and the tracer's render scale. */
export function measureFrame(device: ViewportDevice, renderScale = 1): FrameSize {
  const drawing = new THREE.Vector2();
  device.renderer.getDrawingBufferSize(drawing);
  const css = new THREE.Vector2();
  device.renderer.getSize(css);
  return {
    width: Math.max(1, Math.floor(drawing.x)),
    height: Math.max(1, Math.floor(drawing.y)),
    traceWidth: Math.max(1, Math.floor(css.x * renderScale)),
    traceHeight: Math.max(1, Math.floor(css.y * renderScale)),
  };
}

/**
 * The three images a frame needs, plus the depth the first of them carries.
 *
 * Every target holds linear values: three disables tone mapping and colour-space conversion when
 * it draws into a render target, so a display-referred target would double-decode. The canvas
 * encodes to sRGB once, at the very end.
 *
 * No two targets share a depth texture. three rebuilds the depth attachment of a target registered
 * after the first one holding it, which leaves the earlier target submitting against a destroyed
 * texture — the scene stage is then dropped and the image freezes while the overlays, drawn into a
 * later target, keep following the camera.
 */
export class FrameTargets {
  /**
   * The frame's image, and the only target with depth.
   *
   * The scene stage writes the lit raster here, the post chain resolves it in place, the overlays
   * finish it, and the canvas is presented from it. Nothing but the scene stage writes depth, so
   * the depth it lays down is still there when the overlays test against it.
   */
  image!: THREE.RenderTarget;
  /** Raster image merged with the traced radiance, linear; the post chain reads it. */
  resolved!: THREE.RenderTarget;
  /** Path-traced radiance, linear HDR. */
  radiance!: THREE.RenderTarget;
  /** Depth of the lit image, owned by the image target alone. */
  private depth: THREE.DepthTexture | null = null;
  private size: FrameSize | null = null;

  /** Reallocates when the size changed; returns whether it did. */
  ensure(size: FrameSize): boolean {
    const current = this.size;
    if (current
      && current.width === size.width && current.height === size.height
      && current.traceWidth === size.traceWidth && current.traceHeight === size.traceHeight) {
      return false;
    }
    this.dispose();
    this.size = { ...size };
    const depth = new THREE.DepthTexture(size.width, size.height);
    this.depth = depth;
    this.image = linearTarget(size.width, size.height, depth);
    this.resolved = linearTarget(size.width, size.height, null);
    this.radiance = linearTarget(size.traceWidth, size.traceHeight, null);
    return true;
  }

  /** Frees every target and the depth the image carries. */
  dispose(): void {
    this.image?.dispose();
    this.resolved?.dispose();
    this.radiance?.dispose();
    this.depth?.dispose();
    this.depth = null;
    this.size = null;
  }
}

/** Half-float linear target, with a depth attachment when one is given. */
function linearTarget(
  width: number, height: number, depth: THREE.DepthTexture | null,
): THREE.RenderTarget {
  const target = new THREE.RenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthBuffer: depth !== null,
    // Omitted rather than set to null, so three keeps its own "no depth texture" state.
    ...(depth ? { depthTexture: depth } : {}),
  });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  return target;
}
