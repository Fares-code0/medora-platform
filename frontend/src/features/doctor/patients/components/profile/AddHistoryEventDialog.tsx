import { useState } from 'react';

import { useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Input, Modal, Select, Textarea } from '@/components/ui';

import { useAddHistoryEventMutation } from '../../api/usePatientProfileQuery';
import {
  HISTORY_DETAIL_MAX,
  HISTORY_FACILITY_MAX,
  HISTORY_TITLE_MAX,
  latestHistoryDay,
} from '../../model/profile-service';
import { HISTORY_KIND_META, type HistoryEventKind } from '../../model/profile-types';

/**
 * Add an event to the medical-history timeline (API §4.6).
 *
 * The kind has no default: "diagnosis" pre-selected would file a surgery as
 * a diagnosis whenever someone forgot to change it. The date cannot be in the
 * future — the server refuses it, and the picker's maximum is the latest day
 * the server will accept (`latestHistoryDay`). Pessimistic: the event is
 * announced once the timeline has refetched with it.
 *
 * Removing an event is not offered: deleting clinical history is an owner
 * decision (DEC-003).
 */
export interface AddHistoryEventDialogProps {
  open: boolean;
  patientId: string;
  patientName: string;
  onClose: () => void;
}

const KINDS = Object.keys(HISTORY_KIND_META) as HistoryEventKind[];

interface Draft {
  readonly kind: HistoryEventKind | null;
  readonly title: string;
  readonly occurredOn: string;
  readonly facility: string;
  readonly detail: string;
}

const EMPTY: Draft = { kind: null, title: '', occurredOn: '', facility: '', detail: '' };

function failureOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const { detail } = error as { readonly detail?: unknown };
    if (typeof detail === 'string' && detail !== '') return detail;
  }
  return 'Nothing was saved. Please try again.';
}

export function AddHistoryEventDialog({
  open,
  patientId,
  patientName,
  onClose,
}: AddHistoryEventDialogProps) {
  const { toast } = useToast();
  const add = useAddHistoryEventMutation(patientId);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [showIssues, setShowIssues] = useState(false);
  const latest = latestHistoryDay();

  const title = draft.title.trim();
  const issues = {
    kind: draft.kind === null ? 'Choose what kind of event this is' : undefined,
    title: title === '' ? 'Name the event' : undefined,
    occurredOn:
      draft.occurredOn === ''
        ? 'Enter the date it happened'
        : draft.occurredOn > latest
          ? 'A history event cannot be in the future'
          : undefined,
  };
  const valid = Object.values(issues).every((issue) => issue === undefined);

  const close = () => {
    setDraft(EMPTY);
    setShowIssues(false);
    add.reset();
    onClose();
  };

  const submit = () => {
    setShowIssues(true);
    if (!valid || draft.kind === null) return;
    add.mutate(
      {
        kind: draft.kind,
        title,
        occurredOn: draft.occurredOn,
        detail: draft.detail,
        facility: draft.facility,
      },
      {
        onSuccess: (event) => {
          close();
          toast({
            variant: 'success',
            title: `${event.title} added to the history`,
            description: `${HISTORY_KIND_META[event.kind].label} on ${patientName}’s timeline.`,
          });
        },
      },
    );
  };

  const issue = (field: keyof typeof issues) => (showIssues ? issues[field] : undefined);

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title="Add to medical history"
      description={`For ${patientName}.`}
      dismissible={!add.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={add.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={add.isPending}>
            Add event
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Stack gap={4}>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
            <Select
              label="Kind"
              required
              value={draft.kind}
              placeholder="Choose…"
              onChange={(value) => setDraft({ ...draft, kind: value as HistoryEventKind })}
              options={KINDS.map((kind) => ({ value: kind, label: HISTORY_KIND_META[kind].label }))}
              error={issue('kind')}
            />
            <Input
              type="date"
              label="Date"
              required
              max={latest}
              value={draft.occurredOn}
              onChange={(event) => setDraft({ ...draft, occurredOn: event.target.value })}
              error={issue('occurredOn')}
            />
          </div>
          <Input
            label="Event"
            required
            maxLength={HISTORY_TITLE_MAX}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            error={issue('title')}
            placeholder="e.g. Laparoscopic cholecystectomy"
          />
          <Input
            label="Facility (optional)"
            maxLength={HISTORY_FACILITY_MAX}
            value={draft.facility}
            onChange={(event) => setDraft({ ...draft, facility: event.target.value })}
          />
          <Textarea
            label="Detail (optional)"
            rows={3}
            maxLength={HISTORY_DETAIL_MAX}
            value={draft.detail}
            onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
          />
          {add.isError ? (
            <Alert variant="error" title="The event was not added">
              {failureOf(add.error)}
            </Alert>
          ) : null}
        </Stack>
      </form>
    </Modal>
  );
}
