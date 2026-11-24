import type { BodyLandmark, Panel, PanelDrape, Pattern, Vec2, WrapZone } from '@/model/types';

import { inferDrape } from '@/garment/drapeInfer';
import { samplePanelOutline } from '@/pattern/panel';

const REGION_ANCHOR: Record<PanelDrape['region'], BodyLandmark> = {
  torso: 'shoulderTop',
  arm: 'shoulderCap',
  leg: 'hip',
  neck: 'neckTop',
  head: 'neckTop',
};

const REGION_ZONE: Record<PanelDrape['region'], WrapZone> = {
  torso: 'front',
  arm: 'full',
  leg: 'full',
  neck: 'full',
  head: 'full',
};

const REGION_EASE: Record<PanelDrape['region'], number> = {
  torso: 2,
  arm: 1.2,
  leg: 1.2,
  neck: 0.8,
  head: 0.8,
};

const TOP_BAND_CM = 1;

const PAIR_SAMPLES = 48;

export interface WrapSlot {
  startRad: number;
  sweepRad: number;
}

export interface ResolvedWrap {
  region: PanelDrape['region'];
  zone: WrapZone;
  anchor: BodyLandmark;
  anchorOffsetCm: number;
  side: 'left' | 'right';
  flip: boolean;
  easeCm: number;
}

export type PanelWrapMode =
  | 'flat' | 'torso-front' | 'torso-back' | 'torso-full'
  | 'arm-left' | 'arm-right' | 'leg-left' | 'leg-right'
  | 'neck' | 'neck-left' | 'neck-right'
  | 'head' | 'head-left' | 'head-right';

type PairLayout = 'mirrored' | 'moved' | 'unknown';

export function resolveWrap(panel: Panel): ResolvedWrap {
  const drape = panel.drape ?? inferDrape(panel.name);
  const region = drape.region;
  return {
    region,
    zone: drape.zone ?? REGION_ZONE[region],
    anchor: drape.anchor ?? REGION_ANCHOR[region],
    anchorOffsetCm: drape.anchorOffsetCm ?? 0,
    side: drape.side ?? 'right',
    flip: drape.flip ?? false,
    easeCm: drape.easeCm ?? REGION_EASE[region],
  };
}

export function regionAnchor(region: PanelDrape['region']): BodyLandmark {
  return REGION_ANCHOR[region];
}

export function zoneSweep(region: PanelDrape['region'], zone: WrapZone): WrapSlot {
  if (region === 'arm' || region === 'leg') {
    switch (zone) {
      case 'front': return { startRad: -Math.PI / 2, sweepRad: Math.PI };
      case 'back': return { startRad: 3 * Math.PI / 2, sweepRad: -Math.PI };
      case 'left': return { startRad: Math.PI, sweepRad: Math.PI };
      case 'right': return { startRad: 0, sweepRad: Math.PI };
      case 'full':
      default: return { startRad: -Math.PI, sweepRad: 2 * Math.PI };
    }
  }

  if (region === 'head') {
    switch (zone) {
      case 'left': return { startRad: 0, sweepRad: -Math.PI };
      case 'right': return { startRad: 0, sweepRad: Math.PI };
      case 'front': return { startRad: -Math.PI / 2, sweepRad: Math.PI };
      case 'back': return { startRad: Math.PI / 2, sweepRad: Math.PI };
      case 'full':
      default: return { startRad: -Math.PI, sweepRad: 2 * Math.PI };
    }
  }

  switch (zone) {
    case 'back': return { startRad: 3 * Math.PI / 2, sweepRad: -Math.PI };
    case 'left':
      return { startRad: Math.PI, sweepRad: Math.PI };
    case 'right':
      return { startRad: region === 'neck' ? Math.PI : 0, sweepRad: region === 'neck' ? -Math.PI : Math.PI };
    case 'full': return { startRad: -Math.PI, sweepRad: 2 * Math.PI };
    case 'front':
    default: return { startRad: -Math.PI / 2, sweepRad: Math.PI };
  }
}

export function panelWrapMode(drape: PanelDrape | undefined): PanelWrapMode {
  if (!drape) return 'flat';
  if (drape.region === 'arm') return drape.side === 'left' ? 'arm-left' : 'arm-right';
  if (drape.region === 'leg') return drape.side === 'left' ? 'leg-left' : 'leg-right';
  if (drape.region === 'neck') {
    if (drape.zone === 'left') return 'neck-left';
    if (drape.zone === 'right') return 'neck-right';
    return 'neck';
  }

  if (drape.region === 'head') {
    if (drape.zone === 'left') return 'head-left';
    if (drape.zone === 'right') return 'head-right';
    return 'head';
  }

  if (drape.zone === 'back') return 'torso-back';
  if (drape.zone === 'full') return 'torso-full';
  return 'torso-front';
}

export function wrapDrapeForMode(mode: PanelWrapMode, previous?: PanelDrape): PanelDrape | undefined {
  if (mode === 'flat') return undefined;
  const region: PanelDrape['region'] = mode.startsWith('torso') ? 'torso'
    : mode.startsWith('arm') ? 'arm' : mode.startsWith('leg') ? 'leg'
    : mode.startsWith('head') ? 'head' : 'neck';
  const keep = previous && previous.region === region ? previous : undefined;
  const base: PanelDrape = {
    region,
    ...(keep?.anchor !== undefined ? { anchor: keep.anchor } : {}),
    ...(keep?.anchorOffsetCm !== undefined ? { anchorOffsetCm: keep.anchorOffsetCm } : {}),
    ...(keep?.flip !== undefined ? { flip: keep.flip } : {}),
    ...(keep?.easeCm !== undefined ? { easeCm: keep.easeCm } : {}),
  };
  if (region === 'torso') return { ...base, zone: mode === 'torso-back' ? 'back' : mode === 'torso-full' ? 'full' : 'front' };
  if (region === 'neck') {
    return { ...base, zone: mode === 'neck-left' ? 'left' : mode === 'neck-right' ? 'right' : 'full' };
  }

  if (region === 'head') {
    return { ...base, zone: mode === 'head-left' ? 'left' : mode === 'head-right' ? 'right' : 'full' };
  }

  return { ...base, zone: 'full', side: mode.endsWith('left') ? 'left' : 'right' };
}

function topSpan(pattern: Pattern, panel: Panel): { width: number; centreX: number } {
  const points = samplePanelOutline(pattern, panel);
  if (points.length === 0) return { width: 0, centreX: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  let topMin = Infinity;
  let topMax = -Infinity;
  for (const point of points) {
    if (point.y < maxY - TOP_BAND_CM) continue;
    topMin = Math.min(topMin, point.x);
    topMax = Math.max(topMax, point.x);
  }

  const width = topMax > topMin ? topMax - topMin : maxX - minX;
  return { width: Math.max(width, 0), centreX: (minX + maxX) / 2 };
}

function evenOutline(pattern: Pattern, panel: Panel): Vec2[] | null {
  const sampled = samplePanelOutline(pattern, panel);
  if (sampled.length < 3) return null;
  const loop = [...sampled];
  const first = loop[0]!;
  const last = loop[loop.length - 1]!;
  if (Math.hypot(last.x - first.x, last.y - first.y) > 1e-6) loop.push(first);
  const walked = [0];
  for (let i = 1; i < loop.length; i++) {
    walked.push(walked[i - 1]! + Math.hypot(loop[i]!.x - loop[i - 1]!.x, loop[i]!.y - loop[i - 1]!.y));
  }

  const total = walked[walked.length - 1]!;
  if (total < 1e-6) return null;
  const out: Vec2[] = [];
  let cursor = 0;
  for (let k = 0; k < PAIR_SAMPLES; k++) {
    const target = total * k / PAIR_SAMPLES;
    while (cursor < walked.length - 2 && walked[cursor + 1]! < target) cursor++;
    const span = walked[cursor + 1]! - walked[cursor]!;
    const t = span > 1e-9 ? (target - walked[cursor]!) / span : 0;
    const a = loop[cursor]!;
    const b = loop[cursor + 1]!;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }

  return out;
}

function pairLayout(pattern: Pattern, left: Panel, right: Panel): PairLayout {
  const a = evenOutline(pattern, left);
  const b = evenOutline(pattern, right);
  if (!a || !b) return 'unknown';
  let sumDX = 0;
  let sumDY = 0;
  let sumX = 0;
  for (let i = 0; i < a.length; i++) {
    sumDX += a[i]!.x - b[i]!.x;
    sumDY += a[i]!.y - b[i]!.y;
    sumX += a[i]!.x + b[i]!.x;
  }

  const dx = sumDX / a.length;
  const dy = sumDY / a.length;
  const xPivot = sumX / a.length;
  let movedError = 0;
  let mirroredError = 0;
  let size = 0;
  for (let i = 0; i < a.length; i++) {
    movedError += Math.abs((a[i]!.x - b[i]!.x) - dx) + Math.abs((a[i]!.y - b[i]!.y) - dy);
    mirroredError += Math.abs((a[i]!.x + b[i]!.x) - xPivot) + Math.abs((a[i]!.y - b[i]!.y) - dy);
    size = Math.max(size, Math.abs(a[i]!.x - a[0]!.x), Math.abs(a[i]!.y - a[0]!.y));
  }

  movedError /= a.length;
  mirroredError /= a.length;
  if (Math.min(movedError, mirroredError) > size * 0.02) return 'unknown';
  return mirroredError <= movedError ? 'mirrored' : 'moved';
}

function turnMovedPartners(
  pattern: Pattern,
  groups: Map<string, { wrap: ResolvedWrap; members: Array<{ id: string; width: number; centreX: number }> }>,
  slots: Map<string, WrapSlot>,
): void {
  for (const { wrap, members } of groups.values()) {
    if (wrap.side !== 'left' || (wrap.region !== 'arm' && wrap.region !== 'leg')) continue;
    const partnerKey = [wrap.region, wrap.zone, wrap.anchor, wrap.anchorOffsetCm, 'right'].join('|');
    const partner = groups.get(partnerKey);
    if (!partner || partner.members.length !== members.length) continue;
    const ordered = [...members].sort((a, b) => a.centreX - b.centreX);
    const partners = [...partner.members].sort((a, b) => a.centreX - b.centreX);
    for (let i = 0; i < ordered.length; i++) {
      const left = pattern.panels[ordered[i]!.id];
      const right = pattern.panels[partners[i]!.id];
      if (!left || !right || pairLayout(pattern, left, right) !== 'moved') continue;
      const slot = slots.get(left.id);
      if (!slot) continue;
      slots.set(left.id, { startRad: slot.startRad + slot.sweepRad, sweepRad: -slot.sweepRad });
    }
  }
}

export function planWraps(pattern: Pattern): Map<string, WrapSlot> {
  const groups = new Map<string, { wrap: ResolvedWrap; members: Array<{ id: string; width: number; centreX: number }> }>();
  for (const panel of Object.values(pattern.panels)) {
    if (!panel.drape || panel.placement) continue;
    const wrap = resolveWrap(panel);
    const key = [wrap.region, wrap.zone, wrap.anchor, wrap.anchorOffsetCm, wrap.side].join('|');
    const span = topSpan(pattern, panel);
    const entry = { id: panel.id, width: span.width, centreX: span.centreX };
    const group = groups.get(key);
    if (group) group.members.push(entry);
    else groups.set(key, { wrap, members: [entry] });
  }

  const slots = new Map<string, WrapSlot>();
  for (const { wrap, members } of groups.values()) {
    members.sort((a, b) => a.centreX - b.centreX);
    const range = zoneSweep(wrap.region, wrap.zone);
    if (members.length === 1) {
      slots.set(members[0]!.id, range);
      continue;
    }

    const total = members.reduce((sum, member) => sum + member.width, 0);
    let cursor = range.startRad;
    for (const member of members) {
      const share = total > 1e-6 ? member.width / total : 1 / members.length;
      const sweep = range.sweepRad * share;
      slots.set(member.id, { startRad: cursor, sweepRad: sweep });
      cursor += sweep;
    }
  }

  turnMovedPartners(pattern, groups, slots);
  return slots;
}
