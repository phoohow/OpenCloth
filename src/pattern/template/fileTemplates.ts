import type { Pattern } from '@/model/types';
import type { GarmentTemplate } from '@/pattern/template/garmentTemplate';
import {
  parsePatternFile, patternFileToTemplate, type PatternFile,
} from '@/pattern/template/patternFile';

/** Raw contents of every `.ocpat` in the default folder, keyed by file path. */
const SOURCES: Record<string, unknown> = import.meta.glob(
  '/assets/patterns/*.ocpat',
  { query: '?raw', import: 'default', eager: true },
);

/** One parsed file and the path it came from. */
interface ScannedFile {
  path: string;
  file: PatternFile;
}

/** Parses every file in the folder, skipping unreadable ones and repeated keys. */
function scanFolder(): ScannedFile[] {
  const seen = new Set<string>();
  const out: ScannedFile[] = [];
  for (const path of Object.keys(SOURCES).sort()) {
    try {
      const raw = SOURCES[path]!;
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const { file } = parsePatternFile(text);
      if (seen.has(file.key)) {
        console.warn(`Template key "${file.key}" repeats; ${path} is skipped.`);
        continue;
      }
      seen.add(file.key);
      out.push({ path, file });
    } catch (error) {
      console.error(`Template ${path} failed to load:`, error);
    }
  }
  return out;
}

/** Files in display order: declared `order` first, then file name. */
const FILES = scanFolder().sort((a, b) =>
  (a.file.order ?? Number.MAX_SAFE_INTEGER) - (b.file.order ?? Number.MAX_SAFE_INTEGER)
  || a.path.localeCompare(b.path));

/** Every template in the default folder, in display order. */
export const FILE_TEMPLATES: GarmentTemplate[] = FILES.map(({ file }) =>
  patternFileToTemplate(file, 'file'));

/** Builds a fresh pattern from one file; without a key it takes the first file. */
export function templatePattern(key?: string, fabricId = 'fabric_default'): Pattern {
  const template = key
    ? FILE_TEMPLATES.find(item => item.key === key)
    : FILE_TEMPLATES[0];
  if (!template) {
    throw new Error(key ? `未知的版型：${key}` : '默认文件夹里没有版型文件');
  }
  return template.generate(fabricId);
}
