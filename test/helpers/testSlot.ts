import * as THREE from 'three/webgpu';
import type { SceneSlot, SlotName } from '@/render';
import { SLOT_LAYER } from '@/render/scene/slots';

/** Scene slot backed by a bare group, for tests that only need a container. */
export function testSlot(name: SlotName = 'measure'): SceneSlot {
  const group = new THREE.Group();
  const slot: SceneSlot = {
    name,
    layer: SLOT_LAYER[name],
    group,
    get objects() {
      return group.children;
    },
    add(object) {
      group.add(object);
    },
    remove(object) {
      group.remove(object);
    },
    clear() {
      group.clear();
    },
    setTraceMask() { },
    markPatternSurface() { },
    markRevision() { },
  };
  return slot;
}
