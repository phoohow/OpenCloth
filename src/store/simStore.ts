import { create } from 'zustand';

interface SimStore {
  isPlaying: boolean;
  currentFrame: number;
  speed: number;
  isDraped: boolean;
  /** True while the sew → dress → settle animation is playing. */
  isDraping: boolean;
  /** Incremented to request one physics step. */
  stepToken: number;
  /** Incremented to request a restore of the initial positions. */
  resetToken: number;
  /** Incremented whenever the pinned-particle set changed, so the toolbars re-read it. */
  pinsVersion: number;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  step: () => void;
  reset: () => void;
  bumpPins: () => void;
  setSpeed: (s: number) => void;
  incrementFrame: () => void;
  setDraped: (v: boolean) => void;
  setDraping: (v: boolean) => void;
}

/** Playback state for the cloth simulation, driven by the timeline and the 3D viewport. */
export const useSimStore = create<SimStore>((set, get) => ({
  isPlaying: false,
  currentFrame: 0,
  speed: 1,
  isDraped: false,
  isDraping: false,
  stepToken: 0,
  resetToken: 0,
  pinsVersion: 0,

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set({ isPlaying: !get().isPlaying }),
  step: () => set(s => ({ isPlaying: false, stepToken: s.stepToken + 1 })),
  reset: () => set(s => ({ isPlaying: false, currentFrame: 0, resetToken: s.resetToken + 1 })),
  bumpPins: () => set(s => ({ pinsVersion: s.pinsVersion + 1 })),
  setSpeed: (s) => set({ speed: s }),
  incrementFrame: () => set(s => ({ currentFrame: s.currentFrame + 1 })),
  setDraped: (v) => set({ isDraped: v }),
  setDraping: (v) => set({ isDraping: v }),
}));
