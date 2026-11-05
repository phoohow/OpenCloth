import { useEffect, useRef, useState } from 'react';
import {
  createRendererContext, resizeRenderer, applyLightConfig, detectWebGPU,
  disposeRendererContext, setRendererMode, type RendererContext,
} from '../../render/renderer/rendererContext';
import { GarmentEngine } from '../../core/engine/garmentEngine';
import { useProjectStore, useSimStore, useUIStore, usePerfStore, isSplitLayout, type ViewLayout, type ToolType } from '../../store/stores';
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
const statusHint = (layout: ViewLayout, tool: ToolType): string => {
  if (isMobileUi()) return MOBILE_VIEWPORT_HINT;
  if (tool === 'pin') {
    return '3D 试衣 · 悬停到布料上出现「圆圈+红点」时点击即打PIN · 其余位置照常旋转缩放（拖动旋转 · 滚轮缩放 · 右键平移）· 双击选择版片';
  }
  if (tool === 'unpin') {
    return '3D 试衣 · 悬停到已有 PIN 上出现叉号时点击即拔PIN，该点会同时高亮 · 其余位置照常旋转缩放 · 滚轮缩放 · 右键平移';
  }
  if (tool === 'sketch3d') {
    return '3D 试衣 · 在布料表面按住拖动画线，松手后落到所属版片的内部线 · 其余位置照常旋转缩放';
  }
  if (tool === 'measure3d') {
    return '3D 试衣 · 单击布料表面两点测量直线距离，第三次单击重新开始，Esc 清除 · 其余位置照常旋转缩放';
  }
  return isSplitLayout(layout)
    ? '3D 试衣 · 移动中悬停布料可用夹子拖拽 · 拖拽旋转 · 滚轮缩放 · 双击选片 · 快捷键需点击聚焦本窗格'
    : '3D 试衣 · 模拟中夹住布料可拖拽 · 拖拽旋转 · 滚轮缩放 · 右键平移 · Alt+点击打PIN · Alt+Shift+点击取消PIN · 双击选择版片 · 小键盘 2/8/4/6/0/5 正视/后视/左视/右视/仰视/俯视，1/3/7/9 四个 45° 侧视 · Esc取消选中';
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
  const activeTool = useUIStore(s => s.activeTool);
  const measure3d = useUIStore(s => s.measure3d);
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
      // A stored camera wins; otherwise the front preset frames the whole scene box.
      const savedCamera = initial.scene.camera;
      const projection = savedCamera?.projection ?? useUIStore.getState().cameraProjection;
      engine.setProjection(projection);
      if (projection !== useUIStore.getState().cameraProjection) {
        useUIStore.getState().setCameraProjection(projection);
      }
      if (savedCamera) engine.setCameraState(savedCamera);
      else engine.setCameraPreset('front');
      syncSelectionOverlay(engine, initial.pattern, useUIStore.getState().selection);
      useSimStore.getState().bumpPins();
      try {
        await setRendererMode(ctx, useUIStore.getState().renderMode);
      } catch (error) {
        if (!cancelled) recoverWithRaster(ctx, error, setRenderError);
      }

      onEngineReady?.(engine, ctx);

      // Store sync and the frame loop live in the controller from here on.
      sync = new EngineSync(engine, ctx, setRenderError, initial);

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
      {/* The pointer cursor is owned by useClothPicking: it depends on what is under it. */}
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', cursor: 'default' }} />
      <ViewportHint right={isMobileUi() ? MOBILE_HINT_RIGHT : 8}>{statusHint(layout, activeTool)}</ViewportHint>
      {renderMode === 'raytraced' && !isMobileUi() && (
        <div style={{
          position: 'absolute', top: 8, left: 8, padding: '5px 8px', color: '#bde7ff',
          background: 'rgba(18, 39, 55, 0.84)', border: '1px solid #2f6d92',
          borderRadius: 4, fontSize: 'var(--oc-fs-micro)', pointerEvents: 'none',
        }}>光线追踪 · {rayTraceStateLabel(rayState3D) || '渐进采样'}</div>
      )}
      {measure3d && (
        <div style={{
          position: 'absolute', top: renderMode === 'raytraced' && !isMobileUi() ? 40 : 8, left: 8,
          padding: '5px 8px', color: '#ffe2a6', background: 'rgba(55, 43, 18, 0.86)',
          border: '1px solid #8a6030', borderRadius: 4, fontSize: 'var(--oc-fs-micro)', pointerEvents: 'none',
        }}>
          3D 测量 · {measure3d.distanceCm === null ? '已选第 1 点，单击第 2 点' : `${measure3d.distanceCm.toFixed(2)} cm`}
        </div>
      )}
      {renderError && (
        <div style={{
          position: 'absolute', top: 8, right: 8, maxWidth: isMobileUi() ? '72%' : 360,
          padding: '7px 10px',
          color: '#ffd9a0', background: 'rgba(60, 38, 20, 0.92)', border: '1px solid #8a6030',
          borderRadius: 4, fontSize: 'var(--oc-fs-body)', pointerEvents: 'none',
        }}>{renderError}</div>
      )}
    </div>
  );
}
