import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validatePattern, type Pattern } from '@/model';
import {
  encodePatternFile, instantiatePattern,
  parsePatternFile, patternFileToTemplate, presetPattern,
} from '@/pattern/template';
import { createStarterProject } from '@/pattern/template/starterProject';
import { AppendTemplateCommand } from '@/pattern/template/templateCommands';
import type { ProjectContext } from '@/model/types';

/** A realistic pattern with seams, drape and curved edges. */
function samplePattern(): Pattern {
  return presetPattern('tshirt');
}

/** A hand-written file that omits every optional collection and every panel scalar. */
function minimalFile(): string {
  return JSON.stringify({
    key: 'square',
    name: '方片',
    pattern: {
      points: {
        p1: { id: 'p1', pos: { x: 0, y: 0 } },
        p2: { id: 'p2', pos: { x: 10, y: 0 } },
        p3: { id: 'p3', pos: { x: 10, y: 10 } },
        p4: { id: 'p4', pos: { x: 0, y: 10 } },
      },
      edges: {
        e1: { id: 'e1', type: 'line', startPointId: 'p1', endPointId: 'p2' },
        e2: { id: 'e2', type: 'line', startPointId: 'p2', endPointId: 'p3' },
        e3: { id: 'e3', type: 'line', startPointId: 'p3', endPointId: 'p4' },
        e4: { id: 'e4', type: 'line', startPointId: 'p4', endPointId: 'p1' },
      },
      panels: {
        panel1: { id: 'panel1', name: '方片', outlineEdgeIds: ['e1', 'e2', 'e3', 'e4'] },
      },
    },
  });
}

describe('pattern file format', () => {
  it('round trips metadata and geometry', () => {
    const source = samplePattern();
    const text = encodePatternFile(source, { name: '测试版型', key: 'test', icon: 'shirt' });
    const { file, warnings } = parsePatternFile(text);

    expect(file.key).toBe('test');
    expect(file.name).toBe('测试版型');
    expect(file.icon).toBe('shirt');
    expect(file.summary).toContain('前片');
    expect(Object.keys(file.pattern.panels)).toHaveLength(Object.keys(source.panels).length);
    expect(Object.keys(file.pattern.seams)).toHaveLength(Object.keys(source.seams).length);
    expect(warnings).toEqual([]);
  });

  it('derives a key and summary when neither is supplied', () => {
    const { file } = parsePatternFile(encodePatternFile(samplePattern(), { name: '未命名' }));
    expect(file.key).toMatch(/^tpl_/);
    expect(file.summary).toContain('前片');
  });

  it('rejects missing metadata and unparsable text', () => {
    expect(() => parsePatternFile('{"key":"a","pattern":{}}')).toThrow(/name/);
    expect(() => parsePatternFile('{"key":"a","name":"A"}')).toThrow(/pattern/);
    expect(() => parsePatternFile('{"name":"A","pattern":{}}')).toThrow(/key/);
    expect(() => parsePatternFile('not json')).toThrow(/解析失败/);
  });

  it('rejects broken topology', () => {
    const raw = JSON.parse(encodePatternFile(samplePattern(), { name: '坏版型' })) as {
      pattern: { panels: Record<string, { outlineEdgeIds: string[] }> };
    };
    const first = Object.values(raw.pattern.panels)[0]!;
    first.outlineEdgeIds = ['missing_edge'];
    expect(() => parsePatternFile(JSON.stringify(raw))).toThrow(/拓扑校验失败/);
  });

  it('fills omitted collections and panel defaults for hand-written files', () => {
    const { file, warnings } = parsePatternFile(minimalFile());
    const panel = Object.values(file.pattern.panels)[0]!;

    expect(Object.keys(file.pattern.seams)).toEqual([]);
    expect(Object.keys(file.pattern.darts)).toEqual([]);
    expect(Object.keys(file.pattern.trims)).toEqual([]);
    expect(panel.seamAllowanceCm).toBe(1);
    expect(panel.meshResolutionCm).toBeGreaterThan(0);
    expect(panel.visible).toBe(true);
    expect(warnings.join(' ')).toContain('drape');
    expect(warnings.join(' ')).toContain('seams');
  });

  it('falls back to the panel glyph for an unknown icon', () => {
    const text = encodePatternFile(samplePattern(), { name: '未知图标' })
      .replace('"name": "未知图标",', '"name": "未知图标", "icon": "unknown",');
    expect(parsePatternFile(text).file.icon).toBeUndefined();
    expect(patternFileToTemplate(parsePatternFile(text).file, 'file').icon).toBe('panel');
  });
});

describe('instantiating a file template', () => {
  it('creates a fresh id space and rewrites the fabric on every call', () => {
    const { file } = parsePatternFile(encodePatternFile(samplePattern(), { name: '重复添加' }));
    const first = instantiatePattern(file.pattern, 'fabric_a');
    const second = instantiatePattern(file.pattern, 'fabric_b');
    const ids = (pattern: Pattern): string[] => [
      ...Object.keys(pattern.points), ...Object.keys(pattern.edges),
      ...Object.keys(pattern.panels), ...Object.keys(pattern.seams),
    ];

    expect(new Set([...ids(first), ...ids(second)]).size).toBe(ids(first).length + ids(second).length);
    expect(new Set([...ids(first), ...Object.keys(file.pattern.panels)]).size)
      .toBe(ids(first).length + Object.keys(file.pattern.panels).length);
    expect(validatePattern(first)).toEqual([]);
    expect(validatePattern(second)).toEqual([]);
    for (const panel of Object.values(first.panels)) expect(panel.fabricId).toBe('fabric_a');
    for (const panel of Object.values(second.panels)) expect(panel.fabricId).toBe('fabric_b');
  });

  it('appends the same file template twice without collisions', () => {
    const { file } = parsePatternFile(encodePatternFile(samplePattern(), { name: '追加两次' }));
    const template = patternFileToTemplate(file, 'file');
    const ctx: ProjectContext = { project: createStarterProject() };

    new AppendTemplateCommand(template).execute(ctx);
    new AppendTemplateCommand(template).execute(ctx);

    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    expect(Object.keys(ctx.project.pattern.panels)).toHaveLength(12);
  });

  it('loads every file in the default folder', () => {
    const dir = fileURLToPath(new URL('../../../assets/patterns/', import.meta.url));
    const names = readdirSync(dir).filter(name => name.endsWith('.ocpat'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const { file, warnings } = parsePatternFile(readFileSync(join(dir, name), 'utf8'));
      expect(file.key.length, name).toBeGreaterThan(0);
      expect(file.params?.chestCm ?? file.params?.waistCm, name).toBeGreaterThan(0);
      expect(Object.keys(file.pattern.panels).length, name).toBeGreaterThan(0);
      expect(Object.keys(file.pattern.seams).length, name).toBeGreaterThan(0);
      expect(warnings, name).toEqual([]);
      expect(validatePattern(instantiatePattern(file.pattern, 'fabric_x')), name).toEqual([]);
    }
  });
});
