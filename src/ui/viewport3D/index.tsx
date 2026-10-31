import { useEffect, useRef, useState } from 'react';
import {
  createRendererContext, resizeRenderer, applyLightConfig, detectWebGPU,
  disposeRendererContext, setRendererMode, type RendererContext,
} from '../../render/renderer/rendererContext';
import { GarmentEngine } from '../../core/engine/garmentEngine';
import { useProjectStore, useSimStore, useUIStore, usePerfStore, isSplitLayout, type ViewLayout } from '../../store/stores';
import { EngineSync, recoverWithRaster, syncSelectionOverlay } from './engineSync';
import { useClothPicking } from './useClothPicking';
import { ViewportHint } from '../widgets/viewportHint';
import { normalizeRayTracing } from '../../core/model/defaults';
import { rayTraceStateLabel } from '../optionTables';
import { MOBILE_VIEWPORT_HINT, isMobileUi } from '../mobile/mobileUi';

/** Width the phone shell's floating buttons reserve at the right of the pane. */
const MOBILE_HINT_RIGHT = 72;

interface Viewport3DProps {
  onEngineReady?: (engine: GarmentEngine, ctx: RendererContext) => void;
}

/** Gestures the current layout allows. */
const statusHint = (layout: ViewLayout): string => {
  if (isMobileUi()) return MOBILE_VIEWPORT_HINT;
  return isSplitLayout(layout)
    ? '3D 试衣 · 拖拽旋转 · 滚轮缩放 · 双击选片 · 快捷键需点击聚焦本窗格'
    : '3D 试衣 · 拖拽旋转 · 滚轮缩放 · 右键平移 · Alt+点击打PIN · Alt+Shift+点击取消PIN · 双击选择版型片 · 小键盘 2/8/4/6/0/5 正视/后视/左视/右视/仰视/俯视，1/3/7/9 四个 45° 侧视 · Esc取消选中';
};

/** 3D fitting viewport: owns the renderer context, the garment engine and their store sync. */
export function Viewport3D({ onEngineReady }: Viewport3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<RendererContext | null>(null);
  const engineRef = useRef<GarmentEngine | null>(null);
  const errorRef = useRef<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const renderMode = useUIStore(s => s.renderMode);
  const layout = useUIStore(s => s.layout);
  const rayState3D = usePerfStore(s => s.rayState3D);

  useEffect(() => {
    let cancelled = false;
    let sync: EngineSync | null = null;

    async function init() {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const supported = await detectWebGPU();
      if (!supported) {
        errorRef.current = 'WebGPU 不支持';
        const errEl = document.getElementById('webgpu-error');
        if (errEl) errEl.style.display = 'block';
        return;
      }

      canvas.width = Math.max(1, container.clientWidth);
      canvas.height = Math.max(1, container.clientHeight);

      const initial = useProjectStore.getState().project;
      const ctx = await createRendererContext(canvas);
      if (cancelled) {
        // StrictMode's second mount owns the canvas now; release the abandoned renderer.
        disposeRendererContext(ctx);
        return;
      }
      ctxRef.current = ctx;
      ctx.rayConfig = normalizeRayTracing(initial.scene.render.rayTracing);

      applyLightConfig(ctx, initial.scene.lights, initial.scene.render);

      const engine = new GarmentEngine(ctx);
      engineRef.current = engine;
      await engine.applyEnvironment(initial);

      await engine.buildFromProject(initial);
      await engine.initSimulator(initial);
      if (cancelled) {
        // The cleanup that cancelled this init ran before these refs existed.
        engine.dispose();
        disposeRendererContext(ctx);
        ctxRef.current = null;
        engineRef.current = null;
        return;
      }
      // The first view is the front preset, framed on the whole scene box.
      engine.setProjection(useUIStore.getState().cameraProjection);
      engine.setCameraPreset('front');
      syncSelectionOverlay(engine, initial.pattern, useUIStore.getState().selection);
      useSimStore.getState().bumpPins();
      try {
        await setRendererMode(ctx, useUIStore.getState().renderMode);
      } catch (error) {
        if (!cancelled) recoverWithRaster(ctx, error, setRenderError);
      }

      onEngineReady?.(engine, ctx);

      // Store sync and the frame loop live in the controller from here on.
      sync = new EngineSync(engine, ctx, setRenderError);

      // Resize handling
      const ro = new ResizeObserver(() => {
        if (!container || !ctxRef.current) return;
        const w = container.clientWidth, h = container.clientHeight;
        if (w === 0 || h === 0) return;
        canvas!.width = w; canvas!.height = h;
        resizeRenderer(ctxRef.current, w, h);
      });
      ro.observe(container);
      ctx.resizeObserver = ro;
    }

    init();

    return () => {
      cancelled = true;
      sync?.dispose();
      engineRef.current?.dispose();
      if (ctxRef.current) disposeRendererContext(ctxRef.current);
      engineRef.current = null;
      ctxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useClothPicking(canvasRef, containerRef, engineRef);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      <ViewportHint right={isMobileUi() ? MOBILE_HINT_RIGHT : 8}>{statusHint(layout)}</ViewportHint>
      {renderMode === 'raytraced' && !isMobileUi() && (
        <div style={{
          position: 'absolute', top: 8, left: 8, padding: '5px 8px', color: '#bde7ff',
          background: 'rgba(18, 39, 55, 0.84)', border: '1px solid #2f6d92',
          borderRadius: 4, fontSize: 11, pointerEvents: 'none',
        }}>光线追踪 · {rayTraceStateLabel(rayState3D) || '渐进采样'}</div>
      )}
      {renderError && (
        <div style={{
          position: 'absolute', top: 8, right: 8, maxWidth: isMobileUi() ? '72%' : 360,
          padding: '7px 10px',
          color: '#ffd9a0', background: 'rgba(60, 38, 20, 0.92)', border: '1px solid #8a6030',
          borderRadius: 4, fontSize: 12, pointerEvents: 'none',
        }}>{renderError}</div>
      )}
    </div>
  );
}
