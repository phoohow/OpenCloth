/** The body garment is dressed onto: its asset, world entity and collision body. */

import type { Avatar, ObjectTransform, SkinAppearance } from '@/model/types';
import { IDENTITY_TRANSFORM } from '@/model';
import type {
  AssetAnimation, AssetAppearance, AssetDisplay, AssetHandle, AssetSource,
} from '@/render/common';
import { CHANNEL_ALL, type EntityId } from '@/render/world';
import {
  buildMeshCollider, type AvatarCollider,
} from '@/avatar/collider';
import { getModelBlob } from '@/io/storage';
import { bodyKey, makehumanBody } from '@/avatar';
import type { PresenterHost } from '@/runtime/presenters/host';
import { makehumanAvatarCounts, makehumanAvatarMeshes } from '@/runtime/makehumanAvatar';
import { SimplifiedBodyStage } from '@/runtime/simplifiedBodyStage';

/** Key the body asset is loaded under and released by. */
const AVATAR_ASSET_KEY = 'avatar';

/** Extra room around the body grid so animated limbs stay inside it, in meters. */
const ANIMATION_COLLIDER_MARGIN_M = 0.3;

/** The body garment is dressed onto: its asset, world entity, collision body and motion clips. */
export class AvatarStage {
  /** Collision body fitted to the current asset, baked in the body's local frame. */
  collider: AvatarCollider | null = null;

  private host: PresenterHost | null = null;
  /** Asset owning the body object, its clips and its soft deformation. */
  private asset: AssetHandle | null = null;
  private entity: EntityId | null = null;
  private display: AssetDisplay = 'visible';
  private appearance: SkinAppearance | undefined;
  /** Appearance key the body materials were last written for. */
  private appliedSkin = '';
  /** Whether the selected body is drawn highlighted. */
  private highlighted = false;
  /** Body measurement key the proxy was built for. */
  private simplifiedKey = '';
  /** Whether the simplified body proxy is shown. */
  private simplifiedVisible = false;
  /** Low-detail body proxy drawn over the skin, when enabled. */
  private simplified: SimplifiedBodyStage | null = null;
  /** Geometry counts of the built-in body; null while an imported model is drawn. */
  private bodyCounts: { vertices: number; triangles: number } | null = null;

  /** Asset of the current body; null before the first build. */
  get handle(): AssetHandle | null { return this.asset; }

  /** Vertex and triangle counts of the drawn body, or null for an unmeasured imported model. */
  get bodyStats(): { vertices: number; triangles: number } | null { return this.bodyCounts; }

  /** True while the body carries the selection highlight. */
  get hasOverlay(): boolean { return this.highlighted && this.asset !== null; }

  /** True while the body is drawn with its stored display. */
  objectVisible(): boolean { return this.asset !== null && this.display === 'visible'; }

  /** Replaces the scene body with the project's avatar and rebuilds its collision body. */
  async build(avatar: Avatar, host: PresenterHost): Promise<void> {
    this.detach(host);
    const asset = await this.load(avatar, host);
    const collision = asset.collision();
    // Animated bodies need slack around the rest grid for limbs that move outside it.
    const margin = asset.animations().length > 0 ? ANIMATION_COLLIDER_MARGIN_M : 0;
    const mesh = collision ? buildMeshCollider(collision.vertices, undefined, margin) : null;
    const collider = mesh ? { mesh } : null;
    if (!collision) console.warn('Avatar has no collision mesh; cloth will not collide with the body');

    this.host = host;
    this.asset = asset;
    this.collider = collider;
    this.display = avatar.display;
    this.appearance = avatar.appearance;
    this.entity = host.writer.createEntity({
      layer: 'subject',
      tags: ['avatar'],
      mesh: { kind: 'asset', key: AVATAR_ASSET_KEY },
      channels: CHANNEL_ALL,
      bounds: asset.bounds,
    });
    host.bind('avatar', this.entity);
    this.applySkin();
    asset.setDisplay(avatar.display);
    this.place(avatar.transform);
    this.applySimplifiedBody(avatar);
  }

  /** Shows or hides the simplified body proxy; rebuilds it when the measurements changed. */
  setSimplifiedBody(visible: boolean, avatar: Avatar): void {
    this.simplifiedVisible = visible;
    this.applySimplifiedBody(avatar);
  }

  /** Builds the simplified model for the current measurements and applies its visibility. */
  private applySimplifiedBody(avatar: Avatar): void {
    const host = this.host;
    if (!host) return;
    const key = bodyKey(avatar.params);
    if (this.simplified && this.simplifiedKey === key) {
      this.simplified.place(avatar.transform);
      this.simplified.setVisible(this.simplifiedVisible);
      return;
    }
    this.simplified?.dispose();
    this.simplified = null;
    this.simplifiedKey = '';
    // The proxy is measured only while shown; a hidden one costs no body rebuild.
    if (!this.simplifiedVisible) return;
    this.simplified = new SimplifiedBodyStage(host, avatar.params, avatar.transform);
    this.simplified.setVisible(true);
    this.simplifiedKey = key;
  }

  /** Rewrites the body materials for a new skin appearance without rebuilding the body. */
  applyAppearance(appearance?: SkinAppearance): void {
    if (appearanceKey(appearance) === this.appliedSkin) return;
    this.appearance = appearance;
    this.applySkin();
    this.host?.writer.touch('material');
  }

  /** Places the body at its stored scene transform. */
  place(transform?: ObjectTransform): void {
    this.asset?.pose(transform ?? IDENTITY_TRANSFORM);
    this.simplified?.place(transform);
    if (this.entity !== null && this.asset) {
      this.host?.writer.updateEntity(this.entity, { bounds: this.asset.bounds });
    }
    this.host?.writer.touch('transform');
  }

  /** Motion clips the current body carries, in file order. */
  animationClips(): readonly AssetAnimation[] { return this.asset?.animations() ?? []; }

  /** True while a clip is advancing. */
  get isAnimating(): boolean { return this.asset?.playback().playing ?? false; }

  /** Index of the selected clip; -1 when none is selected. */
  get clipIndex(): number { return this.asset?.playback().clip ?? -1; }

  /** Seconds into the active clip. */
  get clipTimeSeconds(): number { return this.asset?.playback().timeSeconds ?? 0; }

  /** Length of the active clip in seconds; 0 without one. */
  get clipDurationSeconds(): number {
    const playback = this.asset?.playback();
    if (!playback || playback.clip < 0) return 0;
    return this.asset?.animations()[playback.clip]?.duration ?? 0;
  }

  /** Selects and plays a clip; an out-of-range index is ignored. */
  playClip(index: number): boolean {
    return this.asset?.play(index) ?? false;
  }

  /** Holds the current pose without advancing. */
  pauseClip(): void {
    this.asset?.setPlaying(false);
  }

  /** Holds the current pose; the clip stays selected. */
  stopClip(): void {
    this.asset?.setPlaying(false);
  }

  /** Advances the active clip; true when the body pose changed. */
  advanceClip(dtMs: number): boolean {
    const changed = this.asset?.advance(dtMs / 1000) ?? false;
    if (changed) this.host?.writer.touch('transform');
    return changed;
  }

  /** Seeks the active clip to a time in milliseconds, updating the pose immediately. */
  seekClip(ms: number): void {
    if (!this.asset) return;
    this.asset.seek(ms / 1000);
    this.host?.writer.touch('transform');
  }

  /** Shows, hides or fades the body without touching its highlight. */
  applyDisplay(display: AssetDisplay): void {
    if (display === this.display) return;
    this.display = display;
    this.asset?.setDisplay(display);
    this.asset?.setAppearance(this.skinAppearance());
    this.host?.writer.touch('visibility');
    this.host?.writer.touch('material');
  }

  /** Draws or drops the translucent highlight over the body. */
  highlight(on: boolean): void {
    if (this.highlighted === on) return;
    this.highlighted = on;
    this.asset?.setHighlighted(on);
  }

  /** Removes the body entity from the world and releases its asset. */
  detach(host: PresenterHost): void {
    this.simplified?.dispose();
    this.simplified = null;
    this.simplifiedKey = '';
    if (this.entity !== null) {
      host.unbind(this.entity);
      host.writer.destroyEntity(this.entity);
    }
    host.assets.release(AVATAR_ASSET_KEY);
    this.entity = null;
    this.asset = null;
    this.host = null;
    this.collider = null;
    this.display = 'visible';
    this.appearance = undefined;
    this.appliedSkin = '';
    this.highlighted = false;
    this.bodyCounts = null;
  }

  /** Releases the body when the viewport tears the scene down. */
  dispose(): void {
    if (this.host) this.detach(this.host);
  }

  /** Loads the body source; an imported model that fails falls back to the built-in body. */
  private async load(avatar: Avatar, host: PresenterHost): Promise<AssetHandle> {
    const source = await this.sourceOf(avatar);
    try {
      return await host.assets.load(AVATAR_ASSET_KEY, source);
    } catch (err) {
      console.warn('Avatar model unavailable, falling back to the MakeHuman body:', err);
      const body = makehumanBody(avatar.params);
      this.bodyCounts = makehumanAvatarCounts(body);
      return host.assets.load(AVATAR_ASSET_KEY, { kind: 'meshes', meshes: makehumanAvatarMeshes(body) });
    }
  }

  /** Imported model file of the body, or the MakeHuman mesh built from its measurements. */
  private async sourceOf(avatar: Avatar): Promise<AssetSource> {
    if (avatar.source === 'glb' && avatar.glbUrl) {
      this.bodyCounts = null;
      return { kind: 'model', url: avatar.glbUrl, targetHeight: avatar.params.heightCm / 100 };
    }
    if (avatar.source === 'glb' && avatar.glbObjectKey) {
      try {
        const blob = await getModelBlob(avatar.glbObjectKey);
        if (blob) {
          this.bodyCounts = null;
          return {
            kind: 'model',
            data: await blob.arrayBuffer(),
            fileName: avatar.modelName ?? 'avatar.glb',
            targetHeight: avatar.params.heightCm / 100,
          };
        }
      } catch (err) {
        console.warn('Avatar model unavailable, falling back to the MakeHuman body:', err);
      }
    }
    const body = makehumanBody(avatar.params);
    this.bodyCounts = makehumanAvatarCounts(body);
    return { kind: 'meshes', meshes: makehumanAvatarMeshes(body) };
  }

  /** Writes the appearance onto the current asset and records what was applied. */
  private applySkin(): void {
    this.appliedSkin = appearanceKey(this.appearance);
    this.asset?.setAppearance(this.skinAppearance());
  }

  /** Skin values of the current body, faded while the body is translucent. */
  private skinAppearance(): AssetAppearance {
    const skin = this.appearance;
    return {
      ...(skin ? { color: skin.color, roughness: skin.roughness, clearcoat: skin.clearcoat } : {}),
      opacity: this.display === 'translucent' ? 0.35 : 1,
    };
  }
}

/** Comparable key of a skin appearance. */
function appearanceKey(appearance?: SkinAppearance): string {
  return JSON.stringify(appearance ?? null);
}
