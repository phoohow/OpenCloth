import type { Project } from '@/model/types';
import { normalizeFabrics, normalizeLayers, normalizePattern, normalizePoms } from '@/model';

/** Encodes and decodes a Project as .ocproj. */
export const projectCodec = {
  /** Serializes the project without touching the argument. */
  encode(project: Project): string {
    return JSON.stringify(project, null, 2);
  },

  /** Reads a project document and fills optional fields with defaults. */
  decode(json: string): Project {
    const raw = JSON.parse(json);
    if (!raw.meta || !raw.pattern || !raw.fabrics || !raw.avatar || !raw.scene) {
      throw new Error('无效的工程文件：缺少必要字段');
    }
    const project = raw as Project;
    project.pattern = normalizePattern(project.pattern);
    project.fabrics = normalizeFabrics(project.fabrics);
    project.poms = normalizePoms(project.poms);
    project.layerThicknessCm = normalizeLayers(project.layerThicknessCm);
    return project;
  },
};

export {
  downloadTextFile, downloadBytesFile, readFileAsText, readFileAsDataUrl,
} from '@/base/platform';
