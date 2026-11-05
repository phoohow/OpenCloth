import type { Vec2 } from '@/model/types';
import { panelOutlineWithAllowance, sampleEdge, type PanelMesh } from '@/pattern/panel';
import { buildRegistry } from '@/pattern/panel';
import { edgeCurve } from '@/pattern/geom';
import { computeBBox } from '@/common/geom';
import { idsOfKind } from '@/model';
import { NEAR, type DisplayOptions, type SceneState } from '@/ui/viewport2D/renderTypes';

/** Coarse wireframe edge length while a drag is in flight, so the pane stays responsive. */
const WIREFRAME_DRAG_RESOLUTION_CM = 2.5;

/** Triangle edges of a panel mesh, drawn over its filled outline. */
function drawWireframe(
  ctx: CanvasRenderingContext2D, mesh: PanelMesh, screen: (p: Vec2) => Vec2, offsetCm: number,
): void {
  const { positions2D, indices, vertexCount } = mesh;
  const sx = new Float32Array(vertexCount);
  const sy = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const s = screen({ x: positions2D[i * 2]!, y: positions2D[i * 2 + 1]! + offsetCm });
    sx[i] = s.x;
    sy[i] = s.y;
  }
  ctx.beginPath();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!, b = indices[t + 1]!, c = indices[t + 2]!;
    ctx.moveTo(sx[a]!, sy[a]!); ctx.lineTo(sx[b]!, sy[b]!);
    ctx.moveTo(sx[b]!, sy[b]!); ctx.lineTo(sx[c]!, sy[c]!);
    ctx.moveTo(sx[c]!, sy[c]!); ctx.lineTo(sx[a]!, sy[a]!);
  }
  ctx.strokeStyle = 'rgba(140,200,255,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function drawPanel(
  ctx: CanvasRenderingContext2D, scene: SceneState, panelId: string,
  screen: (p: Vec2) => Vec2, display: DisplayOptions,
): void {
  const { pattern, selection } = scene;
  const panel = pattern.panels[panelId];
  if (!panel || !panel.visible) return;
  const selectedEdges = new Set(idsOfKind(selection, 'edge'));
  const selectedPoints = new Set(idsOfKind(selection, 'point'));
  const isSelected = selection.includes(panel.id) || scene.gradingOutlines === undefined
    && ([...selectedEdges].some(id => panel.outlineEdgeIds.includes(id))
      || [...selectedPoints].some(id => panel.outlineEdgeIds.some(eid => {
        const e = pattern.edges[eid];
        return e && (e.startPointId === id || e.endPointId === id);
      })));

  const outline: Vec2[] = [];
  for (const edgeId of panel.outlineEdgeIds) {
    const pts = sampleEdge(pattern, edgeId);
    for (let i = 0; i < pts.length; i++) {
      if (i === 0 && outline.length > 0) {
        const last = outline[outline.length - 1];
        if (Math.abs(last.x - pts[i].x) < NEAR && Math.abs(last.y - pts[i].y) < NEAR) continue;
      }
      outline.push(pts[i]);
    }
  }
  if (outline.length < 2) return;

  ctx.beginPath();
  outline.forEach((p, i) => {
    const s = screen(p);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = isSelected ? 'rgba(100,180,255,0.18)' : 'rgba(200,200,210,0.08)';
  ctx.fill();
  ctx.strokeStyle = isSelected ? '#4da6ff' : '#9aa0b0';
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.stroke();

  if (display.wireframe) {
    // Coarse while a drag is in flight; otherwise the panel's own edge length, which is the same
    // value the 3D cloth build resolves, so both sides draw one shared mesh instance.
    const resolutionCm = scene.preview ? WIREFRAME_DRAG_RESOLUTION_CM : panel.meshResolutionCm;
    const mesh = buildRegistry.meshOf(scene.meshPattern ?? pattern, panel.id, resolutionCm, scene.simulation);
    if (mesh) drawWireframe(ctx, mesh, screen, scene.offsets?.get(panel.id) ?? 0);
  }

  // 毛边: the cutting outline the offset kernel produces, corner joins and per-edge amounts included.
  if (display.seamAllowance && (panel.seamAllowanceCm > 0 || panel.outlineEdgeIds.some(id => pattern.edges[id]?.seamAllowanceCm !== undefined))) {
    const rough = panelOutlineWithAllowance(pattern, panel);
    if (rough.length >= 3) {
      ctx.save();
      ctx.strokeStyle = 'rgba(190,150,90,0.9)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      rough.forEach((p, i) => {
        const s = screen(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  for (const loop of panel.holes ?? []) {
    ctx.beginPath();
    let first = true;
    for (const edgeId of loop) {
      for (const p of sampleEdge(pattern, edgeId)) {
        const s = screen(p);
        if (first) { ctx.moveTo(s.x, s.y); first = false; } else ctx.lineTo(s.x, s.y);
      }
    }
    ctx.closePath();
    ctx.strokeStyle = '#9aa0b0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Per-edge highlight while edges are selectable.
  if (selectedEdges.size > 0 || scene.draft?.tool === 'seam') {
    ctx.save();
    ctx.lineWidth = 4;
    for (const edgeId of panel.outlineEdgeIds) {
      if (!selectedEdges.has(edgeId)) continue;
      ctx.strokeStyle = '#ffd75e';
      ctx.beginPath();
      sampleEdge(pattern, edgeId).forEach((p, i) => {
        const s = screen(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }
    ctx.restore();
  }

  // Panel name label at the outline center
  const bbox = computeBBox(outline);
  const center = screen({ x: (bbox.min.x + bbox.max.x) / 2, y: (bbox.min.y + bbox.max.y) / 2 });
  ctx.fillStyle = isSelected ? '#4da6ff' : '#777';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(panel.name, center.x, center.y);

  // Outline vertices; larger handles when the panel is selected
  const shown = new Set<string>();
  for (const edgeId of panel.outlineEdgeIds) {
    const edge = pattern.edges[edgeId];
    if (!edge) continue;
    for (const pointId of [edge.startPointId, edge.endPointId]) {
      if (shown.has(pointId)) continue;
      shown.add(pointId);
      const point = pattern.points[pointId];
      if (!point) continue;
      const s = screen(point.pos);
      const picked = selectedPoints.has(pointId);
      ctx.beginPath();
      ctx.arc(s.x, s.y, picked ? 5 : isSelected ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = picked ? '#ffd75e' : isSelected ? '#4da6ff' : '#ccc';
      ctx.fill();
    }
  }

  // Curve handles of picked points, editable in the select tool.
  if (isSelected || selectedPoints.size > 0) {
    for (const edgeId of panel.outlineEdgeIds) {
      const edge = pattern.edges[edgeId];
      if (!edge) continue;
      const curve = edgeCurve(pattern, edge);
      if (!curve) continue;
      const showStart = selectedPoints.has(edge.startPointId) || isSelected;
      const showEnd = selectedPoints.has(edge.endPointId) || isSelected;
      for (const [show, handle, anchor] of [
        [showStart, curve.c0, curve.p0], [showEnd, curve.c1, curve.p1],
      ] as const) {
        if (!show) continue;
        const hs = screen(handle);
        const as = screen(anchor);
        ctx.strokeStyle = 'rgba(255,215,94,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(as.x, as.y); ctx.lineTo(hs.x, hs.y);
        ctx.stroke();
        ctx.fillStyle = '#ffd75e';
        ctx.beginPath();
        ctx.rect(hs.x - 3, hs.y - 3, 6, 6);
        ctx.fill();
      }
    }
  }
}
