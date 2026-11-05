import type { PomPoint, SizeDef } from '@/model/types';
import { csvTable, type CsvRow } from '@/common/text';
import { pomReportRows, type PomCsvUpdate, type PomTable } from '@/pattern/pom';

/** Writes the size-chart matrix: one POM per row, one size per column. */
export function pomMatrixCsv(table: PomTable): string {
  const header = ['名称', ...table.sizes.map(size => size.label)];
  const rows = table.rows.map(row => [
    row.pom.name,
    ...table.sizes.map(size => {
      const value = row.values[size.id];
      return typeof value === 'number' ? value.toFixed(2) : '';
    }),
  ]);
  return csvTable([header, ...rows]);
}

/** Writes one report row per POM and size, with the difference from the base size. */
export function pomReportCsv(projectName: string, table: PomTable, now = new Date()): string {
  const baseLabel = table.sizes.find(size => size.id === table.baseSizeId)?.label ?? '—';
  const meta: Array<[string, string]> = [
    ['工程', projectName],
    ['日期', now.toISOString()],
    ['基码', baseLabel],
  ];
  const rows: CsvRow[] = [...meta, ['测量点', '部位', '尺码', '数值(cm)', '差值(cm)', '公式']];
  for (const row of pomReportRows(table)) {
    rows.push([
      row.name,
      row.part,
      row.sizeLabel,
      row.valueCm === null ? '' : row.valueCm.toFixed(2),
      row.diffCm === null ? '' : row.diffCm.toFixed(2),
      row.formula ?? '',
    ]);
  }
  return csvTable(rows);
}

/** Parsed size-chart CSV, with rows that could not be applied. */
export interface PomCsvParse {
  updates: PomCsvUpdate[];
  skippedRows: number;
  errors: string[];
}

/** Reads the matrix written by `pomMatrixCsv`; the base-size column is ignored. */
export function parsePomCsv(
  text: string,
  sizes: readonly SizeDef[],
  poms: readonly PomPoint[],
): PomCsvParse {
  const errors: string[] = [];
  const updates: PomCsvUpdate[] = [];
  let skippedRows = 0;
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    return { updates, skippedRows, errors: ['CSV 至少有表头与一行数据'] };
  }

  const header = splitCsvLine(lines[0]!);
  const sizeColumns = header.slice(1).map((label, index) => {
    const trimmed = label.trim();
    const size = sizes.find(item => item.label === trimmed) ?? null;
    if (!size) errors.push(`表头尺码「${header[index + 1]?.trim() ?? ''}」不在尺码表中`);
    return { size };
  });
  if (!sizeColumns.some(column => column.size)) {
    return { updates, skippedRows, errors: ['CSV 表头没有可识别的尺码名称'] };
  }

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
    const cells = splitCsvLine(lines[lineIndex]!);
    const name = (cells[0] ?? '').trim();
    const pom = poms.find(item => item.name === name);
    if (!pom) {
      skippedRows += 1;
      continue;
    }
    sizeColumns.forEach((column, index) => {
      const size = column.size;
      if (!size) return;
      const raw = (cells[index + 1] ?? '').trim();
      if (!raw) return;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        errors.push(`第 ${lineIndex + 1} 行「${name} / ${size.label}」不是正数`);
        return;
      }
      if (size.isBase) return;
      updates.push({ pomId: pom.id, sizeId: size.id, value });
    });
  }
  return { updates, skippedRows, errors };
}

/** Splits one CSV line on commas, honouring double-quoted cells. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === ',' && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}
