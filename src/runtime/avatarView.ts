import type { Project, SkinAppearance, ObjectTransform } from '@/model/types';
import type { MeshCollider } from '@/avatar/collider';
import type { ClothSimInput } from '@/sim';
import { AvatarStage } from '@/runtime/avatarStage';
import { AvatarMotion, type AvatarMotionInfo } from '@/runtime/avatarMotion';
import { DynamicFitSampler } from '@/runtime/dynamicFitSampler';
import type { DynamicPressureFrame } from '@/analysis';
import type { PresenterHost } from '@/runtime/presenters/host';

/** Frames between two soft-body collision updates. */
const SOFT_UPDATE_INTERVAL = 8;

/** What the avatar view reads from the rest of the engine. */
export interface AvatarViewDeps {
  host: PresenterHost;
  /** Latest pressure samples, kept while a heatmap is on. */
  contact: () => Float32Array | null;
  /** Merged input the dynamic sampler reads per-particle pressure from. */
  clothInput: () => ClothSimInput | null;
  /** Pushes deformed body triangles into the solver's collision buffer. */
  updateCollider: (vertices: Float32Array) => void;
  /** Reinstalls the solver's mesh collider for a new body pose. */
  installCollider: (mesh: MeshCollider) => void;
  /** Runs after a pause or stop, where the engine rebinds soft deformation to the new pose. */
  onPoseSettled?: () => void;
}

/**
 * The dressed body: its stage in the scene, the motion clips that pose it, the soft deformation of
 * chest and abdomen, and the per-frame pressure samples taken while it moves.
 */
export class AvatarView {
  readonly stage = new AvatarStage();
  readonly motion: AvatarMotion;
  private readonly dynamicFit: DynamicFitSampler;
  /** Frames left before the soft body pushes its next collision update. */
  private softCountdown = 0;
  /** Whether the current body yields to cloth contact. */
  private softEnabled = false;
  /** Whether the body is drawn highlighted as the selected scene object. */
  private highlighted = false;

  constructor(private readonly deps: AvatarViewDeps) {
    this.dynamicFit = new DynamicFitSampler({
      isAnimating: () => this.stage.isAnimating,
      clipTimeSeconds: () => this.stage.clipTimeSeconds,
      contact: deps.contact,
      clothInput: deps.clothInput,
    });
    this.motion = new AvatarMotion(this.stage, {
      installCollider: deps.installCollider,
      onPoseSettled: () => {
        this.softCountdown = 0;
        deps.onPoseSettled?.();
      },
    });
  }

  /** Collision mesh of the current body. */
  get collider() { return this.stage.collider; }

  /** Asset owning the body object, clips and soft deformation. */
  get handle() { return this.stage.handle; }

  /** Whether the body is drawn opaque in the scene. */
  objectVisible(): boolean { return this.stage.objectVisible(); }

  get isAnimating(): boolean { return this.stage.isAnimating; }

  get clipTimeSeconds(): number { return this.stage.clipTimeSeconds; }

  /** Whether the body currently carries a selection overlay. */
  get hasOverlay(): boolean { return this.stage.hasOverlay; }

  /** Replaces the scene body and re-applies its display, transform and highlight. */
  async build(project: Project): Promise<void> {
    await this.stage.build(project.avatar, this.deps.host);
    this.stage.applyDisplay(project.avatar.display);
    this.stage.place(project.avatar.transform);
    this.stage.highlight(this.highlighted);
    this.softCountdown = 0;
    this.motion.reset();
    this.dynamicFit.clear();
  }

  /** Enables or restores the compressible chest and abdomen for the current body. */
  applySoftness(project: Project): void {
    this.softEnabled = project.avatar.softBody === true;
    this.softCountdown = 0;
    if (this.softEnabled) return;
    this.handle?.restore?.();
    this.uploadSoftBodyCollider();
  }

  /**
   * Advances the soft deformation from the latest cloth contact; the animation drives the body
   * pose, so this pauses while a clip plays.
   */
  updateSoftBody(positions: Float32Array, contact: Float32Array | null): void {
    if (!contact || !this.softEnabled || this.stage.isAnimating) return;
    if (this.softCountdown > 0) {
      this.softCountdown--;
      return;
    }
    this.softCountdown = SOFT_UPDATE_INTERVAL;
    if (this.handle?.deform?.(positions, contact)) this.uploadSoftBodyCollider();
  }

  /** Restores the undeformed body. */
  restoreSoftBody(): void {
    this.handle?.restore?.();
    this.uploadSoftBodyCollider();
  }

  /** Takes one pressure sample; off while no heatmap is on. */
  sampleDynamicFit(): void {
    this.dynamicFit.sample();
  }

  animationClips(): string[] { return this.motion.clipNames(); }
  animationInfo(): AvatarMotionInfo { return this.motion.info(); }
  playAnimation(index: number): boolean { return this.motion.play(index); }
  pauseAnimation(): void { this.motion.pause(); }
  stopAnimation(): void { this.motion.stop(); }
  seekAnimation(ms: number): void { this.motion.seek(ms); }

  /** Advances the body animation; true when the pose moved. */
  advanceAnimation(dtMs: number): boolean { return this.motion.advance(dtMs); }

  setDynamicSampling(enabled: boolean): void { this.dynamicFit.setEnabled(enabled); }
  clearDynamicSamples(): void { this.dynamicFit.clear(); }
  get dynamicSamples(): readonly DynamicPressureFrame[] { return this.dynamicFit.samples; }
  get dynamicSampleCount(): number { return this.dynamicFit.count; }

  /** Moves and rotates the body in the scene. */
  applyTransform(avatar: { transform?: ObjectTransform }): void {
    this.stage.place(avatar.transform);
  }

  applyDisplay(display: 'visible' | 'hidden' | 'translucent'): void {
    this.stage.applyDisplay(display);
  }

  /** Shows or hides the simplified body proxy built from the current measurements. */
  applySimplifiedBody(visible: boolean, avatar: Project['avatar']): void {
    this.stage.setSimplifiedBody(visible, avatar);
  }

  applyAppearance(appearance?: SkinAppearance): void {
    this.stage.applyAppearance(appearance);
  }

  /** Tints the body while it is the selected scene object. */
  setHighlighted(on: boolean): void {
    if (this.highlighted === on && (on ? this.stage.hasOverlay : true)) return;
    this.highlighted = on;
    this.stage.highlight(on);
  }

  /** Removes the body from the scene. */
  detach(): void {
    this.stage.detach(this.deps.host);
  }

  /** Pushes the current body triangles into the solver's collision buffer. */
  private uploadSoftBodyCollider(): void {
    const mesh = this.stage.collider?.mesh;
    if (mesh) this.deps.updateCollider(mesh.vertices);
  }
}
