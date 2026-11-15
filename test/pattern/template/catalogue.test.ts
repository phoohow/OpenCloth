import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GARMENT_TEMPLATES, PRESET_KEYS, parsePatternFile } from '@/pattern/template';

/** Folder Vite scans for bundled template files. */
const PRESET_DIR = fileURLToPath(new URL('../../../assets/patterns/', import.meta.url));

describe('garment template catalogue', () => {
  it('maps every file in the default folder to one listed template', () => {
    const names = readdirSync(PRESET_DIR)
      .filter(name => name.endsWith('.ocpat'))
      .map(name => name.replace(/\.ocpat$/, ''))
      .sort();
    expect(names).toEqual([...PRESET_KEYS].sort());
    expect(GARMENT_TEMPLATES.map(template => template.key)).toEqual([...PRESET_KEYS]);
  });

  it('keeps each file key and metadata consistent with its template', () => {
    for (const key of PRESET_KEYS) {
      const { file } = parsePatternFile(readFileSync(`${PRESET_DIR}${key}.ocpat`, 'utf8'));
      const template = GARMENT_TEMPLATES.find(item => item.key === key)!;
      expect(file.key).toBe(key);
      expect(template.name).toBe(file.name);
      expect(template.summary).toBe(file.summary);
      expect(template.icon).toBe(file.icon ?? 'panel');
      expect(template.params).toEqual(file.params);
      expect(template.source).toBe('file');
    }
  });
});
