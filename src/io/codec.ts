import type { LegacyLightConfig, Project } from '../core/model/types';
import { normalizeLightConfig } from '../core/model/defaults';

/** Encodes and decodes a Project as .ocproj.json. */
export const projectCodec = {
  encode(project: Project): string {
    return JSON.stringify(JSON.parse(JSON.stringify(project)), null, 2);
  },

  decode(json: string): Project {
    const raw = JSON.parse(json);
    if (!raw.meta || !raw.pattern || !raw.fabrics || !raw.avatar || !raw.scene) {
      throw new Error('无效的工程文件：缺少必要字段');
    }
    if (raw.meta.dataVersion !== 1) {
      throw new Error(`不支持的工程版本：${raw.meta.dataVersion}`);
    }
    const project = raw as Project;
    project.scene.lights = normalizeLightConfig(project.scene.lights as LegacyLightConfig);
    return project;
  },
};

/** Downloads text content as a browser file. */
export function downloadTextFile(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads a user-selected file as text. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
