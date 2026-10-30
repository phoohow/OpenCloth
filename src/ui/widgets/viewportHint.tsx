import type { ReactNode } from 'react';

/** One line of operation hints pinned to the bottom-left of a viewport pane. */
export function ViewportHint({ children, right = 8 }: { children: ReactNode; right?: number }) {
  return (
    <div style={{
      position: 'absolute', bottom: 8, left: 8, right, color: '#888', fontSize: 'var(--oc-fs-micro)',
      pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {children}
    </div>
  );
}
