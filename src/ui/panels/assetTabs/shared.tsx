import type { AssetAction, AssetItem, AssetThumb } from '@/ui/assets/assetItem';
import type { CSSProperties, ReactNode } from 'react';

import { beginAssetDrag, type AssetDragGhost } from '@/ui/assets/assetDrag';
import { Icon } from '@/ui/icons';

export const styles: Record<string, CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 },
  sectionHead: {
    display: 'flex', alignItems: 'center', gap: 4, minHeight: 16, paddingBottom: 3,
    borderBottom: '1px solid #2b2b32',
  },
  sectionTitle: {
    flex: 1, minWidth: 0, color: '#8b8b96', fontSize: 'var(--oc-fs-micro)', fontWeight: 500,
    letterSpacing: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  headerActions: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4 },
  headerBtn: {
    flex: '0 0 auto', height: 16, padding: '0 5px', display: 'flex', alignItems: 'center',
    background: 'transparent', border: '1px solid #3a3a42', borderRadius: 3,
    color: '#9ab', cursor: 'pointer', fontSize: 'var(--oc-fs-note)',
  },
  empty: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px',
    border: '1px dashed #3a3a42', borderRadius: 4,
  },
  emptyText: { flex: 1, minWidth: 0, color: '#6f6f7a', fontSize: 'var(--oc-fs-note)' },
  row: {
    display: 'flex', alignItems: 'center', gap: 5, minHeight: 28, minWidth: 0,
  },
  rowTall: { minHeight: 42 },
  rowActive: { background: '#26332a', borderColor: '#3f9e55' },
  grip: {
    flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 9, color: '#6a6a74',
  },
  thumbImage: {
    flex: '0 0 auto', width: 34, height: 34, borderRadius: 3, background: '#1f1f24',
    objectFit: 'contain',
  },
  thumbBadge: {
    flex: '0 0 auto', width: 20, height: 20, borderRadius: 3, background: '#1f1f24',
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbBadgeTall: { width: 34, height: 34 },
  text: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  name: {
    color: '#ddd', fontSize: 'var(--oc-fs-micro)', overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  meta: {
    color: '#7d7d88', fontSize: 'var(--oc-fs-note)', overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  status: { flex: '0 0 auto', display: 'flex', alignItems: 'center' },
  actionBtn: {
    flex: '0 0 auto', width: 17, height: 17, padding: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'transparent', border: '1px solid #3a3a42',
    borderRadius: 3, color: '#9ab', cursor: 'pointer',
  },
  dangerBtn: {
    flex: '0 0 auto', width: 16, height: 16, padding: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'transparent', border: 'none', color: '#777', cursor: 'pointer',
  },
  note: { color: '#666', fontSize: 'var(--oc-fs-note)', lineHeight: 1.5, margin: '2px 2px 0' },
};

export function Section({ title, count, action, empty, children }: {
  title: string;
  count: number;
  action?: ReactNode;
  empty?: { text: string };
  children?: ReactNode;
}) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHead}>
        <span style={styles.sectionTitle}>{`${title} · ${count}`}</span>
        {action && <HeaderActions>{action}</HeaderActions>}
      </div>
      {count === 0 && empty ? <EmptyGroup text={empty.text} /> : null}
      {children}
    </section>
  );
}

function HeaderActions({ children }: { children: ReactNode }) {
  return <span style={styles.headerActions}>{children}</span>;
}

export function HeaderButton({ label, title, onClick }: {
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      style={styles.headerBtn}
      title={title ?? label}
      onClick={onClick}
    >{label}</button>
  );
}

export function AssetRow({ item }: { item: AssetItem }) {
  const primary = item.actions?.find(action => action.kind === 'primary');
  const secondary = (item.actions ?? []).filter(action => action !== primary && action.kind !== 'danger');
  const danger = item.actions?.find(action => action.kind === 'danger');
  const interactive = !!primary;
  const pickable = interactive || secondary.length > 0;
  const tall = item.thumb.kind === 'image';
  const drag = item.drag;

  return (
    <div
      className={[
        'oc-asset-row',
        pickable ? 'oc-asset-row-pickable' : '',
        drag ? 'oc-asset-row-drag' : '',
      ].filter(Boolean).join(' ')}
      style={{ ...styles.row, ...(tall ? styles.rowTall : null), ...(item.status === 'active' ? styles.rowActive : null) }}
      title={item.title ?? primary?.label}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive && item.status === 'active' ? true : undefined}
      draggable={!!drag}
      onDragStart={drag ? e => beginAssetDrag(e, drag, ghostOf(item.thumb)) : undefined}
      onClick={interactive ? () => primary.run() : undefined}
      onKeyDown={interactive
        ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); primary.run(); } }
        : undefined}
    >
      {drag && (
        <span className="oc-asset-grip" style={styles.grip} title="拖到版片上应用">
          <Icon name="grip" size={9} />
        </span>
      )}
      <Thumb thumb={item.thumb} tall={tall} />
      <span style={styles.text}>
        <span style={styles.name}>{item.name}</span>
        {item.meta && <span className="oc-asset-meta" style={styles.meta}>{item.meta}</span>}
      </span>
      {item.status && (
        <span
          style={styles.status}
          title={item.statusLabel ?? (item.status === 'active' ? '正在使用' : '已应用')}
        >
          <Icon name="status-dot" size={7} style={{ color: '#8fce9d' }} />
        </span>
      )}
      {primary && primary.button !== false && <ActionButton action={primary} />}
      {secondary.map(action => <ActionButton key={action.id} action={action} />)}
      {danger && (
        <button
          type="button"
          className="oc-asset-danger"
          style={styles.dangerBtn}
          title={danger.label}
          aria-label={danger.label}
          onClick={e => { e.stopPropagation(); danger.run(); }}
        >
          <Icon name="close" size={9} />
        </button>
      )}
    </div>
  );
}

function Thumb({ thumb, tall }: { thumb: AssetThumb; tall: boolean }) {
  if (thumb.kind === 'image') {
    return <img src={thumb.src} alt="" draggable={false} style={styles.thumbImage} />;
  }

  return (
    <span style={{
      ...styles.thumbBadge,
      ...(tall ? styles.thumbBadgeTall : null),
      ...(thumb.kind === 'swatch' ? { background: thumb.color, border: '1px solid #555' } : null),
    }}>
      {thumb.kind === 'icon' && <Icon name={thumb.name} size={12} style={{ color: '#9ab' }} />}
    </span>
  );
}

function ActionButton({ action }: { action: AssetAction }) {
  return (
    <button
      type="button"
      className="oc-asset-action"
      style={styles.actionBtn}
      title={action.label}
      aria-label={action.label}
      onClick={e => { e.stopPropagation(); action.run(); }}
    >
      <Icon name={action.icon ?? 'check'} size={11} />
    </button>
  );
}

function EmptyGroup({ text }: { text: string }) {
  return (
    <div style={styles.empty}>
      <span style={styles.emptyText}>{text}</span>
    </div>
  );
}

function ghostOf(thumb: AssetThumb): AssetDragGhost {
  if (thumb.kind === 'image') return { image: thumb.src };
  if (thumb.kind === 'swatch') return { color: thumb.color };
  return {};
}
