import type { AvatarStage } from './avatarStage';
import { reindexMeshCollider, type MeshCollider, type MeshGridSpec } from '../../avatar/collider/meshCollider';
import { meshTrianglesFromObject } from './avatarMeshCollider';

/** What the motion driver needs from the engine: one collider sink and one pose-settled hook. */
export interface AvatarMotionHooks {
  /** Installs a freshly indexed grid into the running solver. */
  installCollider: (mesh: MeshCollider) => void;
  /** Runs after a pause or stop, where the engine rebinds soft deformation to the new pose. */
  onPoseSettled: () => void;
}

/** Playback state published to the animation panel. */
export interface AvatarMotionInfo {
  clips: string[];
  clipIndex: number;
  playing: boolean;
  timeMs: number;
  durationMs: number;
}

/**
 * Drives the body animation: clip control, playback state and the collision grid that has to be
 * re-bucketed when the pose moves. The grid is refreshed every fifth advanced frame — the re-index
 * is far heavier than a solver step, and a pose that only drifts a millimetre does not need it.
 */
export class AvatarMotion {
  /** Grid the animated collider re-buckets into; null when the body has no mesh collider. */
  private spec: MeshGridSpec | null = null;
  /** Steps left before the next re-index. */
  private countdown = 0;

  constructor(private readonly avatar: AvatarStage, private readonly hooks: AvatarMotionHooks) {}

  /** Re-reads the grid from the body that was just built and clears the throttle. */
  reset(): void {
    const mesh = this.avatar.collider?.mesh;
    this.spec = mesh ? { origin: [...mesh.origin], cell: mesh.cell, dims: [...mesh.dims] } : null;
    this.countdown = 0;
  }

  /** Names of the clips the current body carries; empty for a static body. */
  clipNames(): string[] {
    return this.avatar.animationClips.map((clip, i) => clip.name || `动作 ${i + 1}`);
  }

  /** Playback state, published to the panels. */
  info(): AvatarMotionInfo {
    return {
      clips: this.clipNames(),
      clipIndex: this.avatar.clipIndex,
      playing: this.avatar.isAnimating,
      timeMs: this.avatar.clipTimeSeconds * 1000,
      durationMs: this.avatar.clipDurationSeconds * 1000,
    };
  }

  /** Starts a clip; false when the index is out of range. */
  play(index: number): boolean {
    return this.avatar.playClip(index);
  }

  /** Holds the pose without advancing the clip. */
  pause(): void {
    this.avatar.pauseClip();
    this.hooks.onPoseSettled();
  }

  /** Drops the clip and leaves the body at its last pose. */
  stop(): void {
    this.avatar.stopClip();
    this.hooks.onPoseSettled();
  }

  /** Seeks the active clip to a time in milliseconds. */
  seek(ms: number): void {
    this.avatar.seekClip(ms);
  }

  /** Advances the clip and refreshes the collision grid when the throttle allows. */
  advance(dtMs: number): boolean {
    if (!this.avatar.advanceClip(dtMs)) return false;
    if (this.countdown > 0) {
      this.countdown--;
    } else {
      this.countdown = 4;
      this.refreshCollider();
    }
    return true;
  }

  /** Re-buckets the posed body triangles into the grid the solver collides against. */
  private refreshCollider(): void {
    const group = this.avatar.object;
    const spec = this.spec;
    const collider = this.avatar.collider;
    if (!group || !spec || !collider) return;
    const triangles = meshTrianglesFromObject(group);
    if (triangles.length !== collider.mesh?.vertices.length) return;
    const mesh = reindexMeshCollider(triangles, spec);
    if (!mesh) return;
    collider.mesh = mesh;
    this.hooks.installCollider(mesh);
  }
}
