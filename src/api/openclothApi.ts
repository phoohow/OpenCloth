import type { Project } from '@/model/types';
import { projectCodec } from '@/io/serialization';
import { buildPlmPackage, type PlmPackage } from '@/io/exporters';
import { projectCounts } from '@/io';
import { useProjectStore } from '@/store';

/** Project summary exposed to automation clients. */
export interface OpenClothSummary {
  name: string;
  panels: number;
  seams: number;
  fabrics: number;
  sizes: number;
}

/** Browser automation surface installed as `window.opencloth`. */
export interface OpenClothApi {
  version: string;
  getProject(): Project;
  getProjectJson(): string;
  loadProjectJson(json: string): void;
  getSummary(): OpenClothSummary;
  getPlmPackage(): PlmPackage;
}

declare global {
  interface Window {
    opencloth?: OpenClothApi;
  }
}

/** Installs the read/load facade used by PLM scripts and browser automation. */
export function installPublicApi(): void {
  if (typeof window === 'undefined') return;
  window.opencloth = {
    version: '1.0',
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
