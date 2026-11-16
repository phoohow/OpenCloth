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
  /** Body shape and pose the collision mesh and the drape wrap are built from. */
  | 'avatar.body'
  /** Skin appearance, display name and the soft-body switch; placement has its own aspect. */
  | 'avatar.look'
  /** Scene placement of the body, which the collision mesh follows. */
  | 'avatar.transform'
  /** Punctual lights. */
  | 'scene.light'
  /** Environment image, its backdrop and its strength. */
  | 'scene.environment'
  /** Cloth and drape parameters that drive the simulation. */
  | 'scene.simulation'
  /** Reference objects in the scene and where they sit. */
  | 'scene.references'
  /** Looping camera move played in the viewport. */
  | 'scene.camera';

/** Every aspect, used when the previous state is unknown. */
const ALL_ASPECTS: readonly Aspect[] = [
  'cloth.geometry', 'cloth.constraints', 'cloth.fabric', 'cloth.marking', 'cloth.visibility',
  'cloth.layer', 'avatar.body', 'avatar.look', 'avatar.transform', 'scene.light',
  'scene.environment', 'scene.simulation', 'scene.references', 'scene.camera',
];

/** Per-object detail a change carries beside its aspects. */
export interface ChangeDetail {
  /** Lights whose own fields changed; empty together with `lightStructure` means "every light". */
  lightIds?: Iterable<string>;
  /** True when a light was added, removed or changed type, so its slot has to be rebuilt. */
  lightStructure?: boolean;
}

/** What one project revision changed, and which objects it touched. */
export class ChangeSet {
  private constructor(
    private readonly aspects: ReadonlySet<Aspect>,
    /** Panels the change is about; empty means the aspect is not panel-scoped. */
    readonly panelIds: ReadonlySet<string>,
    /** Lights the change is about. */
    readonly lightIds: ReadonlySet<string>,
    /** Whether a light was added, removed or changed type. */
    readonly lightStructure: boolean,
  ) { }

  static empty(): ChangeSet {
    return new ChangeSet(new Set(), new Set(), new Set(), false);
  }

  /** Every aspect, for a load or any change whose diff is unknown. */
  static all(panelIds: Iterable<string> = []): ChangeSet {
    return new ChangeSet(new Set(ALL_ASPECTS), new Set(panelIds), new Set(), true);
  }

  static of(
    aspects: Iterable<Aspect>,
    panelIds: Iterable<string> = [],
    detail: ChangeDetail = {},
  ): ChangeSet {
    return new ChangeSet(
      new Set(aspects), new Set(panelIds), new Set(detail.lightIds ?? []), detail.lightStructure ?? false,
    );
  }

  has(aspect: Aspect): boolean {
    return this.aspects.has(aspect);
  }

  /** Aspects of this change, for logging and tests. */
  list(): Aspect[] {
    return [...this.aspects];
  }
}
