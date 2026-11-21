import { useState } from 'react';

import { Button, Input, Modal, Select, Textarea } from '@/components/ui';

import {
  FREQUENCY_LABEL,
  RANGE_LABEL,
  REPORT_LABEL,
  parseRecipients,
  validateSchedule,
} from './reports';
import {
  RANGE_KEYS,
  REPORT_IDS,
  type RangeKey,
  type ReportId,
  type ScheduleDraft,
  type ScheduleFormat,
  type ScheduleFrequency,
} from './reports.types';

/**
 * "Schedule report (email recurrence)" — §3.8's header action.
 *
 * The dialog opens pre-filled with the tab and range the administrator is
 * looking at, because that is what they just decided they want to receive
 * every week. Making them re-pick both would be asking a question the screen
 * has already answered.
 *
 * Validation runs on submit rather than on every keystroke: a recipient list
 * is half-invalid for as long as somebody is typing it, and an error that
 * appears after the first character is noise rather than help.
 */

export interface ScheduleReportDialogProps {
  open: boolean;
  onClose: () => void;
  /** The tab and range the page is currently showing. */
  reportId: ReportId;
  range: RangeKey;
  onSubmit: (draft: ScheduleDraft) => void;
  submitting: boolean;
}

const FREQUENCIES: readonly ScheduleFrequency[] = ['daily', 'weekly', 'monthly'];

const FORMATS: readonly { readonly value: ScheduleFormat; readonly label: string }[] = [
  { value: 'pdf', label: 'PDF deck' },
  { value: 'csv', label: 'CSV' },
];

export function ScheduleReportDialog({
  open,
  onClose,
  reportId,
  range,
  onSubmit,
  submitting,
}: ScheduleReportDialogProps) {
  const [name, setName] = useState(`${REPORT_LABEL[reportId]} report`);
  const [selectedReport, setSelectedReport] = useState<ReportId>(reportId);
  const [selectedRange, setSelectedRange] = useState<RangeKey>(range);
  const [frequency, setFrequency] = useState<ScheduleFrequency>('weekly');
  const [format, setFormat] = useState<ScheduleFormat>('pdf');
  const [recipientsRaw, setRecipientsRaw] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const draft: ScheduleDraft = {
    reportId: selectedReport,
    name,
    frequency,
    range: selectedRange,
    recipients: parseRecipients(recipientsRaw),
    format,
  };
  const validation = validateSchedule(draft);

  const submit = () => {
    setShowErrors(true);
    if (!validation.ok) return;
    onSubmit(draft);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule this report"
      description="The report is built at the scheduled time and emailed to everyone on the list."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting}>
            Create schedule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Schedule name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          error={showErrors ? (validation.nameError ?? undefined) : undefined}
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Report"
            value={selectedReport}
            onChange={(value) => {
              // Narrowed through the same union the options were built from,
              // so an unknown string cannot become a report id by assertion.
              const next = REPORT_IDS.find((entry) => entry === value);
              if (next !== undefined) setSelectedReport(next);
            }}
            options={REPORT_IDS.map((id) => ({ value: id, label: REPORT_LABEL[id] }))}
          />
          <Select
            label="Range"
            value={selectedRange}
            onChange={(value) => {
              const next = RANGE_KEYS.find((entry) => entry === value);
              if (next !== undefined) setSelectedRange(next);
            }}
            options={RANGE_KEYS.map((key) => ({ value: key, label: RANGE_LABEL[key] }))}
          />
          <Select
            label="Frequency"
            value={frequency}
            onChange={(value) => {
              const next = FREQUENCIES.find((entry) => entry === value);
              if (next !== undefined) setFrequency(next);
            }}
            options={FREQUENCIES.map((entry) => ({
              value: entry,
              label: FREQUENCY_LABEL[entry],
            }))}
          />
          <Select
            label="Format"
            value={format}
            onChange={(value) => {
              const next = FORMATS.find((entry) => entry.value === value);
              if (next !== undefined) setFormat(next.value);
            }}
            options={FORMATS}
          />
        </div>

        <Textarea
          label="Recipients"
          value={recipientsRaw}
          onChange={(event) => {
            setRecipientsRaw(event.target.value);
          }}
          placeholder="leadership@medora.health, operations@medora.health"
          helperText="Separate addresses with a comma, a semicolon or a new line."
          error={showErrors ? (validation.recipientsError ?? undefined) : undefined}
          rows={3}
          required
        />

        {/*
         * Stated rather than implied. Nothing in a browser delivers email on a
         * recurrence, so a schedule created here is a stored intention until a
         * server picks it up — and a panel that let an administrator believe
         * leadership is receiving a weekly deck when nothing is sending one
         * would be worse than not shipping the feature.
         */}
        <p className="text-caption text-text-tertiary">
          Schedules are stored on this device. No delivery runs until the platform&rsquo;s reporting
          service is connected.
        </p>
      </div>
    </Modal>
  );
}
