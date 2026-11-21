import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui';

/**
 * D-12 — "a persistent 'Critical unreviewed: N' alert chip pins to the header
 * when N > 0" (UX §2.6).
 *
 * Three things make it a safety affordance rather than a decoration:
 *
 * - **It counts the whole dataset, not the page.** A filter that hides the
 *   critical result must not also hide the fact that one exists, so the count
 *   comes from every test the query returned and the chip's own action clears
 *   the filters that are hiding it.
 * - **It renders nothing at zero.** A chip reading "Critical unreviewed: 0" is
 *   noise that trains a reader to stop looking at that corner of the screen.
 * - **It is `role="alert"`, once.** It announces on arrival and on change,
 *   which is what a doctor returning to the tab needs, and it is not
 *   dismissible — a critical value is not something to acknowledge away from
 *   a header.
 */
export interface CriticalUnreviewedAlertProps {
  count: number;
  /** Narrows the list to exactly the results the count names. */
  onShow: () => void;
  /** True when the list is already filtered to them. */
  showing: boolean;
}

export function CriticalUnreviewedAlert({ count, onShow, showing }: CriticalUnreviewedAlertProps) {
  if (count <= 0) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-error bg-error-subtle px-4 py-2.5"
    >
      <p className="flex items-center gap-2 text-body-sm font-semibold text-error">
        <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
        Critical unreviewed: {count}
      </p>
      {showing ? (
        <p className="text-caption text-text-secondary">Showing them now.</p>
      ) : (
        <Button variant="secondary" size="sm" onClick={onShow}>
          Show {count === 1 ? 'it' : 'them'}
        </Button>
      )}
    </div>
  );
}
