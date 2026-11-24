import type { AvatarStage } from '@/runtime/world/avatarStage';

import { reindexMeshCollider, type MeshCollider, type MeshGridSpec } from '@/avatar/collider';

const GRID_INTERVAL_FRAMES = 4;

const SEEK_SETTLE_MS = 90;

export interface AvatarMotionHooks {
  installCollider: (mesh: MeshCollider) => void;
  onPoseSettled: () => void;
}

export interface AvatarMotionInfo {
  clips: string[];
  clipDurationsMs: number[];
  clipIndex: number;
  playing: boolean;
  timeMs: number;
}

export class AvatarMotion {
  private spec: MeshGridSpec | null = null;
  private countdown = 0;
  private seekSettledAt = 0;

  constructor(private readonly avatar: AvatarStage, private readonly hooks: AvatarMotionHooks) {}

  reset(): void {
    const mesh = this.avatar.collider?.mesh;
    this.spec = mesh ? { origin: [...mesh.origin], cell: mesh.cell, dims: [...mesh.dims] } : null;
    this.countdown = 0;
    this.seekSettledAt = 0;
  }

  info(): AvatarMotionInfo {
    const clips = this.avatar.animationClips();
    return {
      clips: clips.map((clip, i) => clip.name || `动作 ${i + 1}`),
      clipDurationsMs: clips.map(clip => clip.duration * 1000),
      clipIndex: this.avatar.clipIndex,
      playing: this.avatar.isAnimating,
      timeMs: this.avatar.clipTimeSeconds * 1000,
    };
  }

  play(index: number): boolean {
    return this.avatar.playClip(index);
  }

  select(index: number): boolean {
    const selected = this.avatar.selectClip(index);
    if (selected) {
      this.seekSettledAt = 0;
      this.countdown = GRID_INTERVAL_FRAMES;
      this.hooks.onPoseSettled();
      this.refreshCollider();
    }

    return selected;
  }

  pause(): void {
    this.avatar.pauseClip();
    this.hooks.onPoseSettled();
  }

  stop(): void {
    this.avatar.stopClip();
    this.hooks.onPoseSettled();
  }

  seek(ms: number): void {
    this.ensureActive();
    const limit = this.avatar.clipDurationSeconds * 1000;
    this.avatar.seekClip(Math.max(0, Math.min(ms, limit)));
    this.seekSettledAt = performance.now() + SEEK_SETTLE_MS;
    this.hooks.onPoseSettled();
  }

  rewind(): void {
    if (this.avatar.isAnimating) this.pause();
    this.seek(0);
    this.flushSeek();
  }

  step(frameMs: number): void {
    this.ensureActive();
    const duration = this.avatar.clipDurationSeconds;
    if (duration <= 0) return;
    if (this.avatar.isAnimating) this.pause();
    this.seek(((this.avatar.clipTimeSeconds + frameMs / 1000) % duration) * 1000);
    this.flushSeek();
  }

  advance(dtMs: number): boolean {
    this.settleSeek();
    if (!this.avatar.advanceClip(dtMs)) return false;
    if (this.countdown > 0) {
      this.countdown--;
    } else {
      this.countdown = GRID_INTERVAL_FRAMES;
      this.refreshCollider();
    }

    return true;
  }

  flushSeek(): void {
    if (this.seekSettledAt === 0) return;
    this.seekSettledAt = 0;
    this.countdown = GRID_INTERVAL_FRAMES;
    this.refreshCollider();
  }

  private settleSeek(): void {
    if (this.seekSettledAt === 0 || performance.now() < this.seekSettledAt) return;
    this.flushSeek();
  }

  private ensureActive(): void {
    if (this.avatar.clipIndex < 0) this.select(0);
  }

  private refreshCollider(): void {
    const spec = this.spec;
    const collider = this.avatar.collider;
    const handle = this.avatar.handle;
    if (!spec || !collider || !handle) return;
    const collision = handle.collision();
    if (!collision || collision.vertices.length !== collider.mesh?.vertices.length) return;
    const mesh = reindexMeshCollider(collision.vertices, spec);
    if (!mesh) return;
    collider.mesh = mesh;
    this.hooks.installCollider(mesh);
  }
}
