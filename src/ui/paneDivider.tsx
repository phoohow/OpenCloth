import { useRef, useState } from 'react';
import { DIVIDER_WIDTH } from '@/ui/viewportLayout';

interface PaneDividerProps {
  /** 'x' splits left/right, 'y' splits top/bottom. */
  axis: 'x' | 'y';
  /** Called with the cursor position along the axis while dragging. */
  onDrag: (cursor: number) => void;
}

/** Draggable bar that resizes the two panes it separates. */
export function PaneDivider({ axis, onDrag }: PaneDividerProps) {
  const dragging = useRef(false);
  const [active, setActive] = useState(false);

  const stop = () => { dragging.current = false; setActive(false); };

  return (
    <div
      style={{
        flex: '0 0 auto',
        touchAction: 'none',
        background: active ? '#4da6ff' : '#333',
        ...(axis === 'x'
          ? { width: DIVIDER_WIDTH, height: '100%', cursor: 'col-resize' as const, borderLeft: '1px solid #252528', borderRight: '1px solid #252528' }
          : { height: DIVIDER_WIDTH, width: '100%', cursor: 'row-resize' as const, borderTop: '1px solid #333', borderBottom: '1px solid #333' }),
      }}
      onPointerDown={e => {
        // Capture keeps the moves coming to the divider; synthetic pointers have none to capture.
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no capture available */ }
        dragging.current = true;
        setActive(true);
      }}
      onPointerMove={e => { if (dragging.current) onDrag(axis === 'x' ? e.clientX : e.clientY); }}
      onPointerUp={stop}
      onPointerCancel={stop}
    />
  );
}
