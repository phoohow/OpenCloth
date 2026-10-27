import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES, iconSource } from '../../src/ui/icons';

const ICON_DIR = fileURLToPath(new URL('../../assets/icons', import.meta.url));

describe('UI icon set', () => {
  it('has one assets/icons file per icon name, and no file without a name', () => {
    const files = readdirSync(ICON_DIR)
      .filter(name => name.endsWith('.svg'))
      .map(name => name.replace(/\.svg$/, ''))
      .sort();
    expect(files).toEqual([...ICON_NAMES].sort());
  });

  it('names every icon once', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it('draws every icon on the shared 24 grid in the current text color', () => {
    for (const name of ICON_NAMES) {
      const source = iconSource(name);
      expect(source, name).toContain('viewBox="0 0 24 24"');
      expect(source, name).toContain('stroke="currentColor"');
    }
  });
});
