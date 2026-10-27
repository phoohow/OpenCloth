/// <reference types="node" />

/** Orthographic camera: yaw around the world Y axis, screen mapping and pixel scale. */
export interface Camera {
  /** Degrees of yaw; 0 looks at the front (+Z toward the viewer). */
  yawDeg: number;
  /** Pixels per meter. */
  scale: number;
  /** Screen column of world x = 0. */
  originX: number;
  /** Screen row of world y = centerY. */
  originY: number;
  /** World height mapped to originY. */
  centerY: number;
}

/** Channel bytes 0-255, in red/green/blue order. */
export type RGB = [number, number, number];
/** Meters along the world x/y/z axes. */
export type XYZ = [number, number, number];

const DEG = Math.PI / 180;
/** Key light direction, normalized. */
const LIGHT: XYZ = normalize([0.35, 0.75, 0.9]);

/** CPU framebuffer with a depth buffer, sized for offline garment inspection. */
export class SoftCanvas {
  readonly px: Uint8Array;
  private readonly dz: Float32Array;

  constructor(readonly width: number, readonly height: number) {
    this.px = new Uint8Array(width * height * 3);
    this.dz = new Float32Array(width * height).fill(-Infinity);
  }

  clear(color: RGB): void {
    for (let i = 0; i < this.width * this.height; i++) {
      this.px[i * 3] = color[0];
      this.px[i * 3 + 1] = color[1];
      this.px[i * 3 + 2] = color[2];
    }
    this.dz.fill(-Infinity);
  }

  /** Maps a world point to screen columns, rows and view depth (larger is nearer). */
  project(cam: Camera, p: XYZ): [number, number, number] {
    const yaw = cam.yawDeg * DEG;
    const xr = p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw);
    const zr = -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw);
    return [cam.originX + xr * cam.scale, cam.originY - (p[1] - cam.centerY) * cam.scale, zr];
  }

  /** Fills one world-space triangle with flat shading; both faces are visible. */
  triangle(cam: Camera, a: XYZ, b: XYZ, c: XYZ, base: RGB): void {
    const pa = this.project(cam, a), pb = this.project(cam, b), pc = this.project(cam, c);
    const normal = triangleNormal(a, b, c);
    // Facing the viewer keeps the shading of a double-sided sheet readable.
    const viewSign = normal[2] >= 0 ? 1 : -1;
    const lit: XYZ = [normal[0] * viewSign, normal[1] * viewSign, normal[2] * viewSign];
    const lambert = Math.max(0, dot(lit, LIGHT));
    const shade = 0.3 + 0.7 * lambert;
    const color: RGB = [base[0] * shade, base[1] * shade, base[2] * shade];
    this.fillTriangle(pa, pb, pc, color);
  }

  /** Draws a world-space polyline; without depth testing it reads as an overlay. */
  polyline(cam: Camera, points: XYZ[], color: RGB, width = 1, dash = 0): void {
    for (let i = 0; i + 1 < points.length; i++) {
      if (dash > 0 && Math.floor(i / dash) % 2 === 1) continue;
      const a = this.project(cam, points[i]);
      const b = this.project(cam, points[i + 1]);
      this.screenLine(a, b, color, width);
    }
  }

  /** Draws one world-space segment. */
  segment(cam: Camera, a: XYZ, b: XYZ, color: RGB, width = 1): void {
    this.screenLine(this.project(cam, a), this.project(cam, b), color, width);
  }

  private fillTriangle(
    pa: [number, number, number], pb: [number, number, number], pc: [number, number, number],
    color: RGB,
  ): void {
    const minX = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0])));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])));
    const minY = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1])));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
    const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1]);
    if (Math.abs(area) < 1e-9) return;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((pb[0] - px) * (pc[1] - py) - (pc[0] - px) * (pb[1] - py)) / area;
        const w1 = ((pc[0] - px) * (pa[1] - py) - (pa[0] - px) * (pc[1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = w0 * pa[2] + w1 * pb[2] + w2 * pc[2];
        const idx = y * this.width + x;
        if (depth <= this.dz[idx]) continue;
        this.dz[idx] = depth;
        this.px[idx * 3] = color[0];
        this.px[idx * 3 + 1] = color[1];
        this.px[idx * 3 + 2] = color[2];
      }
    }
  }

  private screenLine(
    a: [number, number, number], b: [number, number, number], color: RGB, width: number,
  ): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(a[0] + (b[0] - a[0]) * t);
      const y = Math.round(a[1] + (b[1] - a[1]) * t);
      const depth = a[2] + (b[2] - a[2]) * t;
      for (let oy = 0; oy < width; oy++) {
        for (let ox = 0; ox < width; ox++) {
          const cx = x + ox, cy = y + oy;
          if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) continue;
          const idx = cy * this.width + cx;
          if (depth < this.dz[idx] - 0.02) continue;
          this.px[idx * 3] = color[0];
          this.px[idx * 3 + 1] = color[1];
          this.px[idx * 3 + 2] = color[2];
        }
      }
    }
  }
}

/** Tessellates one capsule into triangles; `radiusZ` makes the cross-section elliptical in world z. */
export function capsuleTriangles(
  a: XYZ, b: XYZ, radius: number, rings = 10, segments = 14, radiusZ = radius,
): Array<[XYZ, XYZ, XYZ]> {
  const axis = normalize(sub(b, a));
  const u = Math.abs(axis[1]) < 0.9 ? normalize(cross(axis, [0, 1, 0])) : normalize(cross(axis, [1, 0, 0]));
  const v = cross(axis, u);
  const squash = radius > 0 ? radiusZ / radius : 1;
  const length = dist(a, b);
  const tris: Array<[XYZ, XYZ, XYZ]> = [];
  const ringAt = (s: number, i: number): XYZ => {
    const along = Math.min(Math.max(s, 0), length);
    const cap = s < 0 ? s : s > length ? s - length : 0;
    const rr = Math.sqrt(Math.max(radius * radius - cap * cap, 0));
    const theta = (i / segments) * Math.PI * 2;
    const cx = a[0] + axis[0] * along, cy = a[1] + axis[1] * along, cz = a[2] + axis[2] * along;
    const ox = (u[0] * Math.cos(theta) + v[0] * Math.sin(theta)) * rr;
    const oy = (u[1] * Math.cos(theta) + v[1] * Math.sin(theta)) * rr;
    const oz = (u[2] * Math.cos(theta) + v[2] * Math.sin(theta)) * rr * squash;
    return [cx + ox, cy + oy, cz + oz];
  };
  const span = length + radius * 2;
  for (let r = 0; r < rings; r++) {
    const s0 = -radius + (span * r) / rings;
    const s1 = -radius + (span * (r + 1)) / rings;
    for (let i = 0; i < segments; i++) {
      const p0 = ringAt(s0, i), p1 = ringAt(s0, i + 1), p2 = ringAt(s1, i + 1), p3 = ringAt(s1, i);
      tris.push([p0, p1, p2], [p0, p2, p3]);
    }
  }
  return tris;
}

/** Unit-length normal of a triangle. */
export function triangleNormal(a: XYZ, b: XYZ, c: XYZ): XYZ {
  const n = cross(sub(b, a), sub(c, a));
  const len = Math.hypot(n[0], n[1], n[2]);
  return len < 1e-12 ? [0, 0, 1] : [n[0] / len, n[1] / len, n[2] / len];
}

function normalize(p: XYZ): XYZ {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
}
function cross(p: XYZ, q: XYZ): XYZ {
  return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
}
function sub(p: XYZ, q: XYZ): XYZ {
  return [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
}
function dist(p: XYZ, q: XYZ): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
function dot(p: XYZ, q: XYZ): number {
  return p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
}
