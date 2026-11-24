import type { Project } from '@/model/types';

import { projectCodec } from '@/io/serialization';
import { projectCounts } from '@/production';
import { buildPlmPackage, type PlmPackage } from '@/production/reports/integration';
import { useProjectStore } from '@/store';

export interface OpenClothSummary {
  name: string;
  panels: number;
  seams: number;
  fabrics: number;
  sizes: number;
}

export interface OpenClothApi {
  getProject(): Project;
  getProjectJson(): string;
  loadProjectJson(json: string): void;
  getSummary(): OpenClothSummary;
  getPlmPackage(): PlmPackage;
}

export function installPublicApi(): void {
  if (typeof window === 'undefined') return;
  window.opencloth = {
    getProject: () => structuredClone(useProjectStore.getState().project),
    getProjectJson: () => projectCodec.encode(useProjectStore.getState().project),
    loadProjectJson: (json: string) => {
      useProjectStore.getState().loadProject(projectCodec.decode(json));
    },
    getSummary: () => {
      const project = useProjectStore.getState().project;
      return { name: project.meta.name, ...projectCounts(project) };
    },
    getPlmPackage: () => buildPlmPackage(useProjectStore.getState().project),
  };
}

declare global {
  interface Window {
    opencloth?: OpenClothApi;
  }
}
