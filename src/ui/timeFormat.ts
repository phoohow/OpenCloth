/** Timestamps formatted for the recent-project rows and the autosave status text. */

const pad = (n: number): string => String(n).padStart(2, '0');
const clock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Storage timestamp as MM-DD HH:mm. */
export function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock(date)}`;
}

/** Storage timestamp as HH:mm. */
export function formatClockTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : clock(date);
}
