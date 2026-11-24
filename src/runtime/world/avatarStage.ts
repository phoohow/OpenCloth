import type { Avatar, ObjectTransform, SkinAppearance } from '@/model/types';
import type {
  AssetAnimation, AssetAppearance, AssetDisplay, AssetHandle, AssetSource,
} from '@/render/common';
import type { PresenterHost } from '@/runtime/world/presenters/host';

import { bodyKey, makehumanBody } from '@/avatar';
import {
  buildMeshCollider, type AvatarCollider,
} from '@/avatar/collider';
import { getModelBlob } from '@/io/storage';
import { IDENTITY_TRANSFORM } from '@/model';
import { CHANNEL_ALL, type EntityId } from '@/render/world';
import { makehumanAvatarCounts, makehumanAvatarSource } from '@/runtime/engine/makehumanAvatar';
import { GirthLinesStage } from '@/runtime/world/girthLinesStage';
import { SimplifiedBodyStage } from '@/runtime/world/simplifiedBodyStage';
import { SkeletonStage } from '@/runtime/world/skeletonStage';

const AVATAR_ASSET_KEY = 'avatar';

const ANIMATION_COLLIDER_MARGIN_M = 0.3;

interface Guide {
  setVisible(visible: boolean): void;
  place(transform?: ObjectTransform): void;
  dispose(): void;
}

interface GuideSlot<T extends Guide> {
  stage: T | null;
  visible: boolean;
  key: string;
}

export class AvatarStage {
  collider: AvatarCollider | null = null;

  private host: PresenterHost | null = null;
  private asset: AssetHandle | null = null;
  private entity: EntityId | null = null;
  private display: AssetDisplay = 'visible';
  private appearance: SkinAppearance | undefined;
  private margin = 0;
  private appliedSkin = '';
  private highlighted = false;
  private readonly simplified = idleGuide<SimplifiedBodyStage>();
  private readonly lines = idleGuide<GirthLinesStage>();
  private readonly skeleton = idleGuide<SkeletonStage>();
  private readonly guides: readonly GuideSlot<Guide>[] = [this.simplified, this.lines, this.skeleton];
  private bodyCounts: { vertices: number; triangles: number } | null = null;

  get handle(): AssetHandle | null { return this.asset; }

  private get measuredBody(): boolean { return this.bodyCounts !== null; }

  get bodyStats(): { vertices: number; triangles: number } | null { return this.bodyCounts; }

  get hasOverlay(): boolean { return this.highlighted && this.asset !== null; }

  objectVisible(): boolean { return this.asset !== null && this.display === 'visible'; }

  async build(avatar: Avatar, host: PresenterHost): Promise<void> {
    this.detach(host);
    const asset = await this.load(avatar, host);
    this.margin = asset.animations().length > 0 ? ANIMATION_COLLIDER_MARGIN_M : 0;

    this.host = host;
    this.asset = asset;
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
    if (!this.collider) console.warn('Avatar has no collision mesh; cloth will not collide with the body');
    this.applySimplifiedBody(avatar);
    this.applyGirthLines(avatar);
    this.applySkeleton(avatar);
  }

  setSimplifiedBody(visible: boolean, avatar: Avatar): void {
    this.simplified.visible = visible;
    this.applySimplifiedBody(avatar);
  }

  setGirthLines(visible: boolean, avatar: Avatar): void {
    this.lines.visible = visible;
    this.applyGirthLines(avatar);
  }

  setSkeleton(visible: boolean, avatar: Avatar): void {
    this.skeleton.visible = visible;
    this.applySkeleton(avatar);
  }

  private applySimplifiedBody(avatar: Avatar): void {
    const host = this.host;
    if (!host) return;
    syncGuide(this.simplified, avatar,
      () => new SimplifiedBodyStage(host, avatar.params, avatar.transform));
  }

  private applyGirthLines(avatar: Avatar): void {
    const host = this.host;
    if (!host || !this.measuredBody) return;
    syncGuide(this.lines, avatar,
      () => new GirthLinesStage(host, avatar.params, avatar.transform));
  }

  private applySkeleton(avatar: Avatar): void {
    const host = this.host;
    if (!host || !this.measuredBody) return;
    syncGuide(this.skeleton, avatar,
      () => new SkeletonStage(host, avatar.params, avatar.transform));
    this.poseSkeleton();
  }

  private poseSkeleton(): void {
    const stage = this.skeleton.stage;
    if (!stage || !this.skeleton.visible) return;
    stage.pose(this.asset?.regionPoses() ?? []);
  }

  applyAppearance(appearance?: SkinAppearance): void {
    if (appearanceKey(appearance) === this.appliedSkin) return;
    this.appearance = appearance;
    this.applySkin();
    this.host?.writer.touch('material');
  }

  pose(transform?: ObjectTransform): void {
    this.asset?.pose(transform ?? IDENTITY_TRANSFORM);
    for (const guide of this.guides) guide.stage?.place(transform);
    if (this.entity !== null && this.asset) {
      this.host?.writer.updateEntity(this.entity, { bounds: this.asset.bounds });
    }

    this.host?.writer.touch('transform');
  }

  place(transform?: ObjectTransform): void {
    this.pose(transform);
    this.collider = this.fitCollider();
  }

  private fitCollider(): AvatarCollider | null {
    const collision = this.asset?.collision();
    if (!collision) return null;
    const mesh = buildMeshCollider(collision.vertices, undefined, this.margin);
    return mesh ? { mesh } : null;
  }

  animationClips(): readonly AssetAnimation[] { return this.asset?.animations() ?? []; }

  get isAnimating(): boolean { return this.asset?.playback().playing ?? false; }

  get clipIndex(): number { return this.asset?.playback().clip ?? -1; }

  get clipTimeSeconds(): number { return this.asset?.playback().timeSeconds ?? 0; }

  get clipDurationSeconds(): number {
    const clips = this.animationClips();
    const index = this.clipIndex;
    return index >= 0 && index < clips.length ? clips[index]!.duration : 0;
  }

  playClip(index: number): boolean {
    const playing = this.asset?.play(index) ?? false;
    if (playing) this.poseSkeleton();
    return playing;
  }

  selectClip(index: number): boolean {
    const selected = this.asset?.select(index) ?? false;
    if (selected) {
      this.host?.writer.touch('transform');
      this.poseSkeleton();
    }

    return selected;
  }

  pauseClip(): void {
    this.asset?.setPlaying(false);
  }

  stopClip(): void {
    this.asset?.setPlaying(false);
  }

  advanceClip(dtMs: number): boolean {
    const changed = this.asset?.advance(dtMs / 1000) ?? false;
    if (changed) {
      this.host?.writer.touch('transform');
      this.poseSkeleton();
    }

    return changed;
  }

  seekClip(ms: number): void {
    if (!this.asset) return;
    this.asset.seek(ms / 1000);
    this.host?.writer.touch('transform');
    this.poseSkeleton();
  }

  applyDisplay(display: AssetDisplay): void {
    if (display === this.display) return;
    this.display = display;
    this.asset?.setDisplay(display);
    this.asset?.setAppearance(this.skinAppearance());
    this.host?.writer.touch('visibility');
    this.host?.writer.touch('material');
  }

  highlight(on: boolean): void {
    if (this.highlighted === on) return;
    this.highlighted = on;
    this.asset?.setHighlighted(on);
  }

  detach(host: PresenterHost): void {
    for (const guide of this.guides) {
      guide.stage?.dispose();
      guide.stage = null;
      guide.key = '';
    }

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

  dispose(): void {
    if (this.host) this.detach(this.host);
  }

  private async load(avatar: Avatar, host: PresenterHost): Promise<AssetHandle> {
    const source = await this.sourceOf(avatar);
    try {
      return await host.assets.load(AVATAR_ASSET_KEY, source);
    } catch (err) {
      console.warn('Avatar model unavailable, falling back to the MakeHuman body:', err);
      const body = makehumanBody(avatar.params);
      this.bodyCounts = makehumanAvatarCounts(body);
      return host.assets.load(AVATAR_ASSET_KEY, makehumanAvatarSource(body));
    }
  }

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
    return makehumanAvatarSource(body);
  }

  private applySkin(): void {
    this.appliedSkin = appearanceKey(this.appearance);
    this.asset?.setAppearance(this.skinAppearance());
  }

  private skinAppearance(): AssetAppearance {
    const skin = this.appearance;
    return {
      ...(skin ? { color: skin.color, roughness: skin.roughness, clearcoat: skin.clearcoat } : {}),
      opacity: this.display === 'translucent' ? 0.35 : 1,
    };
  }
}

function idleGuide<T extends Guide>(): GuideSlot<T> {
  return { stage: null, visible: false, key: '' };
}

function syncGuide<T extends Guide>(slot: GuideSlot<T>, avatar: Avatar, create: () => T): void {
  const key = bodyKey(avatar.params);
  if (slot.stage && slot.key === key) {
    slot.stage.place(avatar.transform);
    slot.stage.setVisible(slot.visible);
    return;
  }

  slot.stage?.dispose();
  slot.stage = null;
  slot.key = '';
  if (!slot.visible) return;
  slot.stage = create();
  slot.stage.setVisible(true);
  slot.key = key;
}

function appearanceKey(appearance?: SkinAppearance): string {
  return JSON.stringify(appearance ?? null);
}
