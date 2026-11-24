const ALL_ASPECTS: readonly Aspect[] = [
  'cloth.geometry', 'cloth.constraints', 'cloth.fabric', 'cloth.marking', 'cloth.visibility',
  'cloth.layer', 'avatar.body', 'avatar.look', 'avatar.transform', 'scene.light',
  'scene.environment', 'scene.simulation', 'scene.references', 'scene.floor', 'scene.camera',
];

export type Aspect =
  | 'cloth.geometry'
  | 'cloth.constraints'
  | 'cloth.fabric'
  | 'cloth.marking'
  | 'cloth.visibility'
  | 'cloth.layer'
  | 'avatar.body'
  | 'avatar.look'
  | 'avatar.transform'
  | 'scene.light'
  | 'scene.environment'
  | 'scene.simulation'
  | 'scene.references'
  | 'scene.floor'
  | 'scene.camera';

export interface ChangeDetail {
  lightIds?: Iterable<string>;
  lightStructure?: boolean;
}

export class ChangeSet {
  private constructor(
    private readonly aspects: ReadonlySet<Aspect>,
    readonly panelIds: ReadonlySet<string>,
    readonly lightIds: ReadonlySet<string>,
    readonly lightStructure: boolean,
  ) {}

  static empty(): ChangeSet {
    return new ChangeSet(new Set(), new Set(), new Set(), false);
  }

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

  list(): Aspect[] {
    return [...this.aspects];
  }
}
