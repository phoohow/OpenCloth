import type { Project } from '@/model/types';

import { normalizeFabrics, normalizeLayers, normalizePattern, normalizePoms } from '@/model';

export {
  downloadTextFile, downloadBytesFile, readFileAsText, readFileAsDataUrl,
} from '@/base/platform';

export const PROJECT_FILE_EXTENSION = '.ocproj';

export const projectCodec = {
  encode(project: Project): string {
    return JSON.stringify(project, null, 2);
  },

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
