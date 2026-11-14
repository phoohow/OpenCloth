/** Wrap vocabulary: resolved drape defaults, sector angles, wrap modes and the shared sector plan. */

import type { BodyLandmark, Panel, PanelDrape, Pattern, WrapZone } from '@/model/types';
import { samplePanelOutline } from '@/pattern/panel/panelBuilder';
import { inferDrape } from '@/pattern/drape/drapeInfer';

/** Angular slot one panel occupies on its body part, in the section's frame. */
export interface WrapSlot {
  /** Angle the panel's left edge starts at, in radians. */
  startRad: number;
  /** Signed angular span; negative runs the slot the other way around. */
  sweepRad: number;
}

/** Fully specified wrap of one panel, with every default resolved. */
export interface ResolvedWrap {
  region: PanelDrape['region'];
  zone: WrapZone;
  anchor: BodyLandmark;
  anchorOffsetCm: number;
  side: 'left' | 'right';
  flip: boolean;
  easeCm: number;
  radiusOffsetCm: number;
}

/** Landmark each region hangs from unless the panel overrides it. */
const REGION_ANCHOR: Record<PanelDrape['region'], BodyLandmark> = {
  torso: 'shoulderTop',
  arm: 'shoulderCap',
  leg: 'hip',
  neck: 'neckTop',
  head: 'neckTop',
};

/** Default sector of a part: a torso piece covers the front, a limb a full turn. */
const REGION_ZONE: Record<PanelDrape['region'], WrapZone> = {
  torso: 'front',
  arm: 'full',
  leg: 'full',
  neck: 'full',
  head: 'full',
};

/** Design ease in centimeters, used to order separate garments into layers. */
const REGION_EASE: Record<PanelDrape['region'], number> = {
  torso: 2,
  arm: 1.2,
  leg: 1.2,
  neck: 0.8,
  head: 0.8,
};

/** Completes a panel's wrap, inferring the part from the name for hand-drawn patterns. */
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
    radiusOffsetCm: drape.radiusOffsetCm ?? 0,
  };
}

/** Default top-edge landmark of a body part. */
export function regionAnchor(region: PanelDrape['region']): BodyLandmark {
  return REGION_ANCHOR[region];
}

/**
 * Angular range of one sector. Torso angles count from the body front, positive toward the
 * piece's right; a limb counts from the side of the limb the sleeve crown rides over.
 */
export function zoneSweep(region: PanelDrape['region'], zone: WrapZone): WrapSlot {
  if (region === 'arm' || region === 'leg') {
    switch (zone) {
      case 'front': return { startRad: -Math.PI / 2, sweepRad: Math.PI };
      case 'back': return { startRad: Math.PI / 2, sweepRad: Math.PI };
      case 'left': return { startRad: Math.PI, sweepRad: Math.PI };
      case 'right': return { startRad: 0, sweepRad: Math.PI };
      case 'full':
      default: return { startRad: -Math.PI, sweepRad: 2 * Math.PI };
    }
  }
  if (region === 'head') {
    // A head half starts at the face opening and runs over one side to the centre back.
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
      // A neck half runs from the back centre around the left side to the front.
      return { startRad: Math.PI, sweepRad: Math.PI };
    case 'right':
      // The right half is the same arc traversed the other way, as a hood half is authored.
      return { startRad: region === 'neck' ? Math.PI : 0, sweepRad: region === 'neck' ? -Math.PI : Math.PI };
    case 'full': return { startRad: -Math.PI, sweepRad: 2 * Math.PI };
    case 'front':
    default: return { startRad: -Math.PI / 2, sweepRad: Math.PI };
  }
}

/** One wrap mode a panel can be set to; the properties editor offers these. */
export type PanelWrapMode =
  | 'flat' | 'torso-front' | 'torso-back' | 'torso-full'
  | 'arm-left' | 'arm-right' | 'leg-left' | 'leg-right'
  | 'neck' | 'neck-left' | 'neck-right'
  | 'head' | 'head-left' | 'head-right';

/** Wrap mode a panel currently uses. */
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

/**
 * Drape record of one wrap mode. The anchor and orientation survive a switch within the same
 * body part, so a skirt keeps hanging from the waist when its side is changed.
 */
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
    ...(keep?.radiusOffsetCm !== undefined ? { radiusOffsetCm: keep.radiusOffsetCm } : {}),
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

/** Depth of the top band whose width sizes a piece's sector share, in centimeters. */
const TOP_BAND_CM = 1;

/** Width across a panel's top band plus its horizontal centre, in centimeters. */
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

/**
 * Splits the pieces of one wrap group across its sector. Pieces that share a part, sector and
 * anchor are laid left to right in the pattern and take proportional shares of the sector, so a
 * six-gore skirt needs no per-panel angles: each gore only says it wraps the front half.
 */
export function planWraps(pattern: Pattern): Map<string, WrapSlot> {
  const groups = new Map<string, Array<{ id: string; width: number; centreX: number }>>();
  for (const panel of Object.values(pattern.panels)) {
    if (!panel.drape || panel.placement) continue;
    const wrap = resolveWrap(panel);
    const key = [wrap.region, wrap.zone, wrap.anchor, wrap.anchorOffsetCm, wrap.side].join('|');
    const span = topSpan(pattern, panel);
    const group = groups.get(key);
    const entry = { id: panel.id, width: span.width, centreX: span.centreX };
    if (group) group.push(entry); else groups.set(key, [entry]);
  }

  const slots = new Map<string, WrapSlot>();
  for (const members of groups.values()) {
    members.sort((a, b) => a.centreX - b.centreX);
    const first = pattern.panels[members[0]!.id]!;
    const wrap = resolveWrap(first);
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
  return slots;
}