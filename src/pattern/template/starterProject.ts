import { createDefaultProject } from '@/model';
import type { Project } from '@/model/types';
import { tShirtTemplate } from '@/pattern/template/tShirtTemplate';

/** Fresh project carrying the default garment so the scene opens dressed. */
export function createStarterProject(): Project {
  const project = createDefaultProject();
  const fabric = Object.values(project.fabrics)[0];
  if (fabric) project.pattern = tShirtTemplate.generate(tShirtTemplate.defaults, fabric.id);
  return project;
}

/** New project with an empty pattern and a hidden avatar; only the default lights remain. */
export function createBlankProject(): Project {
  const project = createDefaultProject();
  project.avatar = { ...project.avatar, display: 'hidden' };
  return project;
}
