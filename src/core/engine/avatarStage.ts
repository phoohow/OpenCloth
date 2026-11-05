import * as THREE from 'three/webgpu';
import type { Avatar, ObjectTransform, SkinAppearance } from '../model/types';
import { IDENTITY_TRANSFORM } from '../model/defaults';
import {
  generateAvatarCollider, fitCapsulesFromGroup, type AvatarCollider,
} from '../../avatar/collider/avatarCollider';
import { meshColliderFromObject } from './avatarMeshCollider';
import { generateProceduralAvatar } from '../../avatar/generator/avatarGenerator';
import { loadModelFromFile, loadModelFromUrl, type LoadedModel } from '../../io/modelLoader';
import { getModelBlob } from '../../io/objectStore';
import { applyTransform } from './objectTransforms';
import { AVATAR_OVERLAY_NAME } from './clothConstants';
import { applyBodySkin } from '../../render/material/bodyMaterial';

/** Extra room around the body grid so animated limbs stay inside it, in meters. */
const ANIMATION_COLLIDER_MARGIN_M = 0.3;

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
  /** Motion clips of the current body file. */
  private clips: THREE.AnimationClip[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private activeClip = -1;
  private playing = false;
  /** Seconds into the active clip, wrapped at its duration. */
  private elapsed = 0;

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
    const group = loaded?.group ?? generateProceduralAvatar(avatar.params);
    if (loaded) group.name = 'avatar';
    const collider = loaded
      ? fitCapsulesFromGroup(group)
      : generateAvatarCollider(avatar.params);
    // Animated bodies need slack around the rest grid for limbs that move outside it.
    const margin = loaded && loaded.animations.length > 0 ? ANIMATION_COLLIDER_MARGIN_M : 0;
    // The capsules remain the fallback and the fit-analysis proxy; the triangle grid drives collision.
    collider.mesh = meshColliderFromObject(group, margin);
    this.group = group;
    this.collider = collider;
    this.clips = loaded?.animations ?? [];
    this.mixer = this.clips.length > 0 ? new THREE.AnimationMixer(group) : null;
    this.action = null;
    this.activeClip = -1;
    this.playing = false;
    this.elapsed = 0;
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

  /** Motion clips the current body carries, in file order. */
  get animationClips(): readonly THREE.AnimationClip[] { return this.clips; }

  /** True while a clip is advancing. */
  get isAnimating(): boolean { return this.playing && this.action !== null; }

  /** Index of the active clip; -1 when none is selected. */
  get clipIndex(): number { return this.activeClip; }

  /** Seconds into the active clip. */
  get clipTimeSeconds(): number { return this.elapsed; }

  /** Length of the active clip in seconds; 0 without one. */
  get clipDurationSeconds(): number { return this.action ? this.action.getClip().duration : 0; }

  /** Selects and plays a clip; an out-of-range index is ignored. */
  playClip(index: number): boolean {
    if (!this.mixer || index < 0 || index >= this.clips.length) return false;
    if (!this.action || this.activeClip !== index) {
      this.action?.stop();
      const action = this.mixer.clipAction(this.clips[index]!);
      action.reset();
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.enabled = true;
      this.action = action;
      this.activeClip = index;
      this.elapsed = 0;
    }
    this.action.play();
    this.playing = true;
    return true;
  }

  /** Holds the current pose without advancing. */
  pauseClip(): void {
    this.playing = false;
  }

  /** Drops the active clip and leaves the body at its last pose. */
  stopClip(): void {
    this.playing = false;
    this.action?.stop();
    this.action = null;
    this.activeClip = -1;
    this.elapsed = 0;
  }

  /** Advances the active clip; true when the body pose changed. */
  advanceClip(dtMs: number): boolean {
    if (!this.playing || !this.action || !this.mixer) return false;
    this.mixer.update(dtMs / 1000);
    this.elapsed = this.action.time;
    return true;
  }

  /** Seeks the active clip to a time in milliseconds, updating the pose immediately. */
  seekClip(ms: number): void {
    if (!this.action || !this.mixer) return;
    const duration = Math.max(this.action.getClip().duration, 1e-6);
    const t = Math.min(Math.max(ms / 1000, 0), duration);
    this.action.time = t;
    this.mixer.update(0);
    this.elapsed = t;
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
    this.clips = [];
    this.mixer = null;
    this.action = null;
    this.activeClip = -1;
    this.playing = false;
    this.elapsed = 0;
  }

  /** Loads the avatar from its model url, else from the stored imported bytes. */
  private async loadModel(avatar: Avatar): Promise<LoadedModel | null> {
    const targetHeight = (avatar.heightCm ?? avatar.params.heightCm) / 100;
    try {
      if (avatar.glbUrl) return await loadModelFromUrl(avatar.glbUrl, { targetHeight });
      if (avatar.glbObjectKey) {
        const blob = await getModelBlob(avatar.glbObjectKey);
        if (!blob) return null;
        const file = new File([blob], avatar.modelName ?? 'avatar.glb');
        return await loadModelFromFile(file, { targetHeight });
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
