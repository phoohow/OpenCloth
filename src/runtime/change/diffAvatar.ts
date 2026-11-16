import type { Project } from '@/model/types';
import { avatarBodySignature } from './buildSignatures';
import type { DiffTarget } from './diffTypes';
import { sameJson } from './sameJson';

/** Body fields the renderer re-reads without rebuilding anything. */
function lookOf(project: Project): unknown {
  const { display, name, appearance, softBody } = project.avatar;
  return { display, name, appearance, softBody };
}

/** Reports what the body revision changed: its build, its look and its placement. */
export function diffAvatar(prev: Project, next: Project, out: DiffTarget): void {
  if (avatarBodySignature(prev.avatar) !== avatarBodySignature(next.avatar)) out.aspects.add('avatar.body');
  if (!sameJson(lookOf(prev), lookOf(next))) out.aspects.add('avatar.look');
  if (!sameJson(prev.avatar.transform ?? null, next.avatar.transform ?? null)) out.aspects.add('avatar.transform');
}
