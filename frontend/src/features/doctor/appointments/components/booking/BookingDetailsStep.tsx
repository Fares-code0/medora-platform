import type { ReactNode } from 'react';

import { Pencil } from 'lucide-react';

import { Stack } from '@/components/layout';
import { Button, Select, Textarea } from '@/components/ui';
import { isolateLtr } from '@/i18n';

import {
  REASON_MAX_LENGTH,
  formatBookingDate,
  formatBookingTime,
  type BookingDraft,
  type BookingIssues,
  type BookingStepId,
} from '../../model/booking';
import {
  APPOINTMENT_PRIORITIES,
  APPOINTMENT_PRIORITY_META,
  VISIT_TYPES,
  type AppointmentPriority,
} from '../../model/types';

/**
 * Step 3 — Visit details, then the review.
 *
 * The review restates exactly what will be sent — the clinic-zone date and
 * time the doctor picked, not a re-reading of them — and each part has an
 * Edit that returns to the step owning it. Nothing is booked until the
 * page's "Confirm appointment".
 */
export interface BookingDetailsStepProps {
  readonly draft: BookingDraft;
  readonly onVisitTypeChange: (visitType: string) => void;
  readonly onPriorityChange: (priority: AppointmentPriority) => void;
  readonly onReasonChange: (reason: string) => void;
  readonly onEdit: (step: BookingStepId) => void;
  readonly doctorName: string;
  readonly timeZone: string | null;
  readonly issues: BookingIssues;
  readonly disabled: boolean;
}

function ReviewGroup({
  title,
  onEdit,
  editLabel,
  disabled,
  children,
}: {
  title: string;
  onEdit: () => void;
  editLabel: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-surface border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-body-sm font-semibold text-text-primary">{title}</h4>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={Pencil}
          onClick={onEdit}
          disabled={disabled}
          aria-label={editLabel}
        >
          Edit
        </Button>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-body-sm text-text-primary">{children}</dd>
    </div>
  );
}

export function BookingDetailsStep({
  draft,
  onVisitTypeChange,
  onPriorityChange,
  onReasonChange,
  onEdit,
  doctorName,
  timeZone,
  issues,
  disabled,
}: BookingDetailsStepProps) {
  return (
    <Stack gap={6}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Visit type"
          required
          value={draft.visitType}
          onChange={onVisitTypeChange}
          options={VISIT_TYPES.map((value) => ({ value, label: value }))}
          error={issues.visitType}
          disabled={disabled}
        />
        <Select
          label="Priority"
          value={draft.priority}
          onChange={(value) => onPriorityChange(value as AppointmentPriority)}
          options={APPOINTMENT_PRIORITIES.map((value) => ({
            value,
            label: APPOINTMENT_PRIORITY_META[value].label,
          }))}
          disabled={disabled}
        />
      </div>
      <Textarea
        label="Reason for the visit"
        required
        rows={3}
        maxLength={REASON_MAX_LENGTH}
        showCount
        value={draft.reason}
        onChange={(event) => onReasonChange(event.target.value)}
        placeholder="e.g. Follow-up on blood pressure"
        error={issues.reason}
        disabled={disabled}
      />

      <section aria-labelledby="booking-review-heading">
        <h3 id="booking-review-heading" className="text-body font-semibold text-text-primary">
          Review
        </h3>
        <p className="mt-0.5 text-caption text-text-secondary">
          Check the appointment below. Nothing is booked until you confirm.
        </p>
        <Stack gap={3} className="mt-3">
          <ReviewGroup
            title="Patient & doctor"
            editLabel="Edit patient and doctor"
            onEdit={() => onEdit('patient')}
            disabled={disabled}
          >
            <Fact label="Patient">
              {draft.patient === null
                ? '—'
                : `${draft.patient.name} · ${isolateLtr(`MRN ${draft.patient.mrn}`)}`}
            </Fact>
            <Fact label="Doctor">{doctorName}</Fact>
            <Fact label="Department">{draft.department}</Fact>
          </ReviewGroup>
          <ReviewGroup
            title="Date & time"
            editLabel="Edit date and time"
            onEdit={() => onEdit('schedule')}
            disabled={disabled}
          >
            <Fact label="Date">{draft.date === null ? '—' : formatBookingDate(draft.date)}</Fact>
            <Fact label="Time">
              {draft.time === null ? '—' : formatBookingTime(draft.time, draft.durationMin)}
              <span className="block text-caption text-text-secondary">
                {timeZone === null
                  ? "This device's time zone"
                  : `Clinic time · ${isolateLtr(timeZone)}`}
              </span>
            </Fact>
            <Fact label="Duration">{isolateLtr(`${String(draft.durationMin)} minutes`)}</Fact>
          </ReviewGroup>
        </Stack>
      </section>
    </Stack>
  );
}
