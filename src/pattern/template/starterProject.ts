import { createDefaultProject } from '../../core/model/defaults';
import type { Project } from '../../core/model/types';
import { tShirtTemplate } from './tShirtTemplate';

/** Fresh project carrying the default garment so the scene opens dressed. */
export function createStarterProject(): Project {
  const project = createDefaultProject();
  const fabric = Object.values(project.fabrics)[0];
  if (fabric) project.pattern = tShirtTemplate.generate(tShirtTemplate.defaults, fabric.id);
  return project;
}
