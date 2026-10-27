import { useEffect, type RefObject } from 'react';
import type { GarmentEngine } from '../../core/engine/garmentEngine';
import { useSimStore, useUIStore } from '../../store/stores';

/** Pointer picking on the 3D canvas: Alt or pin-tool clicks pin particles, double-click selects a panel. */
export function useClothPicking(
  canvasRef: RefObject<HTMLCanvasElement>,
  containerRef: RefObject<HTMLDivElement>,
  engineRef: RefObject<GarmentEngine | null>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    /** Viewport pixel coordinates to normalized device coordinates, Y up. */
    const toNdc = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((clientY - rect.top) / rect.height) * 2 - 1),
      };
    };

    // Capture on the parent runs before OrbitControls' canvas listener,
    // so stopPropagation suppresses orbit only for pin clicks.
    const onPointerDown = (e: PointerEvent) => {
      const engine = engineRef.current;
      if (!engine || e.button !== 0) return;
      const tool = useUIStore.getState().activeTool;
      const pinTool = tool === 'pin' || tool === 'unpin';
      if (!e.altKey && !pinTool) return;
      e.stopPropagation();
      const { x, y } = toNdc(e.clientX, e.clientY);
      const hit = engine.pickClothParticleAtScreen(x, y);
      if (!hit) return;
      const marked = engine.getPinMarkers().includes(hit.index);
      const pinned = marked || engine.getPinnedParticles().includes(hit.index);
      const wantUnpin = e.shiftKey || tool === 'unpin';
      // The top band of every hanging panel is basted, so an already fixed particle still
      // deserves the mark the user clicked for; only an unpin releases it.
      if (wantUnpin) {
        if (pinned) applyPin(engine, hit.index, false);
      } else if (!marked) {
        applyPin(engine, hit.index, true);
      }
    };

    /** Runs a pin change and lets the toolbars re-read the pinned set. */
    const applyPin = (engine: GarmentEngine, index: number, pinned: boolean) => {
      void engine.setPin(index, pinned).then(() => useSimStore.getState().bumpPins());
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (e.altKey) return;
      const engine = engineRef.current;
      if (!engine) return;
      const { x, y } = toNdc(e.clientX, e.clientY);
      const panelId = engine.pickPanelAtScreen(x, y);
      engine.setSelectedPanels(panelId ? [panelId] : []);
      // UI store selection is the single source of truth for panels.
      const ui = useUIStore.getState();
      if (panelId) ui.select([panelId]);
      else ui.clearSelection();
    };

    container.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('dblclick', onDoubleClick);
    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('dblclick', onDoubleClick);
    };
  }, [canvasRef, containerRef, engineRef]);
}
