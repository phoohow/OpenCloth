import type { Pattern, Vec2 } from '@/model/types';

import { computeBBox } from '@/base/geom';
import { samplePanelOutline } from '@/pattern/panel';
import { useUIStore } from '@/store';
import { fitView, toWorld, zoomAround, type ViewTransform } from '@/ui/viewport2D/viewMath';
import { useCallback, useEffect, useRef } from 'react';

export interface CanvasSize {
  w: number;
  h: number;
}

export interface CanvasViewInput {
  pattern: Pattern;
  fitBounds?: readonly Vec2[];
  view: ViewTransform;
  setView: React.Dispatch<React.SetStateAction<ViewTransform>>;
  render: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLDivElement>;
}

export function useCanvasView(
  input: CanvasViewInput,
): {
  getCanvasSize: () => CanvasSize | null;
  eventWorld: (e: { clientX: number; clientY: number }) => Vec2 | null;
  fitToPattern: () => void;
} {
  const { pattern, fitBounds, view, setView, render, canvasRef, containerRef } = input;
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
    const pts: Vec2[] = [...(fitBounds ?? [])];
    for (const panel of Object.values(pattern.panels)) {
      if (!panel.visible) continue;
      pts.push(...samplePanelOutline(pattern, panel));
    }

    if (pts.length === 0) { setView({ offsetX: 0, offsetY: 0, scale: 4 }); return; }
    setView(fitView(computeBBox(pts), size.w, size.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, fitBounds]);

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

  useEffect(() => {
    if (fitToken > 0) fitToPattern();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const size = getCanvasSize();
      if (!size) return;
      const rect = canvas.getBoundingClientRect();
      const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      setView(v => zoomAround(v, cursor, factor, size.w, size.h));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);

  return { getCanvasSize, eventWorld, fitToPattern };
}
