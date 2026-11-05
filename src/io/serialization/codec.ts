import type { Project } from '@/model/types';
import { PROJECT_FORMAT_VERSION } from '@/model';
import { normalizeFabrics, normalizeLayers, normalizePattern, normalizePoms } from '@/model';

/** Encodes and decodes a Project as .ocproj.json. */
export const projectCodec = {
  /** Always stamps the current format version, without touching the argument. */
  encode(project: Project): string {
    const draft = JSON.parse(JSON.stringify(project)) as Project;
    draft.formatVersion = PROJECT_FORMAT_VERSION;
    return JSON.stringify(draft, null, 2);
  },

  /**
   * Reads a current-schema document and fills optional fields with defaults. A file written by
   * a different format version is refused rather than half-read.
   *
   * Topology is deliberately not validated here: a pattern with a broken outline should still
   * open so the problem list can show it, rather than locking the user out of their own file.
   */
  decode(json: string): Project {
    const raw = JSON.parse(json);
    if (!raw.meta || !raw.pattern || !raw.fabrics || !raw.avatar || !raw.scene) {
      throw new Error('无效的工程文件：缺少必要字段');
    }
    if (raw.formatVersion !== PROJECT_FORMAT_VERSION) {
      throw new Error(
        `工程文件 formatVersion 必须为 ${PROJECT_FORMAT_VERSION}，当前为 ${String(raw.formatVersion)}`,
      );
    }
    const project = raw as Project;
    project.pattern = normalizePattern(project.pattern);
    project.fabrics = normalizeFabrics(project.fabrics);
    project.poms = normalizePoms(project.poms);
    project.layerThicknessCm = normalizeLayers(project.layerThicknessCm);
    project.formatVersion = PROJECT_FORMAT_VERSION;
    return project;
  },
};

export {
  downloadTextFile, downloadBytesFile, readFileAsText, readFileAsDataUrl,
} from '@/common/platform';
