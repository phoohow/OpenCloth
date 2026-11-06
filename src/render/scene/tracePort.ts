/** Port the scene uses to tell the path tracer how an object should appear in it. */

import type * as THREE from 'three/webgpu';

/**
 * Registration surface of the path tracer. The scene builds objects and, when it knows a raster
 * representation will not survive ray tracing, hands the tracer an alternative through this port.
 */
export interface TraceProxySink {
  /** The object stays, but the tracer shades it with this material. */
  registerMaterial(object: THREE.Object3D, material: THREE.Material): void;
  /** The tracer sees this object instead of the given one; the proxy must be in the scene. */
  registerGeometry(object: THREE.Object3D, proxy: THREE.Object3D): void;
  /** The object takes no part in ray tracing. */
  exclude(object: THREE.Object3D): void;
}
