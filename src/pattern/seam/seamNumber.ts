import type { Pattern } from '@/model/types';

export function seamNumber(pattern: Pattern, seamId: string): number | null {
  const index = Object.keys(pattern.seams).indexOf(seamId);
  return index < 0 ? null : index + 1;
}

export function seamNumbers(pattern: Pattern): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  let index = 1;
  for (const seamId of Object.keys(pattern.seams)) numbers.set(seamId, index++);
  return numbers;
}
