import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'src');
const IMPORT_SPEC = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const FORBIDDEN_EXTERNAL = ['three', 'three/webgpu', 'three/tsl', 'react', 'react-dom', 'zustand'];

function collect(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collect(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function specifiers(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(IMPORT_SPEC)].map(match => match[1]);
}

describe('architecture', () => {
  it('keeps common free of business and UI dependencies', () => {
    const common = join(SRC, 'common');
    expect(existsSync(common)).toBe(true);
    const violations: string[] = [];
    for (const file of collect(common)) {
      for (const spec of specifiers(file)) {
        if (spec.startsWith('.') || spec.startsWith('@/common')) {
          const base = spec.startsWith('@/common')
            ? join(SRC, spec.slice(2))
            : resolve(dirname(file), spec);
          const inside = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]
            .map(c => c.replace(/\\/g, '/'))
            .some(c => c.startsWith(common.replace(/\\/g, '/')) && existsSync(c));
          if (!inside) violations.push(`${relative(SRC, file)} -> ${spec}`);
        } else if (FORBIDDEN_EXTERNAL.includes(spec)) {
          violations.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps core/model independent of upper layers', () => {
    const violations: string[] = [];
    for (const file of collect(join(SRC, 'model'))) {
      for (const spec of specifiers(file)) {
        if (/(?:\.\.\/)+(?:pattern|ui|render|sim|io)\b/.test(spec)
          || /^@\/(?:pattern|ui|render|sim|io)\b/.test(spec)) {
          violations.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('passes the architecture guard against its baseline', () => {
    expect(() => execFileSync(
      process.execPath,
      ['scripts/check-architecture.mjs', '--check'],
      { cwd: ROOT, stdio: 'pipe' },
    )).not.toThrow();
  });
});
