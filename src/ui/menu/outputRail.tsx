import type { CSSProperties } from 'react';

/** One previewable output listed in the rail. */
export interface RailItem {
  key: string;
  label: string;
}

/** Vertical rail of previewable outputs, shared by the production and integration windows. */
export function OutputRail({ items, active, onSelect }: {
  items: RailItem[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav style={styles.rail}>
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

const styles: Record<string, CSSProperties> = {
  rail: { width: 96, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' },
  item: {
    padding: '6px 8px', background: 'transparent', border: '1px solid transparent', borderRadius: 4,
    color: '#bbb', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)', textAlign: 'left', whiteSpace: 'nowrap',
  },
  itemActive: { background: '#22405c', border: '1px solid #3d6f9e', color: '#fff' },
};
