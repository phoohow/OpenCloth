import type { Project } from '../core/model/types';
import { LEGACY_PROJECT_FORMAT_VERSION, PROJECT_FORMAT_VERSION } from '../core/model/format';
import { normalizeFabrics, normalizeLayers, normalizePattern, normalizePoms } from '../core/model/normalize';
import { migrateProjectDocument } from './migrations';

/** Encodes and decodes a Project as .ocproj.json. */
export const projectCodec = {
  /** Always stamps the current format version, without touching the argument. */
  encode(project: Project): string {
    const draft = JSON.parse(JSON.stringify(project)) as Project;
    draft.formatVersion = PROJECT_FORMAT_VERSION;
    return JSON.stringify(draft, null, 2);
  },

  /**
   * Normalizes a parsed document to the current schema. Files without `formatVersion`
   * are read as the legacy version; a newer version is refused rather than half-read.
   * Between the two, `io/migrations.ts` walks the document up to the current version.
   *
   * Topology is deliberately not validated here: a pattern with a broken outline should still
   * open so the problem list can show it, rather than locking the user out of their own file.
   */
  decode(json: string): Project {
    const raw = JSON.parse(json);
    if (!raw.meta || !raw.pattern || !raw.fabrics || !raw.avatar || !raw.scene) {
      throw new Error('无效的工程文件：缺少必要字段');
    }
    const version = readFormatVersion(raw.formatVersion);
    if (version > PROJECT_FORMAT_VERSION) {
      throw new Error(`工程文件格式版本 ${version} 高于本版本支持的 ${PROJECT_FORMAT_VERSION}，请升级 OpenCloth 后再打开`);
    }
    migrateProjectDocument(raw, version);
    const project = raw as Project;
    project.pattern = normalizePattern(project.pattern);
    project.fabrics = normalizeFabrics(project.fabrics);
    project.poms = normalizePoms(project.poms);
    project.layerThicknessCm = normalizeLayers(project.layerThicknessCm);
    project.formatVersion = PROJECT_FORMAT_VERSION;
    return project;
  },
};

/** Reads the declared version, treating a missing field as the version before it existed. */
function readFormatVersion(value: unknown): number {
  if (value === undefined) return LEGACY_PROJECT_FORMAT_VERSION;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('无效的工程文件：formatVersion 不是有效版本号');
  }
  return value;
}

/** Downloads text content as a browser file. */
export function downloadTextFile(filename: string, content: string, mime = 'application/json'): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

/** Downloads binary content, such as a generated PDF, as a browser file. */
export function downloadBytesFile(filename: string, content: Uint8Array, mime: string): void {
  // `slice()` copies into a fresh ArrayBuffer, which is what BlobPart accepts.
  downloadBlob(filename, new Blob([content.slice()], { type: mime }));
}

function downloadBlob(filename: string, blob: Blob): void {
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

/** Reads a user-selected file as a data URL. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
