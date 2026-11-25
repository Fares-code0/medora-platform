import { useState } from 'react';

import { CalendarClock, CheckCircle2, Pause, Play, Plus, Trash2, XCircle } from 'lucide-react';

import { useAuth, useToast } from '@/app/providers';
import { Stack } from '@/components/layout';
import { Badge, Button, IconButton, Input, Modal, Select, Textarea } from '@/components/ui';

import {
  useCreateScheduleMutation,
  useDeleteScheduleMutation,
  useToggleScheduleStatusMutation,
} from '../api/useReportsQueries';
import { formatDateTime } from '../model/format';
import type { ScheduleInput } from '../model/reports-service';
import {
  EXPORT_FORMATS,
  REPORT_CATEGORIES,
  type ReportCategory,
  type ScheduleFrequency,
  type ScheduledReport,
} from '../model/types';
import { reportsService } from '../service';

/**
 * Scheduled reports — automated delivery (daily/weekly/monthly) to a list of
 * recipients, with status, next-run, and a short send history. Create,
 * pause/resume, and delete are wired to the mock service. All frontend-only;
 * no email is actually sent.
 */

const FREQUENCY_LABEL: Record<ScheduleFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export function ScheduledReportsPanel({ scheduled }: { scheduled: readonly ScheduledReport[] }) {
  const { toast } = useToast();
  const toggleStatus = useToggleScheduleStatusMutation();
  const deleteSchedule = useDeleteScheduleMutation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const delivered = reportsService.capabilities.scheduleDelivery;
  const failed = (title: string) => () =>
    toast({ variant: 'error', title, description: 'Nothing was changed. Please try again.' });

  return (
    <div className="rounded-surface border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-surface bg-info-subtle text-info"
          >
            <CalendarClock className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <h3 className="text-h5 font-semibold text-text-primary">Scheduled reports</h3>
        </div>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={Plus}
          onClick={() => setDialogOpen(true)}
        >
          New schedule
        </Button>
      </div>

      {delivered ? null : (
        <p className="mb-3 rounded-surface bg-surface-sunken p-3 text-body-sm text-text-secondary">
          Schedules are saved on the Medora server, but reports are not sent yet — the server has no
          way to deliver them to recipients. Nothing will arrive by email.
        </p>
      )}

      {scheduled.length === 0 ? (
        <p className="text-body-sm text-text-secondary">
          {delivered
            ? 'No scheduled reports. Create one to deliver analytics automatically.'
            : 'No scheduled reports.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {scheduled.map((schedule) => {
            const lastRun = schedule.history[0];
            return (
              <li key={schedule.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-sm font-medium text-text-primary">
                      {schedule.name}
                    </span>
                    <Badge variant={schedule.status === 'active' ? 'success' : 'neutral'} dot>
                      {schedule.status === 'active' ? 'Active' : 'Paused'}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-caption text-text-tertiary">
                    {[
                      FREQUENCY_LABEL[schedule.frequency],
                      EXPORT_FORMATS.find((f) => f.id === schedule.format)?.label ??
                        schedule.format,
                      `${String(schedule.recipients.length)} ${
                        schedule.recipients.length === 1 ? 'recipient' : 'recipients'
                      }`,
                    ].join(' · ')}
                  </p>
                  <p className="mt-0.5 text-caption text-text-tertiary">
                    {delivered
                      ? `Next run ${formatDateTime(schedule.nextRunAt)}`
                      : `Due ${formatDateTime(schedule.nextRunAt)} · not sent while delivery is unavailable`}
                  </p>
                  {lastRun ? (
                    <p className="mt-1 flex items-center gap-1 text-caption text-text-tertiary">
                      {lastRun.status === 'sent' ? (
                        <CheckCircle2
                          className="h-3 w-3 text-success"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      ) : (
                        <XCircle
                          className="h-3 w-3 text-error"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      )}
                      {`Last ${lastRun.status === 'sent' ? 'sent' : 'failed'} ${formatDateTime(lastRun.at)}`}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    icon={schedule.status === 'active' ? Pause : Play}
                    aria-label={schedule.status === 'active' ? 'Pause schedule' : 'Resume schedule'}
                    size="sm"
                    onClick={() =>
                      toggleStatus.mutate(schedule.id, {
                        onError: failed('Could not change the schedule'),
                      })
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    aria-label="Delete schedule"
                    size="sm"
                    onClick={() =>
                      deleteSchedule.mutate(schedule.id, {
                        onSuccess: () => toast({ variant: 'success', title: 'Schedule deleted' }),
                        onError: failed('Could not delete the schedule'),
                      })
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ScheduleDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          setDialogOpen(false);
          toast({ variant: 'success', title: 'Schedule created' });
        }}
      />
    </div>
  );
}

function ScheduleDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const createMutation = useCreateScheduleMutation();
  const { toast } = useToast();
  const { user } = useAuth();
  // The signed-in doctor's own address — never a seeded one.
  const ownEmail = user?.email ?? '';
  const delivered = reportsService.capabilities.scheduleDelivery;
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ReportCategory>('overview');
  const [frequency, setFrequency] = useState<ScheduleFrequency>('weekly');
  const [format, setFormat] = useState<ScheduleInput['format']>('pdf');
  const [recipients, setRecipients] = useState(ownEmail);

  const emails = recipients
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const valid = name.trim().length > 0 && emails.length > 0;

  const submit = () => {
    if (!valid) return;
    createMutation.mutate(
      { name: name.trim(), category, frequency, format, recipients: emails },
      {
        onSuccess: () => {
          setName('');
          setRecipients(ownEmail);
          onCreated();
        },
        onError: () =>
          toast({
            variant: 'error',
            title: 'Could not create the schedule',
            description: 'Check the name and that every recipient is a valid email address.',
          }),
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New scheduled report"
      description={
        delivered
          ? 'Deliver an analytics report automatically on a recurring schedule.'
          : 'Save a recurring report. The server keeps it, but does not send reports yet.'
      }
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid} loading={createMutation.isPending}>
            Create schedule
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        <Input
          label="Report name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Weekly revenue report"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Category"
            value={category}
            onChange={(value) => setCategory(value as ReportCategory)}
            options={REPORT_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
          />
          <Select
            label="Frequency"
            value={frequency}
            onChange={(value) => setFrequency(value as ScheduleFrequency)}
            options={[
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
            ]}
          />
        </div>
        <Select
          label="Format"
          value={format}
          onChange={(value) => setFormat(value as ScheduleInput['format'])}
          options={EXPORT_FORMATS.filter((f) => f.id !== 'print').map((f) => ({
            value: f.id,
            label: f.label,
          }))}
        />
        <Textarea
          label="Recipients"
          value={recipients}
          onChange={(event) => setRecipients(event.target.value)}
          rows={2}
          helperText="Comma- or newline-separated email addresses."
        />
      </Stack>
    </Modal>
  );
}
