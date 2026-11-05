import { describe, expect, it } from 'vitest';
import { csvCell, csvTable } from '../../../src/core/text/csv';

describe('csvCell', () => {
  it('leaves plain cells untouched', () => {
    expect(csvCell('最小间隙(cm)')).toBe('最小间隙(cm)');
    expect(csvCell('0.125')).toBe('0.125');
  });

  it('quotes separators, quotes and newlines', () => {
    expect(csvCell('前,后')).toBe('"前,后"');
    expect(csvCell('前"片"')).toBe('"前""片"""');
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
  });
});

describe('csvTable', () => {
  it('joins rows with CRLF and escapes every cell', () => {
    expect(csvTable([['工程', '测试'], ['版片,前片', '1'], ['备注', '带"引号"']]))
      .toBe('工程,测试\r\n"版片,前片",1\r\n备注,"带""引号"""');
  });

  it('keeps two-column label/value rows', () => {
    const rows: Array<[string, string]> = [['工程', 'A'], ['日期', '2026-11-05']];
    expect(csvTable(rows)).toBe('工程,A\r\n日期,2026-11-05');
  });

  it('writes nothing for an empty table', () => {
    expect(csvTable([])).toBe('');
  });
});
