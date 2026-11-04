import { useCallback, useEffect, useRef } from 'react';
import type { Pattern, Vec2 } from '../../core/model/types';
import { samplePanelOutline } from '../../pattern/panel/panelBuilder';
import { computeBBox } from '../../pattern/geom/vec2';
import { useUIStore } from '../../store/stores';
import { fitView, toWorld, zoomAround, type ViewTransform } from './viewMath';

/** CSS size of the pane, or null while it is hidden. */
export interface CanvasSize {
  w: number;
  h: number;
}

/** State and refs the 2D pane hands to its view hook. */
export interface CanvasViewInput {
  pattern: Pattern;
  view: ViewTransform;
  setView: React.Dispatch<React.SetStateAction<ViewTransform>>;
  /** Draws the current state; called after a resize that leaves the framing alone. */
  render: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLDivElement>;
}

/** View behaviour of the 2D pane: fitting, resize redraws, cursor-anchored wheel zoom and pointer mapping. */
export function useCanvasView(
  input: CanvasViewInput,
): {
  getCanvasSize: () => CanvasSize | null;
  eventWorld: (e: { clientX: number; clientY: number }) => Vec2 | null;
  fitToPattern: () => void;
} {
  const { pattern, view, setView, render, canvasRef, containerRef } = input;
  const hiddenRef = useRef(true);
  const fitToken = useUIStore(s => s.fitToken);

  const getCanvasSize = (): CanvasSize | null => {
    const container = containerRef.current;
    if (!container || container.clientWidth === 0) return null;
    return { w: container.clientWidth, h: container.clientHeight };
  };

  const eventWorld = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const canvas = canvasRef.current;
    const size = getCanvasSize();
    if (!canvas || !size) return null;
    const rect = canvas.getBoundingClientRect();
    return toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, view, size.w, size.h);
  };

  const fitToPattern = useCallback(() => {
    const size = getCanvasSize();
    if (!size) return;
    const pts: Vec2[] = [];
    for (const panel of Object.values(pattern.panels)) {
      if (!panel.visible) continue;
      pts.push(...samplePanelOutline(pattern, panel));
    }
    if (pts.length === 0) { setView({ offsetX: 0, offsetY: 0, scale: 4 }); return; }
    setView(fitView(computeBBox(pts), size.w, size.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern]);

  // Redraw on size changes, and frame the pattern whenever the pane becomes visible.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const visible = container.clientWidth > 0 && container.clientHeight > 0;
      if (!visible) { hiddenRef.current = true; return; }
      const wasHidden = hiddenRef.current;
      hiddenRef.current = false;
      if (wasHidden) fitToPattern();
      else render();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, render, fitToPattern]);

  // The pane toolbar requests a fit through the store token.
  useEffect(() => {
    if (fitToken > 0) fitToPattern();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  // Wheel zoom anchored at the cursor; native listener so preventDefault works.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const size = getCanvasSize();
      if (!size) return;
      const rect = canvas.getBoundingClientRect();
      const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // Scroll down moves the view closer, scroll up pulls it back.
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      setView(v => zoomAround(v, cursor, factor, size.w, size.h));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);

  return { getCanvasSize, eventWorld, fitToPattern };
}
