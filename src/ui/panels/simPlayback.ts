import { useSimStore } from '@/store';
import { useEffect, useState } from 'react';

const MIN_TRACK_FRAMES = 1;

export interface SimPlayback {
  isPlaying: boolean;
  currentFrame: number;
  stopFrame: number | null;
  trackEnd: number;
  atStopFrame: boolean;
  playedMs: number;
  stopDraft: string;
  setStopDraft: (text: string) => void;
  commitStopFrame: () => void;
  clearStopFrame: () => void;
}

export function useSimPlayback(): SimPlayback {
  const isPlaying = useSimStore(s => s.isPlaying);
  const currentFrame = useSimStore(s => s.currentFrame);
  const stopFrame = useSimStore(s => s.stopFrame);
  const playedMs = useSimStore(s => s.playedMs);
  const [stopDraft, setStopDraft] = useState(stopFrame === null ? '' : String(stopFrame));
  const atStopFrame = stopFrame !== null && currentFrame >= stopFrame;
  const trackEnd = Math.max(stopFrame ?? 0, currentFrame, MIN_TRACK_FRAMES);

  useEffect(() => {
    setStopDraft(stopFrame === null ? '' : String(stopFrame));
  }, [stopFrame]);

  const commitStopFrame = () => {
    const trimmed = stopDraft.trim();
    if (trimmed === '') {
      useSimStore.getState().setStopFrame(null);
      return;
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setStopDraft(stopFrame === null ? '' : String(stopFrame));
      return;
    }

    const frame = Math.max(Math.round(value), useSimStore.getState().currentFrame);
    useSimStore.getState().setStopFrame(frame);
    setStopDraft(String(frame));
  };

  return {
    isPlaying, currentFrame, stopFrame, trackEnd, atStopFrame, playedMs,
    stopDraft, setStopDraft, commitStopFrame,
    clearStopFrame: () => useSimStore.getState().setStopFrame(null),
  };
}
