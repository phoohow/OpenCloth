import { SectionIndex, torsoLoop } from '@/avatar/makehuman/section';

const PROFILE_STEP_M = 0.015;

const MERGE_WIDTH_RATIO = 1.18;

const HIP_SEARCH_START = 0.12;

const HIP_SEARCH_END = 0.35;

const LANDMARK_GAP = 0.05;

const BUST_HEIGHT_RATIO = 0.745;

export interface TorsoSlice {
  readonly y: number;
  readonly perimeter: number;
  readonly halfW: number;
  readonly front: number;
  readonly back: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly merged: boolean;
}

export interface TorsoLandmarks {
  crotchY: number;
  hipY: number;
  waistY: number;
  bustY: number;
  armpitY: number;
}

export interface TorsoScan {
  readonly profile: TorsoSlice[];
  readonly landmarks: TorsoLandmarks;
}

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

function markMerged(slices: readonly TorsoSlice[], referenceHalfW: number): TorsoSlice[] {
  return slices.map(slice => ({
    ...slice,
    merged: referenceHalfW > 0 && slice.halfW > referenceHalfW * MERGE_WIDTH_RATIO,
  }));
}

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

export function girthAt(profile: readonly TorsoSlice[], y: number): number {
  let best = profile[0];
  for (const slice of profile) {
    if (!best || Math.abs(slice.y - y) < Math.abs(best.y - y)) best = slice;
  }

  return best?.perimeter ?? 0;
}
