import type { ReactNode } from 'react';

/** One line of operation hints pinned to the bottom-left of a viewport pane. */
export function ViewportHint({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: 'absolute', bottom: 8, left: 8, right: 8, color: '#888', fontSize: 12,
      pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {children}
    </div>
  );
}
