import type { Project } from '@/model/types';

import { bodyLandmarks } from '@/avatar';
import { panelHeightOffsets } from '@/scene';
import { useMemo } from 'react';

export function useHeightOffsets(project: Project): ReadonlyMap<string, number> {
  const body = useMemo(() => bodyLandmarks(project.avatar.params), [project.avatar.params]);
  return useMemo(() => panelHeightOffsets(project.pattern, body), [project.pattern, body]);
}

export function useElement(_project: Project, nodeId: string) {
  const m = /^@(point|edge|internal|dart|notch|annotation|measurement|print|topstitch|trim):(.+)$/.exec(nodeId);
  if (!m) return null;
  return { kind: m[1], id: m[2] };
}
