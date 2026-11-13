/**
 * Reads the torso off a body mesh: the heights of the sizing landmarks, and the cross-section
 * profile the drape wraps panels around.
 *
 * Every number here comes from the surface itself, so a body built to one set of measurements has
 * its waist where its own narrowest section is, not where a table of ratios guesses it is.
 */

import { SectionIndex, torsoLoop } from '@/avatar/makehuman/section';

/** One horizontal slice of the torso. */
export interface TorsoSlice {
  readonly y: number;
  /** Perimeter of the slice, in meters. */
  readonly perimeter: number;
  /** Half width at the slice. */
  readonly halfW: number;
  /** Half depth in front of the slice centre and behind it. */
  readonly front: number;
  readonly back: number;
  readonly centerX: number;
  readonly centerZ: number;
  /** True when the arms have joined the torso, so the slice is no longer a torso measurement. */
  readonly merged: boolean;
}

/** Heights of the sizing landmarks, in meters. */
export interface TorsoLandmarks {
  crotchY: number;
  hipY: number;
  waistY: number;
  bustY: number;
  /** Lowest height where the arms have grown into the torso surface. */
  armpitY: number;
}

/** Torso scan of one body. */
export interface TorsoScan {
  readonly profile: TorsoSlice[];
  readonly landmarks: TorsoLandmarks;
}

/** Vertical step of the profile scan, in meters. */
const PROFILE_STEP_M = 0.015;
/** Width beyond the hip that counts as the arm surface joining the torso. */
const MERGE_WIDTH_RATIO = 1.18;
/** Share of the scanned torso left below the hip search, which is still the thigh junction. */
const HIP_SEARCH_START = 0.12;
/** Share of the scanned torso the hip search reaches, just above the greater trochanter. */
const HIP_SEARCH_END = 0.35;
/** Gap left between neighbouring landmark searches, as a share of the scanned torso. */
const LANDMARK_GAP = 0.05;
/**
 * Bust height as a share of stature. The widest section of the chest is the bust, but the arms
 * join the torso just above it and widen every slice there, so the search stops at this fraction
 * rather than at the armpit.
 */
const BUST_HEIGHT_RATIO = 0.745;

/** Slices the torso between two heights, bottom first. */
function torsoProfile(
  index: SectionIndex,
  fromY: number,
  toY: number,
): TorsoSlice[] {
  const slices: TorsoSlice[] = [];
  for (let y = fromY; y <= toY + 1e-6; y += PROFILE_STEP_M) {
    const loop = torsoLoop(index.loops(y));
    if (!loop) continue;
    const centerZ = (loop.minZ + loop.maxZ) / 2;
    slices.push({
      y,
      perimeter: loop.perimeter,
      halfW: (loop.maxX - loop.minX) / 2,
      front: loop.maxZ - centerZ,
      back: centerZ - loop.minZ,
      centerX: (loop.minX + loop.maxX) / 2,
      centerZ,
      merged: false,
    });
  }
  return slices;
}

/** Index of the slice with the smallest perimeter in a window of the profile. */
function narrowest(profile: readonly TorsoSlice[], from: number, to: number): number {
  let best = -1;
  let value = Infinity;
  for (let i = 0; i < profile.length; i++) {
    const slice = profile[i]!;
    if (slice.y < from || slice.y > to || slice.merged) continue;
    if (slice.perimeter < value) {
      value = slice.perimeter;
      best = i;
    }
  }
  return best;
}

/** Index of the slice with the largest perimeter in a window of the profile. */
function widest(profile: readonly TorsoSlice[], from: number, to: number): number {
  let best = -1;
  let value = -Infinity;
  for (let i = 0; i < profile.length; i++) {
    const slice = profile[i]!;
    if (slice.y < from || slice.y > to || slice.merged) continue;
    if (slice.perimeter > value) {
      value = slice.perimeter;
      best = i;
    }
  }
  return best;
}

/**
 * Landmarks of a scanned profile. The hip is the widest section just above the thighs, the waist
 * the narrowest section above it, and the bust the widest section between the waist and the point
 * where the arms join the torso.
 */
function findTorsoLandmarks(raw: readonly TorsoSlice[], height: number): TorsoLandmarks {
  const first = raw[0]!;
  const last = raw[raw.length - 1]!;
  const span = last.y - first.y;
  const crotchY = first.y;

  const hipIndex = widest(raw, crotchY + span * HIP_SEARCH_START, crotchY + span * HIP_SEARCH_END);
  const hipY = (raw[hipIndex] ?? first).y;
  const referenceHalfW = (raw[hipIndex] ?? first).halfW;

  const marked = markMerged(raw, referenceHalfW);
  const waistIndex = narrowest(marked, hipY + span * LANDMARK_GAP, crotchY + span * (HIP_SEARCH_END + 0.3));
  const waistY = (marked[waistIndex] ?? first).y;
  const armpitY = (marked.find(slice => slice.merged && slice.y > waistY) ?? last).y;
  const bustTop = Math.min(armpitY, height * BUST_HEIGHT_RATIO);
  const bustIndex = widest(marked, waistY + span * LANDMARK_GAP, bustTop);
  const bustY = (marked[bustIndex] ?? first).y;

  return { crotchY, hipY, waistY, bustY, armpitY };
}

/** Flags the slices where the arms have grown into the torso surface. */
function markMerged(slices: readonly TorsoSlice[], referenceHalfW: number): TorsoSlice[] {
  return slices.map(slice => ({
    ...slice,
    merged: referenceHalfW > 0 && slice.halfW > referenceHalfW * MERGE_WIDTH_RATIO,
  }));
}

/** Scans the torso of one body and reads its landmarks. */
export function scanTorso(
  index: SectionIndex,
  fromY: number,
  toY: number,
  height: number,
): TorsoScan {
  const raw = torsoProfile(index, fromY, toY);
  const landmarks = findTorsoLandmarks(raw, height);
  const hip = raw.find(slice => Math.abs(slice.y - landmarks.hipY) < 1e-6) ?? raw[0]!;
  return { profile: markMerged(raw, hip.halfW), landmarks };
}

/** Perimeter of the slice nearest a height. */
export function girthAt(profile: readonly TorsoSlice[], y: number): number {
  let best = profile[0];
  for (const slice of profile) {
    if (!best || Math.abs(slice.y - y) < Math.abs(best.y - y)) best = slice;
  }
  return best?.perimeter ?? 0;
}
