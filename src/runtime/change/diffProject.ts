import type { Project } from '@/model/types';
import { ChangeSet } from './changeSet';
import { diffAvatar } from './diffAvatar';
import { diffPattern } from './diffPattern';
import { diffScene } from './diffScene';
import type { DiffAccumulator } from './diffTypes';

/**
 * Compares two project revisions and reports the runtime concerns that have to re-read something.
 * Each pass owns one part of the document; this function only merges their findings.
 */
export function diffProject(prev: Project, next: Project): ChangeSet {
  const out: DiffAccumulator = {
    aspects: new Set(), panelIds: new Set(), lightIds: new Set(), lightStructure: false,
  };
  diffPattern(prev, next, out);
  diffScene(prev, next, out);
  diffAvatar(prev, next, out);
  return ChangeSet.of(out.aspects, out.panelIds, {
    lightIds: out.lightIds, lightStructure: out.lightStructure,
  });
}
