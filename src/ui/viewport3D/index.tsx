import { useEffect, useRef, useState } from 'react';
import type { Viewport } from '@/runtime';
import { useRenderHost, type RenderSession } from '@/ui/viewport3D/renderHost';
import { useProjectStore, useSimStore, useUIStore, usePerfStore, auxProxyOnly, auxWire, isSplitLayout, type ViewLayout, type ToolType } from '@/store';
import { EngineSync, fallBackToRaster, syncSelectionOverlay } from '@/ui/viewport3D/engineSync';
import { useClothPicking } from '@/ui/viewport3D/useClothPicking';
import { useTransformGizmo } from '@/ui/viewport3D/useTransformGizmo';
import { TransformGizmoOverlay } from '@/ui/viewport3D/transformGizmoOverlay';
import { TransformModeSwitch } from '@/ui/viewport3D/transformModeSwitch';
import { AxisIndicator } from '@/ui/viewport3D/axisIndicator';
import { ViewportHint } from '@/ui/widgets/viewportHint';
import { rayTraceStateLabel } from '@/ui/optionTables';
import { MOBILE_VIEWPORT_HINT, isMobileUi } from '@/ui/mobile/mobileUi';
import { isAssetDrag, endAssetDrag, readAssetDrag } from '@/ui/assets/assetDrag';
import { applyFabricToPanels, panelCentre, placeTrimOnPanel } from '@/ui/assets/applyAsset';

/** Width the phone shell's floating buttons reserve at the right of the pane. */
const MOBILE_HINT_RIGHT = 72;

interface Viewport3DProps {
  onEngineReady?: (engine: Viewport['engine'], viewport: Viewport) => void;
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
  const gizmo = '选中版片后拖动辅助轴变换（W 平移 / E 旋转 / S 缩放，Esc 取消拖动）';
  return isSplitLayout(layout)
    ? `3D 试衣 · 移动中悬停布料可用夹子拖拽 · 拖拽旋转 · 滚轮缩放 · 双击选片 · ${gizmo} · 快捷键需点击聚焦本窗格`
    : `3D 试衣 · 模拟中夹住布料可拖拽 · 拖拽旋转 · 滚轮缩放 · 右键平移 · Alt+点击打PIN · Alt+Shift+点击取消PIN · 双击选择版片 · ${gizmo} · 左下角坐标轴可点击切换视角 · 小键盘 2/8/4/6/0/5 正视/后视/左视/右视/仰视/俯视，1/3/7/9 四个 45° 侧视 · Esc取消选中`;
};

/** 3D fitting viewport: owns the renderer context, the garment engine and their store sync. */
export function Viewport3D({ onEngineReady }: Viewport3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const engineRef = useRef<Viewport['engine'] | null>(null);
  const errorRef = useRef<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  /** Pointer position of a catalogue drag inside the pane, for the landing marker. */
  const [dropPoint, setDropPoint] = useState<{ x: number; y: number } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const renderHost = useRenderHost();

  const backend = useUIStore(s => s.backend);
  const aux = useUIStore(s => s.aux);
  const layout = useUIStore(s => s.layout);
  const activeTool = useUIStore(s => s.activeTool);
  const measure3d = useUIStore(s => s.measure3d);
  const rayState3D = usePerfStore(s => s.rayState3D);
  // Wire-only and simplified-model-only frames never trace.
  const tracing = backend === 'pathtrace' && auxWire(aux) !== 'only' && !auxProxyOnly(aux);

  useEffect(() => {
    let cancelled = false;
    let sync: EngineSync | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let session: RenderSession | null = null;

    async function init() {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      canvas.width = Math.max(1, container.clientWidth);
      canvas.height = Math.max(1, container.clientHeight);

      const initial = useProjectStore.getState().project;
      session = await renderHost(canvas, {
        onDenoiseFailure: message => useUIStore.getState().showToast(message),
        onDeviceLost: reason => setRenderError(`GPU 上下文丢失：${reason}`),
        onTraceFailure: capability => fallBackToRaster(
          { failure: capability.failure ?? 'setup-failed', detail: capability.detail },
          setRenderError,
        ),
      });
      if (!session) {
        errorRef.current = 'WebGPU 不支持';
        const errEl = document.getElementById('webgpu-error');
        if (errEl) errEl.style.display = 'block';
        return;
      }
      if (cancelled) {
        // StrictMode's second mount owns the canvas now; release the abandoned stack.
        session.dispose();
        session = null;
        return;
      }
      const viewport = session.viewport;
      viewportRef.current = viewport;
      const engine = viewport.engine;
      engineRef.current = engine;
      viewport.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
      viewport.applyProject(initial);
      await viewport.applyLighting(initial);

      await engine.buildFromProject(initial);
      await engine.initSimulator(initial);
      if (cancelled) {
        // The cleanup that cancelled this init ran before these refs existed.
        session.dispose();
        session = null;
        viewportRef.current = null;
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
      onEngineReady?.(engine, viewport);
      setSessionReady(true);

      // Store sync and the frame loop live in the controller from here on.
      sync = new EngineSync(viewport, setRenderError, initial);

      // Resize handling
      resizeObserver = new ResizeObserver(() => {
        if (!container || !viewportRef.current) return;
        const w = container.clientWidth, h = container.clientHeight;
        if (w === 0 || h === 0) return;
        viewportRef.current.resize(w, h);
      });
      resizeObserver.observe(container);
    }

    init();

    return () => {
      cancelled = true;
      setSessionReady(false);
      resizeObserver?.disconnect();
      sync?.dispose();
      session?.dispose();
      session = null;
      viewportRef.current = null;
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The gizmo listener owns the capture phase first, so a handle press never starts a camera orbit.
  const gizmo = useTransformGizmo(canvasRef, containerRef, engineRef, viewportRef);
  useClothPicking(canvasRef, containerRef, engineRef);

  /** Screen point of a drag as normalized device coordinates. */
  const dragNdc = (e: React.DragEvent): { x: number; y: number } | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    };
  };

  /** Shows where the pointer of a catalogue drag sits, and clears the marker on leaving. */
  const handleAssetDragOver = (e: React.DragEvent) => {
    if (!isAssetDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setDropPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleAssetDragLeave = (e: React.DragEvent) => {
    if (!isAssetDrag(e)) return;
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropActive(false);
    setDropPoint(null);
  };

  /** Applies a dragged material to the panel under the drop, or places a trim on the hit point. */
  const handleAssetDrop = (e: React.DragEvent) => {
    const payload = readAssetDrag(e);
    if (!payload) return;
    e.preventDefault();
    endAssetDrag();
    setDropActive(false);
    setDropPoint(null);
    const engine = engineRef.current;
    const ndc = dragNdc(e);
    const panelId = engine && ndc ? engine.pickPanelAtScreen(ndc.x, ndc.y) : null;
    if (!engine || !ndc || !panelId) {
      useUIStore.getState().showToast('拖到布料上才能应用');
      return;
    }
    if (payload.kind === 'fabric') {
      applyFabricToPanels([panelId], payload.asset);
      return;
    }
    const surface = engine.pickClothSurface2D(ndc.x, ndc.y);
    placeTrimOnPanel(panelId, surface?.point ?? panelCentre(panelId), payload.asset);
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%', height: '100%', position: 'relative',
        boxShadow: dropActive ? 'inset 0 0 0 2px #4da6ff' : 'none',
      }}
      onDragOver={handleAssetDragOver}
      onDragLeave={handleAssetDragLeave}
      onDrop={handleAssetDrop}
    >
      {/* The pointer cursor is owned by useClothPicking: it depends on what is under it. */}
      <canvas
        ref={canvasRef}
        data-testid="viewport-3d"
        style={{ display: 'block', width: '100%', height: '100%', cursor: 'default' }}
      />
      <TransformGizmoOverlay state={gizmo} />
      {dropActive && dropPoint && <DropMarker point={dropPoint} />}
      <DragForceBadge />
      {isMobileUi() && gizmo.layout && <TransformModeSwitch />}
      {sessionReady && <AxisIndicator viewportRef={viewportRef} engineRef={engineRef} />}
      <ViewportHint right={isMobileUi() ? MOBILE_HINT_RIGHT : 8}>{statusHint(layout, activeTool)}</ViewportHint>
      {tracing && !isMobileUi() && (
        <div style={{
          position: 'absolute', top: 8, left: 8, padding: '5px 8px', color: '#bde7ff',
          background: 'rgba(18, 39, 55, 0.84)', border: '1px solid #2f6d92',
          borderRadius: 4, fontSize: 'var(--oc-fs-micro)', pointerEvents: 'none',
        }}>光线追踪 · {rayTraceStateLabel(rayState3D) || '渐进采样'}</div>
      )}
      {measure3d && (
        <div style={{
          position: 'absolute', top: tracing && !isMobileUi() ? 40 : 8, left: 8,
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

/** Pull force of the held cloth, drawn above the head of its arrow. */
function DragForceBadge() {
  const readout = useUIStore(s => s.dragForce3d);
  if (!readout) return null;
  return (
    <div style={{
      position: 'absolute', left: readout.x, top: readout.y - 12,
      transform: 'translate(-50%, -100%)',
      color: '#eaf7ff', fontSize: 'var(--oc-fs-micro)', fontWeight: 600,
      textShadow: '0 0 3px rgba(0, 0, 0, 0.9), 0 1px 2px rgba(0, 0, 0, 0.9)',
      pointerEvents: 'none', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
    }}>
      {readout.forceN.toFixed(2)} N
    </div>
  );
}

/** Ring marking where a dragged catalogue asset would land on the cloth. */
function DropMarker({ point }: { point: { x: number; y: number } }) {
  return (
    <div style={{
      position: 'absolute', left: point.x, top: point.y, width: 24, height: 24,
      transform: 'translate(-50%, -50%)', borderRadius: '50%', border: '2px solid #4da6ff',
      background: 'rgba(77,166,255,0.18)', pointerEvents: 'none',
    }}>
      <span style={{
        position: 'absolute', left: '50%', top: '50%', width: 4, height: 4,
        marginLeft: -2, marginTop: -2, borderRadius: '50%', background: '#4da6ff',
      }} />
    </div>
  );
}
