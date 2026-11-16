import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FILE_TEMPLATES, parsePatternFile, type PatternFile } from '@/pattern/template';

/** Folder Vite scans for template files. */
const PRESET_DIR = fileURLToPath(new URL('../../../assets/patterns/', import.meta.url));

/** Every template file on disk, keyed by its catalogue key. */
function filesOnDisk(): Map<string, PatternFile> {
  const out = new Map<string, PatternFile>();
  for (const name of readdirSync(PRESET_DIR).filter(entry => entry.endsWith('.ocpat'))) {
    const { file } = parsePatternFile(readFileSync(join(PRESET_DIR, name), 'utf8'));
    out.set(file.key, file);
  }
  return out;
}

/** Number of template files in the folder, repeated keys included. */
const fileCount = (): number =>
  readdirSync(PRESET_DIR).filter(name => name.endsWith('.ocpat')).length;

describe('garment template catalogue', () => {
  it('loads one template per file in the default folder', () => {
    expect(FILE_TEMPLATES).toHaveLength(fileCount());
  });

  it('gives every file a unique key', () => {
    expect(filesOnDisk().size).toBe(fileCount());
  });

  it('keeps each template consistent with its file', () => {
    const files = filesOnDisk();
    for (const template of FILE_TEMPLATES) {
      const file = files.get(template.key);
      expect(file, template.key).toBeDefined();
      expect(template.name).toBe(file!.name);
      expect(template.summary).toBe(file!.summary);
      expect(template.icon).toBe(file!.icon ?? 'panel');
      expect(template.params).toEqual(file!.params);
      expect(template.source).toBe('file');
    }
  });

  it('orders templates by the order declared in the files', () => {
    const files = filesOnDisk();
    const orders = FILE_TEMPLATES.map(
      template => files.get(template.key)!.order ?? Number.MAX_SAFE_INTEGER,
    );
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
