/**
 * Typed description of what one edit changed. Consumers dispatch on an aspect instead of
 * comparing string signatures of the whole project.
 */
export type Aspect =
  /** Panel meshes and the merged particle layout. */
  | 'cloth.geometry'
  /** Seam pairings, closing darts and fold creases. */
  | 'cloth.constraints'
  /** Material records, prints and the render mode. */
  | 'cloth.fabric'
  /** Topstitch, trim and notch overlays. */
  | 'cloth.marking'
  /** Panel visibility. */
  | 'cloth.visibility'
  /** Construction-layer clearance and collision layers. */
  | 'cloth.layer'
  /** Body shape, pose and soft-body deformation. */
  | 'avatar.body'
  /** Skin appearance, display name and scene transform. */
  | 'avatar.look'
  | 'scene.light'
  | 'scene.render'
  | 'scene.simulation'
  | 'scene.environment'
  | 'scene.references';

/** Every aspect, used when the previous state is unknown. */
const ALL_ASPECTS: readonly Aspect[] = [
  'cloth.geometry', 'cloth.constraints', 'cloth.fabric', 'cloth.marking', 'cloth.visibility',
  'cloth.layer', 'avatar.body', 'avatar.look', 'scene.light', 'scene.render', 'scene.simulation',
  'scene.environment', 'scene.references',
];

/** What one project revision changed, and which panels it touched. */
export class ChangeSet {
  private constructor(
    private readonly aspects: ReadonlySet<Aspect>,
    /** Panels the change is about; empty means the aspect is not panel-scoped. */
    readonly panelIds: ReadonlySet<string>,
  ) { }

  static empty(): ChangeSet {
    return new ChangeSet(new Set(), new Set());
  }

  /** Every aspect, for a load or any change whose diff is unknown. */
  static all(panelIds: Iterable<string> = []): ChangeSet {
    return new ChangeSet(new Set(ALL_ASPECTS), new Set(panelIds));
  }

  static of(aspects: Iterable<Aspect>, panelIds: Iterable<string> = []): ChangeSet {
    return new ChangeSet(new Set(aspects), new Set(panelIds));
  }

  has(aspect: Aspect): boolean {
    return this.aspects.has(aspect);
  }

  /** True when the aspect changed and, for a panel-scoped aspect, the panel is among those touched. */
  affects(aspect: Aspect, panelId: string): boolean {
    if (!this.aspects.has(aspect)) return false;
    return this.panelIds.size === 0 || this.panelIds.has(panelId);
  }

  /** Aspects of this change, for logging and tests. */
  list(): Aspect[] {
    return [...this.aspects];
  }
}
