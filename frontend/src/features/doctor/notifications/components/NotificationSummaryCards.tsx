import type { NotificationsSummary } from '../model/selectors';

/**
 * Notifications summary — one quiet line under the header ("4 unread ·
 * 1 critical · 6 today") over the unarchived dataset, rather than a band of
 * cards: the inbox itself stays the page's focal point.
 */
export function NotificationSummaryLine({
  summary,
  loading,
}: {
  summary: NotificationsSummary;
  loading: boolean;
}) {
  if (loading) return null;
  const parts: { id: string; label: string; strong?: boolean; tone?: string }[] = [
    {
      id: 'unread',
      label: summary.unread === 0 ? 'No unread' : `${String(summary.unread)} unread`,
      strong: summary.unread > 0,
    },
  ];
  if (summary.critical > 0) {
    parts.push({
      id: 'critical',
      label: `${String(summary.critical)} critical`,
      tone: 'text-error',
    });
  }
  parts.push({ id: 'today', label: `${String(summary.today)} today` });
  parts.push({ id: 'week', label: `${String(summary.thisWeek)} this week` });

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body-sm text-text-secondary">
      {parts.map((part, index) => (
        <span key={part.id} className="inline-flex items-center gap-2">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <span
            className={part.strong ? 'font-semibold text-text-primary' : (part.tone ?? undefined)}
          >
            {part.label}
          </span>
        </span>
      ))}
    </p>
  );
}
