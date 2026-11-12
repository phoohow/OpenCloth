import { appliedLimbPose, armChain, legChain, type BodyLandmarks } from '@/avatar';
import { unionPolygons } from '@/base/geom/polygonBoolean';
import type { JointPose, Vec2 } from '@/model/types';
import type { Pen } from '@/ui/viewport2D/pen';

/** Centimetres in one metre of body space. */
const CM = 100;

/** Quiet body colours; the reference stays behind the pattern without competing with it. */
const FILL = 'rgba(146,158,186,0.055)';
const OUTLINE = 'rgba(152,164,192,0.22)';
const RULE = 'rgba(152,164,192,0.16)';
const LABEL = 'rgba(160,172,198,0.42)';

/** Body data behind the non-selectable front-view reference. */
export interface BodyGuideSource {
  body: BodyLandmarks;
  /** Joint rotations of the posed mannequin. */
  joints?: JointPose;
}

/** One horizontal construction rule across the body. */
export interface BodyGuideRule {
  /** Height above the ground in centimetres. */
  y: number;
  /** Half length of the rule in centimetres. */
  halfWidth: number;
  label: string;
}

/** Merged front-view silhouette and landmark rules, in pattern centimetres. */
export interface BodyGuideGeometry {
  /** Every ring of the silhouette, holes included. */
  outlines: Vec2[][];
  /** Exterior rings only, stroked so no interior seam shows. */
  contours: Vec2[][];
  rules: BodyGuideRule[];
}

/** Projects a body-space point onto the front plane, in centimetres. */
function front(p: readonly number[]): Vec2 {
  return { x: p[0] * CM, y: p[1] * CM };
}

/** Closed ellipse outline. */
function ellipseOutline(cx: number, cy: number, rx: number, ry: number, steps = 24): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    out.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry });
  }
  return out;
}

/** Round-ended tapered band around a segment. */
function limbOutline(a: Vec2, b: Vec2, r0: number, r1: number, steps = 8): Vec2[] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const normal = angle + Math.PI / 2;
  const cn = Math.cos(normal);
  const sn = Math.sin(normal);
  const out: Vec2[] = [
    { x: a.x + cn * r0, y: a.y + sn * r0 },
    { x: b.x + cn * r1, y: b.y + sn * r1 },
  ];
  for (let i = 1; i < steps; i++) {
    const cap = normal - (Math.PI * i) / steps;
    out.push({ x: b.x + Math.cos(cap) * r1, y: b.y + Math.sin(cap) * r1 });
  }
  out.push({ x: b.x - cn * r1, y: b.y - sn * r1 });
  out.push({ x: a.x - cn * r0, y: a.y - sn * r0 });
  for (let i = 1; i < steps; i++) {
    const cap = normal + Math.PI - (Math.PI * i) / steps;
    out.push({ x: a.x + Math.cos(cap) * r0, y: a.y + Math.sin(cap) * r0 });
  }
  return out;
}

/** Left and right edges of the lofted torso, from the crotch up to the jaw. */
function torsoOutline(body: BodyLandmarks): Vec2[] {
  const bottom = body.crotchY * CM;
  // Neck overlaps the head.
  const top = (body.neckTopY + body.headH * 0.06) * CM;
  const steps = 36;
  const right: Vec2[] = [];
  const left: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = bottom + ((top - bottom) * i) / steps;
    const cx = body.torsoCenterXAt(y / CM) * CM;
    const rx = body.torsoSectionAt(y / CM).rx * CM;
    right.push({ x: cx + rx, y });
    left.push({ x: cx - rx, y });
  }
  return [...right, ...left.reverse()];
}

/** Front silhouette and construction rules of the mannequin sharing the 3D body dimensions. */
export function bodyGuideGeometry(source: BodyGuideSource): BodyGuideGeometry {
  const { body, joints } = source;
  const parts: Vec2[][] = [torsoOutline(body)];

  parts.push(ellipseOutline(
    body.torsoCenterXAt(body.headCenterY) * CM, body.headCenterY * CM,
    body.headHalfW * CM, (body.headH * CM) / 2,
  ));

  const shoulderLean = body.torsoCenterXAt(body.shoulderY) * CM;
  for (const side of [-1, 1] as const) {
    parts.push(ellipseOutline(
      shoulderLean + side * body.shoulderX * CM, body.shoulderY * CM,
      body.deltoidR * CM, body.deltoidR * CM * 1.4,
    ));

    const arm = armChain(body, side, appliedLimbPose(joints, side));
    const shoulder = front(arm.root);
    const elbow = front(arm.mid);
    const wrist = front(arm.end);
    const fingertip = {
      x: wrist.x + arm.dir2[0] * body.handLen * CM,
      y: wrist.y + arm.dir2[1] * body.handLen * CM,
    };
    parts.push(limbOutline(shoulder, elbow, body.armR * CM, body.elbowR * CM));
    parts.push(limbOutline(elbow, wrist, body.forearmR * CM, body.wristR * CM));
    parts.push(limbOutline(wrist, fingertip, body.handHalfW * CM, body.handHalfW * CM * 0.7));

    const leg = legChain(body, side, appliedLimbPose(joints, side));
    const hip = front(leg.root);
    const knee = front(leg.mid);
    const ankle = front(leg.end);
    parts.push(limbOutline(hip, knee, body.thighTopR * CM, body.kneeR * CM));
    parts.push(limbOutline(knee, ankle, body.calfR * CM, body.ankleR * CM));
    parts.push(ellipseOutline(ankle.x, ankle.y / 2, body.footHalfW * CM * 1.35, ankle.y / 2));
  }

  const rule = (y: number, width: number, label: string): BodyGuideRule => ({
    y: y * CM, halfWidth: width * CM * 1.25, label,
  });
  const rules = [
    rule(body.shoulderTopY, body.shoulderHalfW, '肩线'),
    rule(body.bustY, body.chestHalfW, '胸围'),
    rule(body.waistY, body.waistHalfW, '腰围'),
    rule(body.hipY, body.hipHalfW, '臀围'),
    rule(body.crotchY, body.hipHalfW * 0.7, '裆线'),
    rule(body.kneeY, body.hipX + body.kneeR, '膝线'),
  ];
  // Merge parts into one silhouette.
  let outlines: Vec2[][];
  let contours: Vec2[][];
  try {
    const merged = unionPolygons(parts);
    outlines = merged.flat();
    contours = merged.map(poly => poly[0]).filter((ring): ring is Vec2[] => !!ring && ring.length >= 3);
  } catch {
    outlines = parts;
    contours = parts;
  }
  return { outlines, contours, rules };
}

/** Adds closed world-space rings to the current canvas path. */
function trace(pen: Pen, rings: readonly Vec2[][]): void {
  for (const ring of rings) {
    ring.forEach((point, index) => {
      const s = pen.screen(point);
      if (index === 0) pen.ctx.moveTo(s.x, s.y); else pen.ctx.lineTo(s.x, s.y);
    });
    pen.ctx.closePath();
  }
}

/** Paints the body reference behind the pattern, using one path so overlaps never darken. */
export function drawBodyGuide(pen: Pen, geometry: BodyGuideGeometry): void {
  const { ctx } = pen;
  const { outlines, contours, rules } = geometry;

  ctx.beginPath();
  trace(pen, outlines);
  ctx.fillStyle = FILL;
  ctx.fill();

  ctx.beginPath();
  trace(pen, contours);
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
