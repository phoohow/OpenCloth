import type { Project } from '@/model/types';
import type { DiffAccumulator } from '@/runtime/diff/diffTypes';

import { ChangeSet } from '@/runtime/common';
import { diffAvatar } from '@/runtime/diff/diffAvatar';
import { diffPattern } from '@/runtime/diff/diffPattern';
import { diffScene } from '@/runtime/diff/diffScene';

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
