export type AnalysisKind = 'fit' | 'strain' | 'pressure';

export function liveOr(fallback: Float32Array, live: Float32Array): Float32Array {
  return live.length === fallback.length && fallback.length > 0 ? live : fallback;
}
