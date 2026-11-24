export interface SizeDef {
  id: string;
  label: string;
  seq: number;
  isBase?: boolean;
}

export type PomBodyKey = 'height' | 'chest' | 'waist' | 'hip';

export type PomKind = 'distance' | 'edge' | 'body';

export interface PomRefs {
  pointAId?: string;
  pointBId?: string;
  edgeId?: string;
  bodyKey?: PomBodyKey;
}

export interface PomPoint {
  id: string;
  name: string;
  part: string;
  kind: PomKind;
  refs: PomRefs;
  values: Record<string, number>;
  stepCm?: number;
  formula?: string;
}
