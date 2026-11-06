/** How the path tracer sees objects that the raster passes draw differently. */

import * as THREE from 'three/webgpu';
import type { TraceProxySink } from '@/render/scene/tracePort';

/** Substitute representation of one object inside the tracer. */
type Proxy =
  | { kind: 'material'; material: THREE.Material }
  | { kind: 'geometry'; object: THREE.Object3D }
  | { kind: 'excluded' };

/**
 * Registration table of the path tracer. The scene manager knows nothing about tracing; the code
 * that builds an object declares how it should appear when the tracer walks the scene.
 */
export class TraceProxies implements TraceProxySink {
  private readonly entries = new Map<THREE.Object3D, Proxy>();

  registerMaterial(object: THREE.Object3D, material: THREE.Material): void {
    this.entries.set(object, { kind: 'material', material });
  }

  registerGeometry(object: THREE.Object3D, proxy: THREE.Object3D): void {
    this.entries.set(object, { kind: 'geometry', object: proxy });
  }

  exclude(object: THREE.Object3D): void {
    this.entries.set(object, { kind: 'excluded' });
  }

  /** Whether anything is registered for this object. */
  has(object: THREE.Object3D): boolean {
    return this.entries.has(object);
  }

  /**
   * Runs `update` with the scene in its traced presentation: hidden raster stand-ins swapped for
   * their proxies, substitute materials installed, excluded objects hidden. Always restores.
   */
  run<T>(update: () => T): T {
    const restore: Array<() => void> = [];
    for (const [object, proxy] of this.entries) {
      if (proxy.kind === 'material' && object instanceof THREE.Mesh) {
        const original = object.material;
        object.material = proxy.material;
        restore.push(() => { object.material = original; });
      } else if (proxy.kind === 'geometry') {
        const wasVisible = object.visible;
        const proxyWasVisible = proxy.object.visible;
        object.visible = false;
        proxy.object.visible = true;
        restore.push(() => {
          object.visible = wasVisible;
          proxy.object.visible = proxyWasVisible;
        });
      } else {
        const wasVisible = object.visible;
        object.visible = false;
        restore.push(() => { object.visible = wasVisible; });
      }
    }
    try {
      return update();
    } finally {
      for (let i = restore.length - 1; i >= 0; i--) restore[i]!();
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
