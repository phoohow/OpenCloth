import { useEffect, type RefObject } from 'react';
import type { GarmentEngine } from '../../core/engine/garmentEngine';
import { useSimStore, useUIStore } from '../../store/stores';
import { isTapGesture } from '../mobile/mobileUi';

/** Pointer picking on the 3D canvas: Alt or pin-tool clicks pin particles, a double-click or a phone tap selects a panel. */
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

    /** Makes one panel the selection, or clears it when the point hits nothing. */
    const selectPanelAt = (clientX: number, clientY: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const { x, y } = toNdc(clientX, clientY);
      const panelId = engine.pickPanelAtScreen(x, y);
      engine.setSelectedPanels(panelId ? [panelId] : []);
      // UI store selection is the single source of truth for panels.
      const ui = useUIStore.getState();
      if (panelId) ui.select([panelId]);
      else ui.clearSelection();
    };

    // Capture on the parent runs before OrbitControls' canvas listener,
    // so stopPropagation suppresses orbit only for pin clicks.
    let pinConsumed = false;
    const onPointerDown = (e: PointerEvent) => {
      pinConsumed = false;
      const engine = engineRef.current;
      if (!engine || e.button !== 0) return;
      const tool = useUIStore.getState().activeTool;
      const pinTool = tool === 'pin' || tool === 'unpin';
      if (!e.altKey && !pinTool) return;
      pinConsumed = true;
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
      selectPanelAt(e.clientX, e.clientY);
    };

    // A finger that lands and lifts without moving selects the panel under it; a mouse
    // keeps double-click so an orbit drag never steals the selection.
    let touch: { x: number; y: number; at: number; id: number } | null = null;
    const onCanvasPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touch = { x: e.clientX, y: e.clientY, at: performance.now(), id: e.pointerId };
    };
    const onCanvasPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !touch || touch.id !== e.pointerId) return;
      const started = touch;
      touch = null;
      if (pinConsumed) return;
      if (!isTapGesture(e.clientX - started.x, e.clientY - started.y, performance.now() - started.at)) return;
      selectPanelAt(e.clientX, e.clientY);
    };
    const onCanvasPointerCancel = () => {
      touch = null;
    };

    container.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('pointerdown', onCanvasPointerDown);
    canvas.addEventListener('pointerup', onCanvasPointerUp);
    canvas.addEventListener('pointercancel', onCanvasPointerCancel);
    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      canvas.removeEventListener('pointerup', onCanvasPointerUp);
      canvas.removeEventListener('pointercancel', onCanvasPointerCancel);
    };
  }, [canvasRef, containerRef, engineRef]);
}
