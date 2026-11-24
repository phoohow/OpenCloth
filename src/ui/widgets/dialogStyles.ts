import type { CSSProperties } from 'react';

export const dialogRoot: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, width: '100%', flex: 1, minHeight: 0,
};

export const dialogTitle: CSSProperties = {
  fontSize: 'var(--oc-fs-dialog-title)', color: '#4da6ff', letterSpacing: 1,
  paddingBottom: 8, borderBottom: '1px solid #333',
};

export const dialogTabs: CSSProperties = {
  display: 'flex', gap: 4, borderBottom: '1px solid #333', paddingBottom: 4,
};

export const dialogTabActive: CSSProperties = {
  background: '#2a3a4a', border: '1px solid #4da6ff', color: '#fff',
};

export const dialogSectionTitle: CSSProperties = {
  color: '#7d7d88', fontSize: 'var(--oc-fs-micro)', letterSpacing: 1, marginTop: 4,
};

export const dialogLabel: CSSProperties = { color: '#7d7d88', fontSize: 'var(--oc-fs-micro)' };

export const dialogMessage: CSSProperties = { color: '#9fd4a8', fontSize: 'var(--oc-fs-micro)' };

export function dialogTab(pad = 12): CSSProperties {
  return {
    padding: `4px ${pad}px`, background: 'transparent', border: '1px solid transparent',
    borderRadius: 3, color: '#aaa', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  };
}

export function dialogButton(kind: 'primary' | 'secondary' | 'danger', pad = 10): CSSProperties {
  const tone = kind === 'primary'
    ? { background: '#2a6a3a', border: '1px solid #3f9e55', color: '#fff' }
    : kind === 'danger'
      ? { background: '#5a2a2a', border: '1px solid #9e3f3f', color: '#ffd9d9' }
      : { background: '#2a2a30', border: '1px solid #4a4a54', color: '#ddd' };
  return {
    padding: `4px ${pad}px`, ...tone, borderRadius: 3, cursor: 'pointer',
    fontSize: 'var(--oc-fs-micro)', whiteSpace: 'nowrap',
  };
}

export function dialogHint(pad = 4): CSSProperties {
  return { color: '#777', fontSize: 'var(--oc-fs-micro)', padding: pad };
}
