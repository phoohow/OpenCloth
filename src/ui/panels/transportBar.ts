import type { CSSProperties } from 'react';

export const TRANSPORT_COLUMNS = '122px 84px minmax(120px, 1fr) 118px 124px 268px 62px';

export const TRANSPORT_BAR: CSSProperties = {
  height: 40, background: '#202024', borderTop: '1px solid #333',
  display: 'grid', gridTemplateColumns: TRANSPORT_COLUMNS, columnGap: 14,
  alignItems: 'center', padding: '0 16px',
};

export const TRANSPORT_PILL: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
};

export const TRANSPORT_SEGMENTS: CSSProperties = {
  display: 'flex', height: 24, background: '#2a2a30', border: '1px solid #3a3a42',
  borderRadius: 5, overflow: 'hidden', flex: '0 0 auto',
};

export const TRANSPORT_SEGMENT: CSSProperties = {
  width: 40, height: 22, background: 'transparent', border: 'none', color: '#888',
  cursor: 'pointer', fontSize: 'var(--oc-fs-body)', fontFamily: 'inherit', padding: 0,
};

export const TRANSPORT_SEGMENT_ACTIVE: CSSProperties = {
  background: '#2a4a6a', color: '#fff',
};

export const TRANSPORT_LINK: CSSProperties = {
  height: 20, padding: '0 6px', background: 'transparent', border: '1px solid #3a3a42',
  borderRadius: 3, color: '#888', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  fontFamily: 'inherit', whiteSpace: 'nowrap', flex: '0 0 auto',
};

export const TRANSPORT_LINK_ON: CSSProperties = {
  background: '#2a4a6a', borderColor: '#4da6ff', color: '#dce9f7',
};

export const TRANSPORT_GROUP: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
};

export const TRANSPORT_BUTTON: CSSProperties = {
  width: 20, height: 20, background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 4,
  color: '#ccc', cursor: 'pointer', fontSize: 'var(--oc-fs-body)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export const TRANSPORT_PLAY_BUTTON: CSSProperties = {
  background: '#2a4a6a', borderColor: '#4da6ff', color: '#fff', width: 28,
};

export const TRANSPORT_READOUT: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center',
  fontSize: 'var(--oc-fs-body)', color: '#aaa', whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums', overflow: 'hidden',
};

export const TRANSPORT_LABEL: CSSProperties = {
  fontSize: 'var(--oc-fs-micro)', color: '#888', whiteSpace: 'nowrap', flex: '0 0 auto',
};

export const TRANSPORT_PARAM: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
};

export const TRANSPORT_TRAILING: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
};

export const TRANSPORT_STATUS: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
  fontSize: 'var(--oc-fs-body)', whiteSpace: 'nowrap',
};

export const TRANSPORT_SELECT: CSSProperties = {
  flex: '1 1 auto', minWidth: 0, height: 20, background: '#2a2a30',
  border: '1px solid #3a3a42', borderRadius: 3, color: '#ddd',
  padding: '0 4px', fontSize: 'var(--oc-fs-body)', fontFamily: 'inherit',
};

export const TRANSPORT_ACTION: CSSProperties = {
  height: 20, background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: '#ccc',
  padding: '0 8px', fontSize: 'var(--oc-fs-body)', cursor: 'pointer', whiteSpace: 'nowrap',
};

export const TRANSPORT_RANGE: CSSProperties = {
  width: '100%', margin: 0, flex: '1 1 auto',
};

export const TRANSPORT_INPUT: CSSProperties = {
  width: 58, height: 20, background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3,
  color: '#ddd', padding: '0 4px', fontSize: 'var(--oc-fs-body)',
  fontVariantNumeric: 'tabular-nums', flex: '0 0 auto',
};
