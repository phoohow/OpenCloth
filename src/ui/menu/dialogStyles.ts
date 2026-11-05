import type { CSSProperties } from 'react';

/**
 * Style atoms shared by the three dialog bodies in this folder (素材库 / 版本与审版 / 外部对接).
 * They all render into the same menu popover, so the frame, the tab strip and the button family
 * have to look identical; only paddings and column layouts differ per dialog and stay local.
 *
 * Colours are deliberately literal here: these panels sit on the menu popover surface, not on the
 * app background, so the design tokens for panels do not apply.
 */

/** Column frame filling the popover. */
export const dialogRoot: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, width: '100%', flex: 1, minHeight: 0,
};

/** Single dialog heading, underlined to separate it from the body. */
export const dialogTitle: CSSProperties = {
  fontSize: 'var(--oc-fs-dialog-title)', color: '#4da6ff', letterSpacing: 1,
  paddingBottom: 8, borderBottom: '1px solid #333',
};

/** Tab strip: one underline shared by every tab. */
export const dialogTabs: CSSProperties = {
  display: 'flex', gap: 4, borderBottom: '1px solid #333', paddingBottom: 4,
};

/** Selected tab; the accent border is what marks it, so it is not reused for hover. */
export const dialogTabActive: CSSProperties = {
  background: '#2a3a4a', border: '1px solid #4da6ff', color: '#fff',
};

/** Small caps-ish group heading inside a dialog body. */
export const dialogSectionTitle: CSSProperties = {
  color: '#7d7d88', fontSize: 'var(--oc-fs-micro)', letterSpacing: 1, marginTop: 4,
};

/** Field label. */
export const dialogLabel: CSSProperties = { color: '#7d7d88', fontSize: 'var(--oc-fs-micro)' };

/** One-line result or status text; success green by default. */
export const dialogMessage: CSSProperties = { color: '#9fd4a8', fontSize: 'var(--oc-fs-micro)' };

/** Unselected tab; `pad` is the horizontal padding, which differs between the tab strips. */
export function dialogTab(pad = 12): CSSProperties {
  return {
    padding: `4px ${pad}px`, background: 'transparent', border: '1px solid transparent',
    borderRadius: 3, color: '#aaa', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  };
}

/** Button in the three tones the dialogs use; `pad` is the horizontal padding. */
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

/** Small print under a section; `lineHeight` differs where the text is denser. */
export function dialogNote(lineHeight = 1.5): CSSProperties {
  return { color: '#777', fontSize: 'var(--oc-fs-note)', lineHeight };
}

/** Empty-state or inline help text; `pad` is the uniform padding around it. */
export function dialogHint(pad = 4): CSSProperties {
  return { color: '#777', fontSize: 'var(--oc-fs-micro)', padding: pad };
}
