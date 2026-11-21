/**
 * Date formatting helpers — pure functions (FRONTEND_ARCHITECTURE §2).
 * All formatting goes through Intl; no date library until one is needed.
 */

const DAY_MS = 86_400_000;

/**
 * "Mar 12, 2026" and "14:30", in the app's language with Latin digits — the
 * shared formatters from `@/i18n` (DEC-009), re-exported here for the call
 * sites that already import them from `utils`.
 */
export { formatDate, formatTime } from '@/i18n';

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole-day difference from today (negative = past). */
export function dayDiffFromToday(iso: string): number {
  return Math.round((startOfDay(new Date(iso)) - startOfDay(new Date())) / DAY_MS);
}

/**
 * Coarse relative day label: "Today", "Yesterday", "3 weeks ago",
 * "in 5 days"… Pair it with the absolute date so precision is never lost
 * (clinical rule: relative + absolute together).
 */
export function relativeDayLabel(iso: string): string {
  const diff = dayDiffFromToday(iso);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';

  const abs = Math.abs(diff);
  const unit =
    abs >= 365
      ? ([Math.round(abs / 365), 'year'] as const)
      : abs >= 30
        ? ([Math.round(abs / 30), 'month'] as const)
        : abs >= 7
          ? ([Math.round(abs / 7), 'week'] as const)
          : ([abs, 'day'] as const);
  const phrase = `${String(unit[0])} ${unit[1]}${unit[0] === 1 ? '' : 's'}`;
  return diff < 0 ? `${phrase} ago` : `in ${phrase}`;
}
