import type { ReactNode } from 'react';

import { isolateLtr } from '@/i18n';

import { formatBookingDate, formatBookingTime, type BookingDraft } from '../../model/booking';

/**
 * The running summary beside the flow. Dates and times are shown as the
 * clinic wall clock the doctor chose — the same values the request is built
 * from — never re-read through the device's zone.
 */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-caption font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </dt>
      <dd className="min-w-0 text-end text-body-sm text-text-primary">{children}</dd>
    </div>
  );
}

const NOT_YET = <span className="text-text-tertiary">Not chosen yet</span>;

export interface BookingSummaryProps {
  readonly draft: BookingDraft;
  readonly doctorName: string;
  readonly timeZone: string | null;
}

export function BookingSummary({ draft, doctorName, timeZone }: BookingSummaryProps) {
  return (
    <aside
      aria-labelledby="booking-summary-heading"
      className="rounded-surface border border-border bg-surface p-4 lg:sticky lg:top-4"
    >
      <h2 id="booking-summary-heading" className="text-body font-semibold text-text-primary">
        Booking summary
      </h2>
      <dl className="mt-2 divide-y divide-border">
        <Row label="Patient">
          {draft.patient === null ? (
            NOT_YET
          ) : (
            <>
              <span className="block truncate font-medium">{draft.patient.name}</span>
              <span className="block text-caption text-text-secondary">
                {isolateLtr(`MRN ${draft.patient.mrn}`)}
              </span>
            </>
          )}
        </Row>
        <Row label="Doctor">{doctorName}</Row>
        <Row label="Department">{draft.department === '' ? NOT_YET : draft.department}</Row>
        <Row label="Date">{draft.date === null ? NOT_YET : formatBookingDate(draft.date)}</Row>
        <Row label="Time">
          {draft.time === null ? (
            NOT_YET
          ) : (
            <>
              <span className="block tabular-nums">
                {formatBookingTime(draft.time, draft.durationMin)}
              </span>
              <span className="block text-caption text-text-secondary">
                {timeZone === null ? 'Device time' : isolateLtr(timeZone)}
              </span>
            </>
          )}
        </Row>
        <Row label="Duration">{isolateLtr(`${String(draft.durationMin)} min`)}</Row>
      </dl>
    </aside>
  );
}
