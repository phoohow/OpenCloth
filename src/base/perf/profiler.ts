const WINDOW_FRAMES = 240;

let enabled = false;

let frame: OpenFrame | null = null;

const window: FrameSample[] = [];

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

export interface FrameSpan {
  readonly label: string;
  readonly ms: number;
  readonly depth: number;
  readonly offsetMs: number;
}

export interface FrameSample {
  readonly workMs: number;
  readonly intervalMs: number;
  readonly spans: readonly FrameSpan[];
}

export interface SpanStats {
  readonly label: string;
  readonly depth: number;
  readonly lastMs: number | null;
  readonly avgMs: number;
  readonly maxMs: number;
  readonly samples: number;
}

export interface ProfileSnapshot {
  readonly frames: number;
  readonly lastWorkMs: number;
  readonly avgWorkMs: number;
  readonly maxWorkMs: number;
  readonly lastIntervalMs: number;
  readonly spans: readonly SpanStats[];
}

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

function beginFrame(): void {
  if (!enabled) return;
  frame = { startMs: performance.now(), spans: [], stack: [] };
}

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

function begin(label: string): void {
  if (!frame) return;
  frame.stack.push({ label, startMs: performance.now(), depth: frame.stack.length });
}

function span<T>(label: string, fn: () => T): T {
  if (!frame) return fn();
  begin(label);
  try {
    return fn();
  } finally {
    end();
  }
}

async function spanAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!frame) return fn();
  begin(label);
  try {
    return await fn();
  } finally {
    end();
  }
}

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

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

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

function reset(): void {
  frame = null;
  window.length = 0;
}

function setEnabled(on: boolean): void {
  if (enabled === on) return;
  enabled = on;
  reset();
}
