import type { GarmentEngine } from '@/runtime';
import type { EngineRef } from '@/ui/sceneCommands';

import { DEFAULT_PRESSURE_KPA_PER_MM, dynamicPressureCsv } from '@/analysis';
import { downloadTextFile } from '@/io/serialization';
import { useSimStore, useUIStore, type AnimationInfo } from '@/store';

const ANIMATION_FRAME_MS = 1000 / 30;

export interface AvatarPlayback {
  animation: AnimationInfo;
  durationMs: number;
  samples: number;
  dynamicSampling: boolean;
  setDynamicSampling: (enabled: boolean) => void;
  hasClips: boolean;
  clipIndex: number;
  playbackIdle: boolean;
  resetAnimation: () => void;
  togglePlay: () => void;
  stepFrame: () => void;
  seekTo: (seconds: number) => void;
  commitSeek: () => void;
  chooseClip: (value: string) => void;
  clearSamples: () => void;
  exportCsv: () => void;
}

export function playAvatarClip(engine: GarmentEngine, index: number): void {
  void engine.playAvatarAnimation(index);
}

export function pauseAvatarClip(engine: GarmentEngine): void {
  engine.pauseAvatarAnimation();
}

export function stepAvatarClip(engine: GarmentEngine): void {
  engine.stepAvatarAnimation(ANIMATION_FRAME_MS);
}

export function rewindAvatarClip(engine: GarmentEngine): void {
  engine.rewindAvatarAnimation();
}

export function useAvatarPlayback(projectName: string, engineRef: EngineRef): AvatarPlayback {
  const animation = useSimStore(s => s.animation);
  const samples = useSimStore(s => s.dynamicSamples);
  const dynamicSampling = useUIStore(s => s.dynamicSampling);
  const setDynamicSampling = useUIStore(s => s.setDynamicSampling);
  const pressureMaxKpa = useUIStore(s => s.pressureMaxKpa);
  const engine = engineRef.current;
  const hasClips = animation.clips.length > 0;
  const clipIndex = animation.clipIndex >= 0 ? animation.clipIndex : 0;
  const durationMs = animation.clipDurationsMs[clipIndex] ?? 0;

  const seekTo = (seconds: number) => {
    engine?.seekAvatarAnimation(seconds * 1000);
  };

  const commitSeek = () => {
    engine?.settleAvatarSeek();
  };

  const resetAnimation = () => {
    if (engine) rewindAvatarClip(engine);
  };

  const togglePlay = () => {
    if (!engine || !hasClips) return;
    if (engine.avatarAnimationInfo().playing) pauseAvatarClip(engine);
    else playAvatarClip(engine, clipIndex);
  };

  const stepFrame = () => {
    if (engine) stepAvatarClip(engine);
  };

  const chooseClip = (value: string) => {
    engine?.selectAvatarClip(Number(value));
  };

  const clearSamples = () => {
    engine?.clearDynamicFitSamples();
    useSimStore.getState().setDynamicSamples(0);
  };

  const exportCsv = () => {
    if (!engine) return;
    downloadTextFile(
      `${projectName}-动态合身.csv`,
      '\ufeff' + dynamicPressureCsv(projectName, engine.getDynamicFitSamples(), {
        maxKpa: pressureMaxKpa,
        kpaPerMm: DEFAULT_PRESSURE_KPA_PER_MM,
        clipName: animation.clips[clipIndex],
      }),
      'text/csv;charset=utf-8',
    );
  };

  return {
    animation, durationMs, samples, dynamicSampling, setDynamicSampling, hasClips, clipIndex,
    playbackIdle: !engine || !hasClips, resetAnimation, togglePlay,
    stepFrame, seekTo, commitSeek, chooseClip, clearSamples, exportCsv,
  };
}
