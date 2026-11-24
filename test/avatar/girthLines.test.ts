import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/app';
import { AVATAR_PRESETS } from '@/model/defaults/avatar';
import { bodyLandmarks } from '@/avatar/landmarks';
import { outlinePoints } from '@/avatar/girthLines';
import { makehumanBody } from '@/avatar/makehuman/body';
import { SectionIndex, torsoLoop, type SectionLoop } from '@/avatar/makehuman/section';
import type { GirthLine, GirthLinePart } from '@/avatar/girthLines';

const MIRROR_TOLERANCE = 0.01;

describe('girth lines', () => {
  const body = bodyLandmarks(createStarterProject().avatar.params);
  const lines = body.bodyGirthLines();

  const lineOf = (part: GirthLinePart, side: 0 | -1 | 1): GirthLine =>
    lines.find(line => line.part === part && line.side === side)!;

  it('measures the five midline sections, both armholes and both limbs', () => {
    expect(lines.filter(line => line.side === 0).map(line => line.part))
      .toEqual(['neck', 'shoulder', 'bust', 'waist', 'hip']);
    expect(lines.filter(line => line.side === 1).map(line => line.part))
      .toEqual(['armhole', 'biceps', 'elbow', 'wrist', 'thigh', 'knee', 'calf', 'ankle']);
    expect(lines.filter(line => line.side === -1)).toHaveLength(8);
  });

  it('cuts each torso line at its landmark height', () => {
    expect(lineOf('bust', 0).centre[1]).toBeCloseTo(body.bustY, 6);
    expect(lineOf('waist', 0).centre[1]).toBeCloseTo(body.waistY, 6);
    expect(lineOf('hip', 0).centre[1]).toBeCloseTo(body.hipY, 6);
    expect(lineOf('neck', 0).centre[1]).toBeLessThan(body.neckTopY);
    expect(lineOf('neck', 0).centre[1]).toBeGreaterThan(body.torsoTop);
    expect(lineOf('shoulder', 0).centre[1]).toBeCloseTo(body.shoulderTopY - 0.01, 6);
  });

  it('draws each torso line on the section it was cut from', () => {
    const mesh = makehumanBody(createStarterProject().avatar.params);
    const index = new SectionIndex(mesh.positions, mesh.bodyIndices);
    const toLoop = (loop: SectionLoop, x: number, z: number): number => {
      let nearest = Infinity;
      const points = loop.points;
      for (let k = 0; k < points.length; k += 2) {
        const ax = points[k]!;
        const az = points[k + 1]!;
        const bx = points[(k + 2) % points.length]!;
        const bz = points[(k + 3) % points.length]!;
        const spanX = bx - ax;
        const spanZ = bz - az;
        const lengthSq = spanX * spanX + spanZ * spanZ;
        const t = lengthSq < 1e-12 ? 0 : Math.min(1, Math.max(0,
          ((x - ax) * spanX + (z - az) * spanZ) / lengthSq));
        nearest = Math.min(nearest, Math.hypot(x - (ax + spanX * t), z - (az + spanZ * t)));
      }

      return nearest;
    };

    for (const part of ['neck', 'shoulder', 'bust', 'waist', 'hip'] as GirthLinePart[]) {
      const line = lineOf(part, 0);
      const loop = torsoLoop(index.loops(line.centre[1]))!;
      for (const point of outlinePoints(line)) {
        expect(toLoop(loop, point[0], point[2])).toBeLessThan(0.002);
      }
    }
  });

  it('runs each line right round its section', () => {
    for (const line of lines) {
      let perimeter = 0;
      for (let i = 0; i < line.outline.length; i++) {
        const a = line.outline[i]!;
        const b = line.outline[(i + 1) % line.outline.length]!;
        perimeter += Math.hypot(b.x - a.x, b.y - a.y);
      }

      expect(perimeter).toBeGreaterThan(line.girth * 0.985);
      expect(perimeter).toBeLessThan(line.girth + 0.02);
    }
  });

  it('reads a section the cloth has to clear', () => {
    for (const line of lines) {
      expect(line.rx).toBeGreaterThan(0.01);
      expect(line.rz).toBeGreaterThan(0.01);
      expect(line.girth).toBeGreaterThan(0.1);
    }

    expect(lineOf('bust', 0).rx).toBeGreaterThan(lineOf('bust', 0).rz);
    expect(lineOf('waist', 0).rx).toBeLessThan(lineOf('hip', 0).rx);
  });

  it('cuts limb lines square to the limb, not horizontally', () => {
    expect(lineOf('wrist', 1).girth).toBeLessThan(lineOf('elbow', 1).girth);
    expect(lineOf('elbow', 1).girth).toBeLessThan(lineOf('biceps', 1).girth);
    expect(lineOf('biceps', 1).girth).toBeLessThan(lineOf('thigh', 1).girth);
    expect(lineOf('wrist', 1).girth).toBeLessThan(0.2);
  });

  it('runs the shoulder line at the acromion, wide enough to set a yoke out from', () => {
    const line = lineOf('shoulder', 0);
    expect(line.rx * 2).toBeGreaterThan(body.shoulderHalfW * 2 - 0.01);
    expect(line.rx).toBeGreaterThan(lineOf('bust', 0).rx);
    expect(line.rx).toBeLessThan(lineOf('hip', 0).rx + 0.03);
    expect(line.rz).toBeLessThan(lineOf('bust', 0).rz);
  });

  it('cuts an armhole off the vertical section through the acromion', () => {
    const line = lineOf('armhole', 1);
    expect(line.centre[1] - line.rx).toBeLessThan(body.armpitY + 0.02);
    expect(line.centre[1] + line.rx).toBeGreaterThan(body.shoulderTopY - 0.02);
    expect(Math.abs(line.centre[0])).toBeCloseTo(body.shoulderHalfW, 1);
    expect(line.girth).toBeGreaterThan(lineOf('biceps', 1).girth);
  });

  it('keeps the armhole section off the torso when the chest is wide', () => {
    const broad = bodyLandmarks({
      ...createStarterProject().avatar.params, chestCm: 110, waistCm: 95, hipCm: 112,
    });
    const armhole = broad.bodyGirthLines().find(line => line.part === 'armhole' && line.side === 1);
    expect(armhole).toBeDefined();
    expect(armhole!.girth).toBeLessThan(0.55);
    expect(armhole!.centre[1] - armhole!.rx).toBeGreaterThan(broad.armpitY - 0.05);
  });

  it('finds the neck on a child instead of the jaw', () => {
    for (const id of ['girl', 'boy']) {
      const preset = AVATAR_PRESETS.find(item => item.id === id)!;
      const child = bodyLandmarks(preset.params);
      const line = child.bodyGirthLines().find(item => item.part === 'neck')!;
      expect(line.girth).toBeLessThan(0.34);
      expect(line.centre[1]).toBeGreaterThan(child.torsoTop);
      expect(line.centre[1]).toBeLessThan(child.neckTopY);
    }
  });

  it('cuts the ankle line above the foot', () => {
    const line = lineOf('ankle', 1);
    expect(line.centre[1]).toBeGreaterThan(body.ankleY + 0.015);
    expect(line.girth).toBeLessThan(0.28);
  });

  it('reads each joint smaller than the segment above it', () => {
    expect(lineOf('knee', 1).girth).toBeLessThan(lineOf('thigh', 1).girth);
    expect(lineOf('ankle', 1).girth).toBeLessThan(lineOf('calf', 1).girth);
    expect(lineOf('elbow', 1).centre[1]).toBeLessThan(lineOf('biceps', 1).centre[1]);
    expect(lineOf('elbow', 1).centre[1]).toBeGreaterThan(lineOf('wrist', 1).centre[1]);
    expect(lineOf('knee', 1).centre[1]).toBeLessThan(lineOf('thigh', 1).centre[1]);
    expect(lineOf('calf', 1).centre[1]).toBeLessThan(lineOf('knee', 1).centre[1]);
    expect(lineOf('ankle', 1).centre[1]).toBeLessThan(lineOf('calf', 1).centre[1]);
  });

  it('mirrors the limb lines across the body midline', () => {
    for (const part of [
      'armhole', 'biceps', 'elbow', 'wrist', 'thigh', 'knee', 'calf', 'ankle',
    ] as GirthLinePart[]) {
      const left = lineOf(part, -1);
      const right = lineOf(part, 1);
      expect(Math.abs(left.rx - right.rx)).toBeLessThan(MIRROR_TOLERANCE);
      expect(Math.abs(left.rz - right.rz)).toBeLessThan(MIRROR_TOLERANCE);
      expect(Math.abs(left.centre[0] + right.centre[0])).toBeLessThan(MIRROR_TOLERANCE);
      expect(Math.abs(left.centre[1] - right.centre[1])).toBeLessThan(MIRROR_TOLERANCE);
    }
  });

  it('turns the two line axes into one orthonormal plane', () => {
    for (const line of lines) {
      const [u, v] = [line.u, line.v];
      const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      expect(Math.abs(dot)).toBeLessThan(1e-6);
      expect(Math.hypot(...u)).toBeCloseTo(1, 6);
      expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    }
  });
});
