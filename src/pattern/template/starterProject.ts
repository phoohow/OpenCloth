import { createDefaultProject } from '@/model';
import type { Project } from '@/model/types';
import { defaultPattern } from '@/pattern/template/fileTemplates';

/** Fresh project carrying the first template's garment so the scene opens dressed. */
export function createStarterProject(): Project {
  const project = createDefaultProject();
  const fabric = Object.values(project.fabrics)[0];
  const pattern = fabric ? defaultPattern(fabric.id) : null;
  if (pattern) project.pattern = pattern;
  return project;
}

/** New project with an empty pattern and a hidden avatar; only the default lights remain. */
export function createBlankProject(): Project {
  const project = createDefaultProject();
  project.avatar = { ...project.avatar, display: 'hidden' };
  return project;
}
