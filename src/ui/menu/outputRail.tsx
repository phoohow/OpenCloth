import type { CSSProperties } from 'react';

const styles: Record<string, CSSProperties> = {
  rail: { width: 96, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' },
  railRow: {
    flex: '0 0 auto', display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingBottom: 2,
  },
  item: {
    flex: '0 0 auto',
    padding: '6px 8px', background: 'transparent', border: '1px solid transparent', borderRadius: 4,
    color: '#bbb', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)', textAlign: 'left', whiteSpace: 'nowrap',
  },
  itemActive: { background: '#22405c', border: '1px solid #3d6f9e', color: '#fff' },
};

export interface RailItem {
  key: string;
  label: string;
}

export function OutputRail({ items, active, onSelect, orientation = 'vertical' }: {
  items: RailItem[];
  active: string;
  onSelect: (key: string) => void;
  orientation?: 'vertical' | 'horizontal';
}) {
  return (
    <nav style={orientation === 'horizontal' ? styles.railRow : styles.rail}>
      {items.map(item => (
        <button
          key={item.key}
          style={{ ...styles.item, ...(item.key === active ? styles.itemActive : null) }}
          onClick={() => onSelect(item.key)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
