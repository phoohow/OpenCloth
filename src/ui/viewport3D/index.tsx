import type { Viewport } from '@/runtime';

import { normalizeRayTracing } from '@/model';
import { useProjectStore, useSimStore, useUIStore, usePerfStore, auxHidesModel, auxWire, isSplitLayout, type ViewLayout, type ToolType } from '@/store';
import { applyFabricDrag, panelCentre, placeTrimOnPanel } from '@/ui/assets/applyAsset';
import { isAssetDrag, endAssetDrag, readAssetDrag } from '@/ui/assets/assetDrag';
import { MOBILE_VIEWPORT_HINT, isMobileUi } from '@/ui/mobile/mobileUi';
import { rayTraceStateLabel } from '@/ui/optionTables';
import { formatElapsed } from '@/ui/timeFormat';
import { AxisIndicator } from '@/ui/viewport3D/axisIndicator';
import { EngineSync, fallBackToRaster, syncSelectionOverlay } from '@/ui/viewport3D/engineSync';
import { useRenderHost, type RenderSession } from '@/ui/viewport3D/renderHost';
import { TransformGizmoOverlay } from '@/ui/viewport3D/transformGizmoOverlay';
import { TransformModeSwitch } from '@/ui/viewport3D/transformModeSwitch';
import { useClothPicking } from '@/ui/viewport3D/useClothPicking';
import { useTransformGizmo } from '@/ui/viewport3D/useTransformGizmo';
import { ViewportHint } from '@/ui/widgets/viewportHint';
import { useEffect, useRef, useState } from 'react';

const MOBILE_HINT_RIGHT = 72;

interface Viewport3DProps {
  onEngineReady?: (engine: Viewport['engine'], viewport: Viewport) => void;
}

const statusHint = (layout: ViewLayout, tool: ToolType): string => {
  if (isMobileUi()) return MOBILE_VIEWPORT_HINT;
  if (tool === 'pin') return '3D 试衣 · 打PIN · 悬停布料单击';
  if (tool === 'unpin') return '3D 试衣 · 拔PIN · 单击已有 PIN';
  if (tool === 'sketch3d') return '3D 试衣 · 线稿笔 · 在布料上拖画';
  if (tool === 'measure3d') return '3D 试衣 · 测量 · 点选布料两点';
  return isSplitLayout(layout)
    ? '3D 试衣 · 拖拽旋转 · 滚轮缩放 · 双击选片 · W/E/S 变换'
    : '3D 试衣 · 拖拽旋转 · 滚轮缩放 · 右键平移 · 双击选片 · Alt 打PIN · W/E/S 变换';
};

export function Viewport3D({ onEngineReady }: Viewport3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const engineRef = useRef<Viewport['engine'] | null>(null);
  const errorRef = useRef<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [dropPoint, setDropPoint] = useState<{ x: number; y: number } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const renderHost = useRenderHost();

  const layout = useUIStore(s => s.layout);
  const activeTool = useUIStore(s => s.activeTool);
  const measure3d = useUIStore(s => s.measure3d);

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
      viewport.applyFloor(initial);
      await viewport.applyLighting(initial);

      await engine.buildFromProject(initial);
      await engine.initSimulator(initial);
      if (cancelled) {
        session.dispose();
        session = null;
        viewportRef.current = null;
        engineRef.current = null;
        return;
      }

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

      sync = new EngineSync(viewport, setRenderError, initial);

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

  const gizmo = useTransformGizmo(canvasRef, containerRef, engineRef, viewportRef);
  useClothPicking(canvasRef, containerRef, engineRef);

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

    if (payload.kind === 'trim') {
      const surface = engine.pickClothSurface2D(ndc.x, ndc.y);
      placeTrimOnPanel(panelId, surface?.point ?? panelCentre(panelId), payload.asset);
      return;
    }

    applyFabricDrag([panelId], payload);
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
      {!isMobileUi() && <ViewportStatsBadge />}
      {measure3d && (
        <div style={{
          position: 'absolute', top: !isMobileUi() ? 40 : 8, left: 8,
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

function ViewportStatsBadge() {
  const backend = useUIStore(s => s.backend);
  const aux = useUIStore(s => s.aux);
  const rayState3D = usePerfStore(s => s.rayState3D);
  const rayUnsupported = usePerfStore(s => s.rayUnsupported3D !== null);
  const fps3D = usePerfStore(s => s.fps['3d']);
  const samples3D = usePerfStore(s => s.samples3D);
  const denoiseCount3D = usePerfStore(s => s.denoiseCount3D);
  const costMs3D = usePerfStore(s => s.costMs3D);
  const maxSamples = useProjectStore(s => normalizeRayTracing(s.project.scene.render.rayTracing).maxSamples);
  const measured = useProjectStore(s => s.project.avatar.source !== 'glb');
  const tracing = backend === 'pathtrace' && auxWire(aux) !== 'only' && !auxHidesModel(aux, measured);
  const readout = tracing
    ? `SPP ${samples3D}/${maxSamples} · Oidn ${denoiseCount3D} · Cost ${formatElapsed(costMs3D)}`
    : `FPS: ${fps3D}`;

  return (
    <div style={{
      position: 'absolute', top: 8, left: 8, padding: '5px 8px', color: '#bde7ff',
      background: 'rgba(18, 39, 55, 0.84)', border: '1px solid #2f6d92',
      borderRadius: 4, fontSize: 'var(--oc-fs-micro)', pointerEvents: 'none',
      whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
    }}>
      {tracing || rayUnsupported
        ? `光线追踪 · ${rayUnsupported ? '本机不支持' : rayTraceStateLabel(rayState3D) || '采样中'}`
        : '光栅化'}
      {' · '}{readout}
    </div>
  );
}

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
