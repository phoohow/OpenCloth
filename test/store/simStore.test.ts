import { beforeEach, describe, expect, it } from 'vitest';
import { useSimStore } from '../../src/store/simStore';

describe('simStore auto-pause frame', () => {
  beforeEach(() => {
    useSimStore.setState({ currentFrame: 0, stopFrame: null, isPlaying: false });
  });

  it('starts unset', () => {
    expect(useSimStore.getState().stopFrame).toBeNull();
  });

  it('accepts a frame ahead of the current frame', () => {
    useSimStore.setState({ currentFrame: 10 });
    useSimStore.getState().setStopFrame(120);
    expect(useSimStore.getState().stopFrame).toBe(120);
  });

  it('clamps a frame below the current frame', () => {
    useSimStore.setState({ currentFrame: 80 });
    useSimStore.getState().setStopFrame(20);
    expect(useSimStore.getState().stopFrame).toBe(80);
  });

  it('rounds fractional input to a whole frame', () => {
    useSimStore.setState({ currentFrame: 5 });
    useSimStore.getState().setStopFrame(42.6);
    expect(useSimStore.getState().stopFrame).toBe(43);
  });

  it('clears the frame with null', () => {
    useSimStore.setState({ currentFrame: 3 });
    useSimStore.getState().setStopFrame(30);
    useSimStore.getState().setStopFrame(null);
    expect(useSimStore.getState().stopFrame).toBeNull();
  });

  it('keeps the frame across a reset', () => {
    useSimStore.setState({ currentFrame: 50 });
    useSimStore.getState().setStopFrame(90);
    useSimStore.getState().reset();
    expect(useSimStore.getState().currentFrame).toBe(0);
    expect(useSimStore.getState().stopFrame).toBe(90);
  });
});

describe('simStore playback clock and frame step', () => {
  beforeEach(() => {
    useSimStore.setState({ currentFrame: 0, isPlaying: false, playedMs: 0 });
  });

  it('accumulates playback time and drops negative input', () => {
    useSimStore.getState().addPlayedMs(120);
    useSimStore.getState().addPlayedMs(-40);
    expect(useSimStore.getState().playedMs).toBe(120);
  });

  it('advances one frame per call', () => {
    useSimStore.getState().incrementFrame();
    useSimStore.getState().incrementFrame();
    expect(useSimStore.getState().currentFrame).toBe(2);
  });

  it('clears the playback clock on reset', () => {
    useSimStore.getState().addPlayedMs(500);
    useSimStore.getState().reset();
    expect(useSimStore.getState().playedMs).toBe(0);
  });
});
