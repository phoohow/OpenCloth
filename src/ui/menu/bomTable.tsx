import type { CSSProperties } from 'react';
import { bomQuantityText, type BomRow } from '@/pattern';

/** Bill of materials as a scrollable table, shared by the production and integration dialogs. */
export function BomTable({ rows }: { rows: BomRow[] }) {
  return (
    <div style={styles.table}>
      <div style={{ ...styles.row, ...styles.head }}>
        <span>类别</span>
        <span>名称</span>
        <span>规格</span>
        <span>单位</span>
        <span style={styles.num}>数量</span>
        <span style={styles.num}>单价</span>
        <span style={styles.num}>金额</span>
      </div>
      {rows.map((row, index) => (
        <div key={`${row.category}:${row.name}:${index}`} style={styles.row}>
          <span style={styles.cell}>{row.category}</span>
          <span style={styles.cell}>{row.name}</span>
          <span style={styles.cell}>{row.spec}</span>
          <span style={styles.cell}>{row.unit}</span>
          <span style={{ ...styles.cell, ...styles.num }}>{bomQuantityText(row.quantity)}</span>
          <span style={{ ...styles.cell, ...styles.num }}>{row.unitPrice === null ? '—' : row.unitPrice.toFixed(2)}</span>
          <span style={{ ...styles.cell, ...styles.num }}>{row.amount === null ? '—' : row.amount.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  table: {
    display: 'flex', flexDirection: 'column', gap: 2, width: '100%', maxWidth: 660, maxHeight: '100%',
    overflowY: 'auto', alignSelf: 'flex-start', padding: '2px 4px',
  },
  row: {
    display: 'grid', gridTemplateColumns: '44px 1fr 1.6fr 36px 52px 52px 58px',
    gap: 6, fontSize: 'var(--oc-fs-micro)', color: '#ccc', lineHeight: 1.5,
  },
  head: { color: '#7d7d88', borderBottom: '1px solid #3a3a42', paddingBottom: 3 },
  cell: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  num: { textAlign: 'right' },
};
