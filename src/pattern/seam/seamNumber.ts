import type { Pattern } from '@/model/types';

/**
 * 1-based display number of a seam, taken from its position in the seams map.
 * The 2D canvas labels each seam pair with this number.
 */
export function seamNumber(pattern: Pattern, seamId: string): number | null {
  const index = Object.keys(pattern.seams).indexOf(seamId);
  return index < 0 ? null : index + 1;
}

/**
 * Display numbers of every seam at once, in the order `seamNumber` would report them.
 * Callers that walk all seams (canvas, scene tree) build the map once instead of
 * rescanning the seams once per seam.
 */
export function seamNumbers(pattern: Pattern): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  let index = 1;
  for (const seamId of Object.keys(pattern.seams)) numbers.set(seamId, index++);
  return numbers;
}
