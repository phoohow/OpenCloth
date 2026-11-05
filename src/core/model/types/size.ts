/**
 * Size chart and points of measure, the two per-size tables the project carries.
 */


// ============ Sizes ============

/** One entry of the project size chart. */
export interface SizeDef {
  id: string;
  /** Display label, e.g. M. */
  label: string;
  /** Ordered index; grading steps follow this order. */
  seq: number;
  /** True on the size whose geometry the pattern stores directly. */
  isBase?: boolean;
}

// ============ POM ============

/** Body dimension a body-anchored POM reads from the avatar instead of the pattern. */
export type PomBodyKey = 'height' | 'chest' | 'waist' | 'hip';

/** How a POM reads its base value. */
export type PomKind = 'distance' | 'edge' | 'body';

/** Pattern elements a POM measures, or the body dimension it reads. */
export interface PomRefs {
  pointAId?: string;
  pointBId?: string;
  edgeId?: string;
  bodyKey?: PomBodyKey;
}

/** One point of measure with its per-size values and optional rule. */
export interface PomPoint {
  id: string;
  name: string;
  /** Body part shown in the size table and the report, e.g. 胸宽 / 衣长. */
  part: string;
  kind: PomKind;
  refs: PomRefs;
  /** Explicit values per size in centimetres; the base size stays measured from geometry. */
  values: Record<string, number>;
  /** Difference applied per size step when the size has no explicit value, in centimetres. */
  stepCm?: number;
  /** Formula over other POM names, evaluated per size; overrides table values. */
  formula?: string;
}
