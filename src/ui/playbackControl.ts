import type { EngineRef } from '@/ui/sceneCommands';

import { useSimStore, useUIStore } from '@/store';
import {
  pauseAvatarClip, playAvatarClip, rewindAvatarClip, stepAvatarClip,
} from '@/ui/panels/animationPlayback';

function reachedChannels(): { sim: boolean; animation: boolean } {
  const { playbackChannel, linkChannels } = useUIStore.getState();
  if (linkChannels) return { sim: true, animation: true };
  return { sim: playbackChannel === 'sim', animation: playbackChannel === 'animation' };
}

function reachedStopFrame(stopFrame: number | null, currentFrame: number): boolean {
  return stopFrame !== null && currentFrame >= stopFrame;
}

export function togglePlayback(engineRef: EngineRef): void {
  const sim = useSimStore.getState();
  const engine = engineRef.current;
  const reached = reachedChannels();
  const playing = (reached.sim && sim.isPlaying) || (reached.animation && sim.animation.playing);

  if (playing) {
    if (reached.sim) sim.pause();
    if (reached.animation && engine) pauseAvatarClip(engine);
    return;
  }

  if (reached.sim && !reachedStopFrame(sim.stopFrame, sim.currentFrame)) sim.play();
  if (reached.animation && engine && sim.animation.clips.length > 0) {
    const clipIndex = Math.max(sim.animation.clipIndex, 0);
    playAvatarClip(engine, clipIndex);
  }
}

export function stepPlayback(engineRef: EngineRef): void {
  const sim = useSimStore.getState();
  const engine = engineRef.current;
  const reached = reachedChannels();

  if (reached.sim && !reachedStopFrame(sim.stopFrame, sim.currentFrame)) sim.step();
  if (reached.animation && engine && sim.animation.clips.length > 0) stepAvatarClip(engine);
}

export function resetPlayback(engineRef: EngineRef): void {
  const engine = engineRef.current;
  const reached = reachedChannels();

  if (reached.sim) {
    useSimStore.getState().reset();
    engine?.resetSimulation();
  }

  if (reached.animation && engine) rewindAvatarClip(engine);
}
