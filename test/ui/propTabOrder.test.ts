import { describe, expect, it } from 'vitest';
import { PROP_TAB_OPTIONS } from '@/ui/optionTables';

const keys = PROP_TAB_OPTIONS.map(option => option.key);

describe('属性页标签顺序', () => {
  it('版型排在渲染之后、工程之前', () => {
    expect(keys.indexOf('pattern')).toBeGreaterThan(keys.indexOf('render'));
    expect(keys.indexOf('pattern')).toBeLessThan(keys.indexOf('project'));
    expect(keys.at(-1)).toBe('project');
  });

  it('其余标签保持原顺序', () => {
    expect(keys).toEqual(['object', 'material', 'simulator', 'transform', 'render', 'pattern', 'project']);
  });
});
