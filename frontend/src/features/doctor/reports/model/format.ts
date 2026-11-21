import { formatDateWith } from '@/i18n';
/**
 * Date/time formatters for the reports UI (schedules, saved-report
 * timestamps). Numeric formatters live in `selectors.ts` beside the
 * analytics derivation; these are separated so date-only consumers don't
 * pull in the selector graph.
 */

export function formatDateTime(iso: string): string {
  return formatDateWith(new Date(iso), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(iso: string): string {
  return formatDateWith(new Date(iso), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
