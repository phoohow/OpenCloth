import { describe, expect, it } from 'vitest';
import { testSlot } from '../../helpers/testSlot';
import type { SceneSlot } from '@/render';
import * as THREE from 'three/webgpu';
import { PinMarkers } from '@/runtime/pinMarkers';

/** Particle positions for a row of points one centimeter apart on +X. */
function row(count: number): Float32Array {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) positions[i * 3] = i / 100;
  return positions;
}

/** Marker meshes the slot currently holds, in insertion order. */
function markersOf(slot: SceneSlot): THREE.Mesh[] {
  return slot.group.children.filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh);
}

describe('PinMarkers highlight', () => {
  it('turns the hovered pin red and larger, and restores it when the hover moves', () => {
    const slot = testSlot();
    const pins = new PinMarkers();
    pins.add(1, row(3), slot);
    pins.add(2, row(3), slot);
    const [first, second] = markersOf(slot);
    const plainColor = (first!.material as THREE.MeshBasicMaterial).color.getHex();

    pins.highlight(2);
    expect(pins.highlightedIndex()).toBe(2);
    expect((second!.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(plainColor);
    expect(second!.scale.x).toBeGreaterThan(1);

    pins.highlight(1);
    expect(pins.highlightedIndex()).toBe(1);
    // The pin that lost the hover goes back to its plain marker.
    expect((second!.material as THREE.MeshBasicMaterial).color.getHex()).toBe(plainColor);
    expect(second!.scale.x).toBe(1);
    expect((first!.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(plainColor);

    pins.highlight(null);
    expect(pins.highlightedIndex()).toBeNull();
    expect((first!.material as THREE.MeshBasicMaterial).color.getHex()).toBe(plainColor);
    expect(first!.scale.x).toBe(1);
    pins.dispose(slot);
  });

  it('forgets a highlight whose pin was removed', () => {
    const slot = testSlot();
    const pins = new PinMarkers();
    pins.add(3, row(4), slot);
    pins.highlight(3);

    pins.remove(3, slot);
    expect(pins.highlightedIndex()).toBeNull();
    expect(markersOf(slot)).toHaveLength(0);

    // Re-adding the same index must not inherit the red highlight.
    pins.add(3, row(4), slot);
    const marker = markersOf(slot)[0]!;
    expect(marker.scale.x).toBe(1);
    pins.dispose(slot);
  });
});
