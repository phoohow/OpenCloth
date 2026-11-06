import * as THREE from 'three/webgpu';
import type { StageSlot, SlotName } from '@/render';
import { SLOT_LAYER } from '@/render/scene/slots';

/** Stage slot backed by a bare group, for tests that only need a container. */
export function testSlot(name: SlotName = 'measure'): StageSlot {
  const group = new THREE.Group();
  const slot: StageSlot = {
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
    markSurface() { },
    markChanged() { },
  };
  return slot;
}
