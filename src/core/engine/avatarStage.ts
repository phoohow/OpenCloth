import * as THREE from 'three/webgpu';
import type { Avatar, ObjectTransform, SkinAppearance } from '../model/types';
import { IDENTITY_TRANSFORM } from '../model/defaults';
import {
  generateAvatarCollider, fitCapsulesFromGroup, type AvatarCollider,
} from '../../avatar/collider/avatarCollider';
import { meshColliderFromObject } from './avatarMeshCollider';
import { generateProceduralAvatar } from '../../avatar/generator/avatarGenerator';
import { loadModelFromFile, loadModelFromUrl } from '../../io/modelLoader';
import { getModelBlob } from '../../io/objectStore';
import { applyTransform } from './objectTransforms';
import { AVATAR_OVERLAY_NAME } from './clothConstants';
import { applyBodySkin } from '../../render/material/bodyMaterial';

/** Translucent material for the clones marking the avatar as selected. */
const SELECTION_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xfff3b0, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
});

/** The body garment is dressed onto: its scene group, collision body and selection overlay. */
export class AvatarStage {
  /**
   * Collision body fitted to the current model, baked in the group's local frame: a scene
   * transform applied later by `place()` is not reflected in it.
   */
  collider: AvatarCollider | null = null;

  private group: THREE.Group | null = null;
  private overlays: THREE.Mesh[] = [];
  /** Appearance key the body materials were last written for. */
  private appliedSkin = '';

  /** True while the selection overlay clones are in the scene. */
  get hasOverlay(): boolean { return this.overlays.length > 0; }

  /** Scene group holding the body, or null before the first build. */
  get object(): THREE.Group | null { return this.group; }

  /** Replaces the scene avatar with the project's body and rebuilds its collision body. */
  async build(avatar: Avatar, scene: THREE.Scene): Promise<void> {
    this.detach(scene);
    const loaded = avatar.source === 'procedural'
      ? null
      : await this.loadModel(avatar);
    const group = loaded ?? generateProceduralAvatar(avatar.params);
    if (loaded) group.name = 'avatar';
    const collider = loaded
      ? fitCapsulesFromGroup(loaded)
      : generateAvatarCollider(avatar.params);
    // The capsules remain the fallback and the fit-analysis proxy; the triangle grid drives collision.
    collider.mesh = meshColliderFromObject(group);
    this.group = group;
    this.collider = collider;
    this.applySkin(avatar.appearance);
    scene.add(this.group);
  }

  /** Rewrites the body materials for a new skin appearance without rebuilding the body. */
  applyAppearance(appearance?: SkinAppearance): void {
    if (!this.group || skinKey(appearance) === this.appliedSkin) return;
    this.applySkin(appearance);
  }

  /** Places the avatar group at its stored scene transform. */
  place(transform: ObjectTransform | undefined): void {
    if (this.group) applyTransform(this.group, transform ?? IDENTITY_TRANSFORM);
  }

  /** Shows, hides or fades the avatar without touching its overlay clones. */
  applyDisplay(display: 'visible' | 'hidden' | 'translucent'): void {
    if (!this.group) return;
    this.group.visible = display !== 'hidden';
    this.group.traverse(obj => {
      if (!(obj instanceof THREE.Mesh) || obj.name === AVATAR_OVERLAY_NAME) return;
      const mat = obj.material as THREE.MeshStandardMaterial;
      mat.transparent = display === 'translucent';
      mat.opacity = display === 'translucent' ? 0.35 : 1;
    });
  }

  /** Rebuilds the translucent clones that mark the avatar as selected. */
  highlight(highlighted: boolean): void {
    this.clearOverlay();
    if (!highlighted || !this.group) return;
    this.group.traverse(obj => {
      if (!(obj instanceof THREE.Mesh) || obj.name === AVATAR_OVERLAY_NAME) return;
      const overlay = new THREE.Mesh(obj.geometry, SELECTION_MATERIAL);
      overlay.name = AVATAR_OVERLAY_NAME;
      overlay.renderOrder = 2;
      obj.add(overlay);
      this.overlays.push(overlay);
    });
  }

  /** Removes the avatar group and its overlays from the scene. */
  detach(scene: THREE.Scene): void {
    this.clearOverlay();
    if (!this.group) return;
    scene.remove(this.group);
    this.group = null;
    this.collider = null;
    this.appliedSkin = '';
  }

  /** Loads the avatar from its model url, else from the stored imported bytes. */
  private async loadModel(avatar: Avatar): Promise<THREE.Group | null> {
    const targetHeight = (avatar.heightCm ?? avatar.params.heightCm) / 100;
    try {
      if (avatar.glbUrl) return (await loadModelFromUrl(avatar.glbUrl, { targetHeight })).group;
      if (avatar.glbObjectKey) {
        const blob = await getModelBlob(avatar.glbObjectKey);
        if (!blob) return null;
        const file = new File([blob], avatar.modelName ?? 'avatar.glb');
        return (await loadModelFromFile(file, { targetHeight })).group;
      }
    } catch (err) {
      console.warn('Avatar model unavailable, falling back to the procedural mannequin:', err);
    }
    return null;
  }

  private clearOverlay(): void {
    for (const overlay of this.overlays) overlay.removeFromParent();
    this.overlays = [];
  }

  /** Writes the appearance onto the current group and records what was applied. */
  private applySkin(appearance?: SkinAppearance): void {
    this.appliedSkin = skinKey(appearance);
    if (this.group) applyBodySkin(this.group, appearance);
  }
}

/** Comparable key of a skin appearance. */
function skinKey(appearance?: SkinAppearance): string {
  return JSON.stringify(appearance ?? null);
}
