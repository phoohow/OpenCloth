import { useEffect, type RefObject } from 'react';
import type { GarmentEngine } from '../../core/engine/garmentEngine';
import { useSimStore, useUIStore } from '../../store/stores';
import { isTapGesture } from '../mobile/mobileUi';
import { CLAMP_CURSOR, OPEN_CLAMP_CURSOR, PIN_CURSOR, UNPIN_CURSOR } from './cursors';

/** What a pointer press would do where it currently hovers. */
type HoverMode = 'camera' | 'drag' | 'pin' | 'unpin';

interface Hover {
  mode: HoverMode;
  /** Pin a remove click would release, when the mode is `unpin`. */
  pin: number | null;
}

const CAMERA: Hover = { mode: 'camera', pin: null };

/** Pointer modifiers that select a gesture without touching the toolbar. */
interface Modifiers {
  alt: boolean;
  shift: boolean;
}

/**
 * Pointer interaction on the 3D canvas. Hovering decides everything: over cloth during playback the
 * pointer pinches and drags it, over cloth with the PIN tool it becomes a pin, and over an existing
 * PIN with the unpin tool it becomes a cross that highlights that pin. Anywhere else the event
 * falls through to OrbitControls, so the camera behaves exactly as before.
 */
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

    /**
     * Resolves what a press at this point would do. `touch` skips the drag gesture: a finger has no
     * hover, so a press on the cloth must stay a tap that selects the panel.
     */
    const classify = (
      clientX: number, clientY: number, mods: Modifiers, touch: boolean,
    ): Hover => {
      const engine = engineRef.current;
      if (!engine || !engine.isSimReady()) return CAMERA;
      const tool = useUIStore.getState().activeTool;
      const unpinRequested = tool === 'unpin' || (mods.alt && mods.shift);
      const { x, y } = toNdc(clientX, clientY);

      // Removing only arms itself over an existing pin, so empty cloth keeps the camera gestures.
      if (unpinRequested) {
        const pin = engine.hoverPinAtScreen(x, y);
        return pin === null ? CAMERA : { mode: 'unpin', pin };
      }
      // Cloth hidden behind the body is not a surface the pointer can act on.
      if (!engine.hoverClothAtScreen(x, y)) return CAMERA;
      if (tool === 'pin' || mods.alt) return { mode: 'pin', pin: null };
      // No tool selected: a running simulation turns the pointer into a grip on the cloth.
      if (touch || !useSimStore.getState().isPlaying) return CAMERA;
      return { mode: 'drag', pin: null };
    };

    let hover: Hover = CAMERA;
    /** Latest pointer position in client coordinates, or null while it is outside the canvas. */
    let pointer: { x: number; y: number } | null = null;
    let mods: Modifiers = { alt: false, shift: false };
    let pointerConsumed = false;
    /** Pointer currently pulling the cloth, or null. */
    let dragPointer: number | null = null;

    /** Last cursor written, so repeated hover passes do not touch the DOM again. */
    let cursor = '';

    const setCursor = (value: string) => {
      if (value === cursor) return;
      cursor = value;
      canvas.style.cursor = value;
    };

    /** Glyph for a hover state: open jaws mean "press to grab", closed ones mean "held". */
    const cursorFor = (mode: HoverMode): string => {
      if (mode === 'drag') return OPEN_CLAMP_CURSOR;
      if (mode === 'pin') return PIN_CURSOR;
      if (mode === 'unpin') return UNPIN_CURSOR;
      return 'default';
    };

    /**
     * Applies a hover decision: the pin highlight follows the state, the cursor follows the mode
     * unless a drag is holding the closed clamp.
     */
    const applyHover = (next: Hover) => {
      if (next.mode !== hover.mode || next.pin !== hover.pin) {
        hover = next;
        engineRef.current?.setHoveredPin(next.mode === 'unpin' ? next.pin : null);
      }
      // A held cloth keeps the closed clamp; releasing repaints from refreshHover().
      if (dragPointer === null) setCursor(cursorFor(next.mode));
    };

    const refreshHover = () => {
      if (!pointer) {
        applyHover(CAMERA);
        return;
      }
      applyHover(classify(pointer.x, pointer.y, mods, false));
    };

    // Hover costs a cloth raycast plus a body-occlusion walk, so the pointer is resolved at most
    // once per frame; presses still classify synchronously and never read a stale answer.
    let hoverFrame = 0;
    const scheduleHover = () => {
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        refreshHover();
      });
    };

    /** Runs a pin change and lets the toolbars re-read the pinned set. */
    const applyPin = (engine: GarmentEngine, index: number, pinned: boolean) => {
      void engine.setPin(index, pinned).then(() => {
        useSimStore.getState().bumpPins();
        // The marker set just changed, so the cursor may no longer point at a pin.
        refreshHover();
      });
    };

    const onPointerMove = (e: PointerEvent) => {
      mods = { alt: e.altKey, shift: e.shiftKey };
      pointer = { x: e.clientX, y: e.clientY };
      if (dragPointer !== null) {
        if (e.pointerId !== dragPointer) return;
        const { x, y } = toNdc(e.clientX, e.clientY);
        engineRef.current?.moveClothDrag(x, y);
        return;
      }
      if (e.pointerType === 'touch') return;
      scheduleHover();
    };

    // Capture on the parent runs before OrbitControls' canvas listener,
    // so stopPropagation suppresses orbit only for cloth drags and pin clicks.
    const onPointerDown = (e: PointerEvent) => {
      pointerConsumed = false;
      // One drag at a time: a second finger must not restart the grab elsewhere.
      if (dragPointer !== null) return;
      const engine = engineRef.current;
      if (!engine || e.button !== 0) return;
      const touch = e.pointerType === 'touch';
      const target = classify(e.clientX, e.clientY, mods, touch);
      if (target.mode === 'camera') return;
      // Keep the cursor glyph in step with the gesture that is about to start.
      if (!touch) applyHover(target);

      const { x, y } = toNdc(e.clientX, e.clientY);
      if (target.mode === 'drag') {
        if (!engine.beginClothDrag(x, y)) return;
        pointerConsumed = true;
        dragPointer = e.pointerId;
        e.stopPropagation();
        e.preventDefault();
        setCursor(CLAMP_CURSOR);
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      pointerConsumed = true;
      e.stopPropagation();
      if (target.mode === 'unpin') {
        if (target.pin !== null) applyPin(engine, target.pin, false);
        return;
      }
      const hit = engine.pickClothParticleAtScreen(x, y);
      if (!hit) return;
      if (!engine.getPinMarkers().includes(hit.index)) applyPin(engine, hit.index, true);
    };

    /** Releases the cloth held by a pointer and repaints the cursor for where it now stands. */
    const finishDrag = (pointerId: number) => {
      dragPointer = null;
      engineRef.current?.endClothDrag();
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
      refreshHover();
    };

    /** Ends the drag the pointer started, if it is the one that moved or lifted. */
    const endDrag = (e: PointerEvent) => {
      if (dragPointer === null || e.pointerId !== dragPointer) return;
      finishDrag(e.pointerId);
    };

    // Focus loss delivers no pointerup, so a held drag has to be released here.
    const onWindowBlur = () => {
      pointer = null;
      if (dragPointer !== null) finishDrag(dragPointer);
      else applyHover(CAMERA);
    };

    const onPointerLeave = () => {
      if (dragPointer !== null) return;
      pointer = null;
      applyHover(CAMERA);
    };

    /** Alt and Shift switch gestures while the pointer stands still. */
    const onKeyChange = (e: KeyboardEvent) => {
      if (!e.altKey && !e.shiftKey && !mods.alt && !mods.shift) return;
      mods = { alt: e.altKey, shift: e.shiftKey };
      scheduleHover();
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (e.altKey) return;
      selectPanelAt(e.clientX, e.clientY);
    };

    // A finger that lands and lifts without moving selects the panel under it; a mouse
    // keeps double-click so an orbit drag never steals the selection.
    let tap: { x: number; y: number; at: number; id: number } | null = null;
    const onCanvasPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      tap = { x: e.clientX, y: e.clientY, at: performance.now(), id: e.pointerId };
    };
    const onCanvasPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !tap || tap.id !== e.pointerId) return;
      const started = tap;
      tap = null;
      if (pointerConsumed) return;
      if (!isTapGesture(e.clientX - started.x, e.clientY - started.y, performance.now() - started.at)) return;
      selectPanelAt(e.clientX, e.clientY);
    };
    const onCanvasPointerCancel = () => {
      tap = null;
    };

    // Tool, playback and pinned-set changes re-resolve the hover under a resting pointer.
    let lastTool = useUIStore.getState().activeTool;
    let lastPlaying = useSimStore.getState().isPlaying;
    let lastPins = useSimStore.getState().pinsVersion;
    const onStoreChange = () => {
      const ui = useUIStore.getState();
      const sim = useSimStore.getState();
      if (ui.activeTool === lastTool && sim.isPlaying === lastPlaying && sim.pinsVersion === lastPins) return;
      lastTool = ui.activeTool;
      lastPlaying = sim.isPlaying;
      lastPins = sim.pinsVersion;
      scheduleHover();
    };
    const unsubUI = useUIStore.subscribe(onStoreChange);
    const unsubSim = useSimStore.subscribe(onStoreChange);

    container.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('pointerdown', onCanvasPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerup', onCanvasPointerUp);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', onCanvasPointerCancel);
    canvas.addEventListener('pointercancel', endDrag);
    window.addEventListener('keydown', onKeyChange);
    window.addEventListener('keyup', onKeyChange);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerup', onCanvasPointerUp);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', onCanvasPointerCancel);
      canvas.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('keydown', onKeyChange);
      window.removeEventListener('keyup', onKeyChange);
      window.removeEventListener('blur', onWindowBlur);
      unsubUI();
      unsubSim();
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      setCursor('default');
      // The engine releases its own drag when disposed, so nothing outlives the viewport.
    };
  }, [canvasRef, containerRef, engineRef]);
}
