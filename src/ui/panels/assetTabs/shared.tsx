import type { CSSProperties, ReactNode } from 'react';
import { useUIStore } from '@/store';
import { Icon, type IconName } from '@/ui/icons';
import { beginAssetDrag, type AssetDragPayload } from '@/ui/assets/assetDrag';

/** Shows a transient message over the viewports. */
export function notify(text: string): void {
  useUIStore.getState().showToast(text);
}

/** Catalogue group heading, with an optional action button at its right end. */
export function Section({ title, action, children }: {
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHead}>
        <span style={styles.sectionTitle}>{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One catalogue row: a colour swatch, icon or preview, its name and a one-line spec.
 * Rows carrying a payload are dragged onto a panel; rows with `onClick` are acted on in place.
 */
export function AssetRow({
  name, meta, swatch, icon, image, active, title, dragPayload, onClick, onDelete,
}: {
  name: string;
  meta?: string;
  /** Colour of a material or trim swatch. */
  swatch?: string;
  /** Glyph used instead of a swatch or preview. */
  icon?: IconName;
  /** Data URL preview, used by pattern rows. */
  image?: string;
  /** Marks the row as the one in effect. */
  active?: boolean;
  /** Tooltip describing what a drag or click does. */
  title?: string;
  /** Makes the row draggable onto a panel. */
  dragPayload?: AssetDragPayload;
  onClick?: () => void;
  onDelete?: () => void;
}) {
  const interactive = !!onClick;
  return (
    <div
      style={{
        ...styles.row,
        ...(active ? styles.rowActive : null),
        ...(dragPayload || interactive ? styles.rowPickable : null),
      }}
      title={title}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive && active !== undefined ? active : undefined}
      draggable={!!dragPayload}
      onDragStart={dragPayload
        ? e => beginAssetDrag(e, dragPayload, {
          ...(image ? { image } : {}),
          ...(swatch ? { color: swatch } : {}),
        })
        : undefined}
      onClick={onClick}
      onKeyDown={interactive
        ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }
        : undefined}
    >
      {image
        ? <img src={image} alt="" draggable={false} style={styles.preview} />
        : <span style={{ ...styles.leading, ...(swatch ? { background: swatch, border: '1px solid #555' } : null) }}>
          {icon && <Icon name={icon} size={13} style={{ color: '#9ab' }} />}
        </span>}
      <span style={styles.text}>
        <span style={styles.name}>{name}</span>
        {meta && <span style={styles.meta}>{meta}</span>}
      </span>
      {active && <span style={styles.badge}>使用中</span>}
      {onDelete && (
        <button
          style={styles.deleteBtn}
          title="删除"
          aria-label={`删除 ${name}`}
          onClick={e => { e.stopPropagation(); onDelete(); }}
        >
          <Icon name="close" size={9} />
        </button>
      )}
    </div>
  );
}

export const styles: Record<string, CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 },
  sectionHead: { display: 'flex', alignItems: 'center', gap: 4, minHeight: 16 },
  sectionTitle: { flex: 1, color: '#7d7d88', fontSize: 'var(--oc-fs-note)', letterSpacing: 1 },
  row: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '3px 5px',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 4, minWidth: 0,
  },
  rowActive: { border: '1px solid #3f9e55', background: '#26332a' },
  rowPickable: { cursor: 'pointer' },
  leading: {
    flex: '0 0 auto', width: 22, height: 22, borderRadius: 3, background: '#1f1f24',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  preview: { flex: '0 0 auto', width: 38, height: 38, borderRadius: 3, background: '#1f1f24', objectFit: 'contain' },
  glyph: {
    flex: '0 0 auto', width: 30, height: 30, borderRadius: 3, background: '#1f1f24',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  name: { color: '#ddd', fontSize: 'var(--oc-fs-micro)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { color: '#7d7d88', fontSize: 'var(--oc-fs-note)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badge: { flex: '0 0 auto', color: '#8fce9d', fontSize: 'var(--oc-fs-note)' },
  deleteBtn: {
    flex: '0 0 auto', width: 16, height: 16, padding: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'transparent', border: 'none', color: '#777', cursor: 'pointer',
  },
  iconBtn: {
    flex: '0 0 auto', height: 16, padding: '0 5px', display: 'flex', alignItems: 'center', gap: 3,
    background: 'transparent', border: '1px solid #3a3a42', borderRadius: 3,
    color: '#9ab', cursor: 'pointer', fontSize: 'var(--oc-fs-note)',
  },
  /** The same button carrying one glyph instead of a word. */
  glyphBtn: {
    flex: '0 0 auto', width: 17, height: 17, padding: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'transparent', border: '1px solid #3a3a42',
    borderRadius: 3, color: '#9ab', cursor: 'pointer',
  },
  note: { color: '#666', fontSize: 'var(--oc-fs-note)', lineHeight: 1.5, margin: '2px 2px 0' },
  body: { display: 'flex', flexDirection: 'column', gap: 4, padding: '3px 4px 6px' },
  field: {
    width: '100%', minWidth: 0, padding: '3px 5px', background: '#1c1c20', border: '1px solid #3a3a42',
    borderRadius: 3, color: '#ddd', fontSize: 'var(--oc-fs-note)',
  },
  fieldRow: { display: 'flex', alignItems: 'center', gap: 4 },
  color: { flex: '0 0 auto', width: 26, height: 22, padding: 0, border: '1px solid #3a3a42', background: '#1c1c20' },
};
