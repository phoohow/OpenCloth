import type { BodyLandmarks } from '@/avatar';
import type { Vec2 } from '@/model/types';
import type { Pen } from '@/ui/viewport2D/pen';

import { mToCm } from '@/base/units';
import { bodySilhouette } from '@/scene';

const FILL = 'rgba(146,158,186,0.055)';

const OUTLINE = 'rgba(152,164,192,0.22)';

const RULE = 'rgba(152,164,192,0.16)';

const LABEL = 'rgba(160,172,198,0.42)';

export interface BodyGuideMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface BodyGuideSource {
  body: BodyLandmarks;
  mesh: BodyGuideMesh;
}

export interface BodyGuideRule {
  y: number;
  halfWidth: number;
  label: string;
}

export interface BodyGuideGeometry {
  outlines: Vec2[][];
  rules: BodyGuideRule[];
}

export function bodyGuideGeometry(source: BodyGuideSource): BodyGuideGeometry {
  const { body, mesh } = source;
  const outlines = bodySilhouette(mesh.positions, mesh.indices);

  const rule = (y: number, width: number, label: string): BodyGuideRule => ({
    y: mToCm(y), halfWidth: mToCm(width) * 1.25, label,
  });
  const rules = [
    rule(body.shoulderTopY, body.shoulderHalfW, '肩线'),
    rule(body.bustY, body.chestHalfW, '胸围'),
    rule(body.waistY, body.waistHalfW, '腰围'),
    rule(body.hipY, body.hipHalfW, '臀围'),
    rule(body.crotchY, body.hipHalfW * 0.7, '裆线'),
    rule(body.kneeY, body.hipX + body.kneeR, '膝线'),
  ];
  return { outlines, rules };
}

function trace(pen: Pen, rings: readonly Vec2[][]): void {
  for (const ring of rings) {
    ring.forEach((point, index) => {
      const s = pen.screen(point);
      if (index === 0) pen.ctx.moveTo(s.x, s.y); else pen.ctx.lineTo(s.x, s.y);
    });
    pen.ctx.closePath();
  }
}

export function drawBodyGuide(pen: Pen, geometry: BodyGuideGeometry): void {
  const { ctx } = pen;
  const { outlines, rules } = geometry;

  ctx.beginPath();
  trace(pen, outlines);
  ctx.fillStyle = FILL;
  ctx.fill();

  ctx.beginPath();
  trace(pen, outlines);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const item of rules) {
    const a = pen.screen({ x: -item.halfWidth, y: item.y });
    const b = pen.screen({ x: item.halfWidth, y: item.y });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }

  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = LABEL;
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  for (const item of rules) {
    const s = pen.screen({ x: item.halfWidth, y: item.y });
    ctx.fillText(item.label, s.x + 4, s.y - 2);
  }

  ctx.restore();
}
