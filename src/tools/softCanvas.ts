import { cross3t, degToRad, dot3t, normalize3t, sub3t, type Vec3Tuple } from '@/base/math';

const LIGHT: Vec3Tuple = normalize3t([0.35, 0.75, 0.9]);

export interface Camera {
  yawDeg: number;
  scale: number;
  originX: number;
  originY: number;
  centerY: number;
}

export type RGB = [number, number, number];

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

  project(cam: Camera, p: Vec3Tuple): [number, number, number] {
    const yaw = degToRad(cam.yawDeg);
    const xr = p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw);
    const zr = -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw);
    return [cam.originX + xr * cam.scale, cam.originY - (p[1] - cam.centerY) * cam.scale, zr];
  }

  triangle(cam: Camera, a: Vec3Tuple, b: Vec3Tuple, c: Vec3Tuple, base: RGB): void {
    const pa = this.project(cam, a), pb = this.project(cam, b), pc = this.project(cam, c);
    const normal = triangleNormal(a, b, c);
    const viewSign = normal[2] >= 0 ? 1 : -1;
    const lit: Vec3Tuple = [normal[0] * viewSign, normal[1] * viewSign, normal[2] * viewSign];
    const lambert = Math.max(0, dot3t(lit, LIGHT));
    const shade = 0.3 + 0.7 * lambert;
    const color: RGB = [base[0] * shade, base[1] * shade, base[2] * shade];
    this.fillTriangle(pa, pb, pc, color);
  }

  polyline(cam: Camera, points: Vec3Tuple[], color: RGB, width = 1, dash = 0): void {
    for (let i = 0; i + 1 < points.length; i++) {
      if (dash > 0 && Math.floor(i / dash) % 2 === 1) continue;
      const a = this.project(cam, points[i]);
      const b = this.project(cam, points[i + 1]);
      this.screenLine(a, b, color, width);
    }
  }

  segment(cam: Camera, a: Vec3Tuple, b: Vec3Tuple, color: RGB, width = 1): void {
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

export function triangleNormal(a: Vec3Tuple, b: Vec3Tuple, c: Vec3Tuple): Vec3Tuple {
  return normalize3t(cross3t(sub3t(b, a), sub3t(c, a)));
}
