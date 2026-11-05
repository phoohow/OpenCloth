import { PROJECT_FORMAT_VERSION } from '../core/model/format';

/** A project document as parsed from JSON, before any field is trusted. */
export type ProjectDocument = Record<string, unknown>;

/**
 * One migration step: takes a document from version N to N+1 and edits it in place.
 *
 * Steps only restructure what is already there (rename, move, split). Filling in defaults for
 * fields that did not exist stays in `codec`'s `normalize*`, which runs after the chain, so a
 * step never has to know the current shape of a record it does not touch.
 */
export type ProjectMigration = (document: ProjectDocument) => void;

/**
 * The chain, keyed by the version a step reads. Every version below the current one needs an
 * entry: a bumped `PROJECT_FORMAT_VERSION` without a step makes `migrateProjectDocument()` throw,
 * which turns "forgot to migrate" into a failing test instead of a half-read file.
 */
export const PROJECT_MIGRATIONS: Record<number, ProjectMigration> = {
  /**
   * 0 → 1: `formatVersion` itself arrived, together with `sizes`, `activeSizeId`, `poms` and
   * `layerThicknessCm`. All of them are optional and defaulted by the normalizers, so nothing
   * has to be restructured here. The step stays explicit so the chain has no gap and so a future
   * 1 → 2 has a neighbour to sit next to.
   */
  0: () => {},
};

/**
 * Applies every step from `from` up to `to`, stamping the reached version on the document.
 * `to` and `steps` are parameters so the chain itself can be tested across several versions.
 */
export function migrateProjectDocument(
  document: ProjectDocument,
  from: number,
  to = PROJECT_FORMAT_VERSION,
  steps: Record<number, ProjectMigration> = PROJECT_MIGRATIONS,
): void {
  for (let version = from; version < to; version++) {
    const step = steps[version];
    if (!step) {
      throw new Error(`工程文件格式版本 ${version} 缺少迁移步骤，无法读到 ${to}，请升级 OpenCloth 后再打开`);
    }
    step(document);
    document.formatVersion = version + 1;
  }
}
