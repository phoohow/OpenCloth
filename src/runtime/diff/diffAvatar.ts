import type { Project } from '@/model/types';
import type { DiffTarget } from '@/runtime/diff/diffTypes';

import { sameJson } from '@/runtime/diff/sameJson';
import { avatarBodySignature } from '@/runtime/engine/buildSignatures';

function lookOf(project: Project): unknown {
  const { display, name, appearance, softBody } = project.avatar;
  return { display, name, appearance, softBody };
}

export function diffAvatar(prev: Project, next: Project, out: DiffTarget): void {
  if (avatarBodySignature(prev.avatar) !== avatarBodySignature(next.avatar)) out.aspects.add('avatar.body');
  if (!sameJson(lookOf(prev), lookOf(next))) out.aspects.add('avatar.look');
  if (!sameJson(prev.avatar.transform ?? null, next.avatar.transform ?? null)) out.aspects.add('avatar.transform');
}
