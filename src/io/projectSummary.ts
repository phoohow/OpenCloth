import type { Project } from '@/model/types';

/** Counts of the main records in a project, shared by PLM exports and the browser API. */
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
