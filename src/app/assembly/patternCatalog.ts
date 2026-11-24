import type { Pattern } from '@/model/types';
import type { GarmentTemplate } from '@/pattern';

import {
  parsePatternFile, patternFileToTemplate, type PatternFile,
} from '@/io/codec';

const SOURCES: Record<string, unknown> = import.meta.glob(
  '/assets/patterns/*.ocpat',
  { query: '?raw', import: 'default', eager: true },
);

const FILES = scanFolder().sort((a, b) =>
  (a.file.order ?? Number.MAX_SAFE_INTEGER) - (b.file.order ?? Number.MAX_SAFE_INTEGER)
  || a.path.localeCompare(b.path));

export const FILE_TEMPLATES: GarmentTemplate[] = FILES.map(({ file }) =>
  patternFileToTemplate(file, 'file'));

interface ScannedFile {
  path: string;
  file: PatternFile;
}

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

export function templatePattern(key?: string, fabricId = 'fabric_default'): Pattern {
  const template = key
    ? FILE_TEMPLATES.find(item => item.key === key)
    : FILE_TEMPLATES[0];
  if (!template) {
    throw new Error(key ? `未知的版型：${key}` : '默认文件夹里没有版型文件');
  }

  return template.generate(fabricId);
}
