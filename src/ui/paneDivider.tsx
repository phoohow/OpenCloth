import { DIVIDER_WIDTH } from '@/ui/viewportLayout';
import { useRef, useState } from 'react';

interface PaneDividerProps {
  axis: 'x' | 'y';
  onDrag: (cursor: number) => void;
}

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
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
        dragging.current = true;
        setActive(true);
      }}
      onPointerMove={e => { if (dragging.current) onDrag(axis === 'x' ? e.clientX : e.clientY); }}
      onPointerUp={stop}
      onPointerCancel={stop}
    />
  );
}
