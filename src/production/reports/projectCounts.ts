import type { Project } from '@/model/types';

export interface ProjectCounts {
  panels: number;
  seams: number;
  fabrics: number;
  sizes: number;
}

export function projectCounts(project: Project): ProjectCounts {
  return {
    panels: Object.keys(project.pattern.panels).length,
    seams: Object.keys(project.pattern.seams).length,
    fabrics: Object.keys(project.fabrics).length,
    sizes: (project.sizes ?? []).length,
  };
}
