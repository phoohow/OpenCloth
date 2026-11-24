import type { DynamicPressureFrame } from '@/analysis';
import type { MeshCollider } from '@/avatar/collider';
import type { Project, SkinAppearance, ObjectTransform } from '@/model/types';
import type { PresenterHost } from '@/runtime/world/presenters/host';
import type { ClothSimInput } from '@/sim/common';

import { AvatarMotion, type AvatarMotionInfo } from '@/runtime/engine/avatarMotion';
import { DynamicFitSampler } from '@/runtime/engine/dynamicFitSampler';
import { AvatarStage } from '@/runtime/world/avatarStage';

const SOFT_UPDATE_INTERVAL = 8;

export interface AvatarViewDeps {
  host: PresenterHost;
  contact: () => Float32Array | null;
  clothInput: () => ClothSimInput | null;
  updateCollider: (vertices: Float32Array) => void;
  installCollider: (mesh: MeshCollider) => void;
  onPoseSettled?: () => void;
}

export class AvatarView {
  readonly stage = new AvatarStage();
  readonly motion: AvatarMotion;
  private readonly dynamicFit: DynamicFitSampler;
  private softCountdown = 0;
  private softEnabled = false;
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

  get collider() { return this.stage.collider; }

  get handle() { return this.stage.handle; }

  objectVisible(): boolean { return this.stage.objectVisible(); }

  get isAnimating(): boolean { return this.stage.isAnimating; }

  get clipTimeSeconds(): number { return this.stage.clipTimeSeconds; }

  get hasOverlay(): boolean { return this.stage.hasOverlay; }

  async build(project: Project): Promise<void> {
    await this.stage.build(project.avatar, this.deps.host);
    this.stage.applyDisplay(project.avatar.display);
    this.stage.place(project.avatar.transform);
    this.stage.highlight(this.highlighted);
    this.softCountdown = 0;
    this.motion.reset();
    this.dynamicFit.clear();
  }

  applySoftness(project: Project): void {
    this.softEnabled = project.avatar.softBody === true;
    this.softCountdown = 0;
    this.handle?.setSoftBody?.(this.softEnabled);
    if (!this.softEnabled) this.uploadSoftBodyCollider();
  }

  updateSoftBody(positions: Float32Array, contact: Float32Array | null): void {
    if (!contact || !this.softEnabled || this.stage.isAnimating) return;
    if (this.softCountdown > 0) {
      this.softCountdown--;
      return;
    }

    this.softCountdown = SOFT_UPDATE_INTERVAL;
    if (this.handle?.deform?.(positions, contact)) this.uploadSoftBodyCollider();
  }

  restoreSoftBody(): void {
    this.handle?.restore?.();
    this.uploadSoftBodyCollider();
  }

  sampleDynamicFit(): void {
    this.dynamicFit.sample();
  }

  animationInfo(): AvatarMotionInfo { return this.motion.info(); }
  playAnimation(index: number): boolean { return this.motion.play(index); }
  selectAnimation(index: number): boolean { return this.motion.select(index); }
  pauseAnimation(): void { this.motion.pause(); }
  stopAnimation(): void { this.motion.stop(); }
  seekAnimation(ms: number): void { this.motion.seek(ms); }
  stepAnimation(frameMs: number): void { this.motion.step(frameMs); }
  rewindAnimation(): void { this.motion.rewind(); }
  settleAnimationSeek(): void { this.motion.flushSeek(); }

  advanceAnimation(dtMs: number): boolean { return this.motion.advance(dtMs); }

  setDynamicSampling(enabled: boolean): void { this.dynamicFit.setEnabled(enabled); }
  clearDynamicSamples(): void { this.dynamicFit.clear(); }
  get dynamicSamples(): readonly DynamicPressureFrame[] { return this.dynamicFit.samples; }
  get dynamicSampleCount(): number { return this.dynamicFit.count; }

  applyTransform(avatar: { transform?: ObjectTransform }, refitCollider = true): void {
    if (!refitCollider) {
      this.stage.pose(avatar.transform);
      return;
    }

    this.stage.place(avatar.transform);
    const mesh = this.stage.collider?.mesh;
    if (mesh) this.deps.installCollider(mesh);
    this.motion.reset();
  }

  applyDisplay(display: 'visible' | 'hidden' | 'translucent'): void {
    this.stage.applyDisplay(display);
  }

  applySimplifiedBody(visible: boolean, avatar: Project['avatar']): void {
    this.stage.setSimplifiedBody(visible, avatar);
  }

  applyGirthLines(visible: boolean, avatar: Project['avatar']): void {
    this.stage.setGirthLines(visible, avatar);
  }

  applySkeleton(visible: boolean, avatar: Project['avatar']): void {
    this.stage.setSkeleton(visible, avatar);
  }

  applyAppearance(appearance?: SkinAppearance): void {
    this.stage.applyAppearance(appearance);
  }

  setHighlighted(on: boolean): void {
    if (this.highlighted === on && (on ? this.stage.hasOverlay : true)) return;
    this.highlighted = on;
    this.stage.highlight(on);
  }

  detach(): void {
    this.stage.detach(this.deps.host);
  }

  private uploadSoftBodyCollider(): void {
    const mesh = this.stage.collider?.mesh;
    if (mesh) this.deps.updateCollider(mesh.vertices);
  }
}
