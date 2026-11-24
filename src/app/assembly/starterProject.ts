import type { Project } from '@/model/types';

import { FILE_TEMPLATES } from '@/app/assembly/patternCatalog';
import { createDefaultProject } from '@/model';

export function createStarterProject(): Project {
  const project = createDefaultProject();
  const fabric = Object.values(project.fabrics)[0];
  const template = FILE_TEMPLATES[0];
  if (fabric && template) {
    project.pattern = template.generate(fabric.id);
    project.pattern.templateKey = template.key;
  }

  return project;
}
