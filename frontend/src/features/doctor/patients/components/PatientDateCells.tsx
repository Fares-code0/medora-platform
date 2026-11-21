import { StatusBadge } from '@/components/patterns';
import { formatDate, formatTime, dayDiffFromToday, relativeDayLabel } from '@/utils/dates';

/**
 * Date cells for the patients table. Relative labels always pair with the
 * absolute date (clinical precision rule); a today-appointment renders as
 * the P8 "scheduled" badge so it stands out in the column.
 */

export function DateCell({ iso }: { iso: string | null }) {
  if (iso === null) return <span className="text-text-tertiary">—</span>;
  return (
    <div className="min-w-0">
      <p className="whitespace-nowrap text-body-sm text-text-primary">{formatDate(iso)}</p>
      <p className="text-caption text-text-tertiary">{relativeDayLabel(iso)}</p>
    </div>
  );
}

export function NextAppointmentCell({ iso }: { iso: string | null }) {
  if (iso === null) return <span className="text-text-tertiary">—</span>;
  if (dayDiffFromToday(iso) === 0) {
    return <StatusBadge status="scheduled" label={`Today ${formatTime(iso)}`} />;
  }
  return <DateCell iso={iso} />;
}
