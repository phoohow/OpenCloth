/** Optional per-frame CPU spans shared by the 3D frame loop, the solver and the renderer. */

/** One measured section of a frame. */
export interface FrameSpan {
  readonly label: string;
  /** Wall-clock time the section took, in milliseconds. */
  readonly ms: number;
  /** Nesting level; 0 for a section that starts at the frame top. */
  readonly depth: number;
  /** Milliseconds from the frame start to the beginning of the section. */
  readonly offsetMs: number;
}

/** One collected frame. */
export interface FrameSample {
  /** Time the frame loop's work took, in milliseconds. */
  readonly workMs: number;
  /** Time since the previous frame's start, in milliseconds; 0 for the first one. */
  readonly intervalMs: number;
  readonly spans: readonly FrameSpan[];
}

/** Windowed statistics of one label. */
export interface SpanStats {
  readonly label: string;
  readonly depth: number;
  /** Value in the newest frame; null when that frame did not run the section. */
  readonly lastMs: number | null;
  readonly avgMs: number;
  readonly maxMs: number;
  /** Frames in the window that ran the section. */
  readonly samples: number;
}

/** Published view of the sampling window. */
export interface ProfileSnapshot {
  /** Frames currently kept. */
  readonly frames: number;
  readonly lastWorkMs: number;
  readonly avgWorkMs: number;
  readonly maxWorkMs: number;
  readonly lastIntervalMs: number;
  /** Rows in display order: newest frame first, then older labels, deduplicated. */
  readonly spans: readonly SpanStats[];
}

/** Frames kept for the average and peak columns. */
const WINDOW_FRAMES = 240;

interface OpenSpan {
  readonly label: string;
  readonly startMs: number;
  readonly depth: number;
}

interface OpenFrame {
  readonly startMs: number;
  readonly spans: FrameSpan[];
  readonly stack: OpenSpan[];
}

let enabled = false;
let frame: OpenFrame | null = null;
const window: FrameSample[] = [];

/** Opens the frame window and drops whatever was collected before it. */
function beginFrame(): void {
  if (!enabled) return;
  frame = { startMs: performance.now(), spans: [], stack: [] };
}

/** Closes the newest still-open section and records its cost. */
function end(): void {
  if (!frame) return;
  const span = frame.stack.pop();
  if (!span) return;
  const now = performance.now();
  frame.spans.push({
    label: span.label,
    ms: Math.max(0, now - span.startMs),
    depth: span.depth,
    offsetMs: span.startMs - frame.startMs,
  });
}

/** Marks the start of a section; every begin must be paired with one end. */
function begin(label: string): void {
  if (!frame) return;
  frame.stack.push({ label, startMs: performance.now(), depth: frame.stack.length });
}

/** Runs a synchronous section and records it when sampling is on. */
function span<T>(label: string, fn: () => T): T {
  if (!frame) return fn();
  begin(label);
  try {
    return fn();
  } finally {
    end();
  }
}

/** Awaits an asynchronous section and records its wall-clock cost when sampling is on. */
async function spanAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!frame) return fn();
  begin(label);
  try {
    return await fn();
  } finally {
    end();
  }
}

/** Stores the frame's spans and retires the oldest sample past the window. */
function endFrame(intervalMs: number): void {
  if (!frame) return;
  const current = frame;
  frame = null;
  const spans = [...current.spans].sort(
    (a, b) => a.offsetMs - b.offsetMs || a.depth - b.depth,
  );
  window.push({
    workMs: Math.max(0, performance.now() - current.startMs),
    intervalMs: Math.max(0, intervalMs),
    spans,
  });
  if (window.length > WINDOW_FRAMES) window.shift();
}

/** Average of a numeric list; 0 when it is empty. */
function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Rows of the newest frame, then labels that only older frames produced. */
function rows(): readonly { label: string; depth: number }[] {
  const out: { label: string; depth: number }[] = [];
  const seen = new Set<string>();
  for (let i = window.length - 1; i >= 0; i--) {
    for (const span of window[i]!.spans) {
      if (seen.has(span.label)) continue;
      seen.add(span.label);
      out.push({ label: span.label, depth: span.depth });
    }
  }
  return out;
}

/** Statistics of the sampling window; null until one frame has been collected. */
function snapshot(): ProfileSnapshot | null {
  const last = window[window.length - 1];
  if (!last) return null;
  const stats: SpanStats[] = rows().map(({ label, depth }) => {
    let sum = 0;
    let maxMs = 0;
    let samples = 0;
    for (const sample of window) {
      const span = sample.spans.find(entry => entry.label === label);
      if (!span) continue;
      sum += span.ms;
      if (span.ms > maxMs) maxMs = span.ms;
      samples++;
    }
    const latest = last.spans.find(entry => entry.label === label);
    return {
      label,
      depth,
      lastMs: latest ? latest.ms : null,
      avgMs: samples > 0 ? sum / samples : 0,
      maxMs,
      samples,
    };
  });
  return {
    frames: window.length,
    lastWorkMs: last.workMs,
    avgWorkMs: average(window.map(sample => sample.workMs)),
    maxWorkMs: Math.max(...window.map(sample => sample.workMs)),
    lastIntervalMs: last.intervalMs,
    spans: stats,
  };
}

/** Drops every collected frame; the next frame starts a new window. */
function reset(): void {
  frame = null;
  window.length = 0;
}

/** Turns sampling on or off; switching either way clears the window. */
function setEnabled(on: boolean): void {
  if (enabled === on) return;
  enabled = on;
  reset();
}

/** The single sampler every layer writes to; a no-op while the debug panel is closed. */
export const frameProfiler = {
  get enabled(): boolean { return enabled; },
  setEnabled,
  reset,
  beginFrame,
  begin,
  end,
  endFrame,
  span,
  spanAsync,
  snapshot,
};
