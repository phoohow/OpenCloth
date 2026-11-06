/** Timestamps formatted for the recent-project rows and the autosave status text. */
export { formatSavedAt, formatClockTime } from '@/common/text';

/** Elapsed time as seconds, switching to minutes and seconds past one minute. */
export function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
}
