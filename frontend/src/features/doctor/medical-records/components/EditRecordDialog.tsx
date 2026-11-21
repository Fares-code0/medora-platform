import { useEffect, useMemo, useState } from 'react';

import { Star, X } from 'lucide-react';

import { useAuth, useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Badge, Button, IconButton, Input, Modal, Select, Textarea } from '@/components/ui';

import { useUpdateRecordMutation } from '../api/useRecordMutations';
import { withDiagnosisAdded, withDiagnosisRemoved, withPrimaryDiagnosis } from '../model/authoring';
import {
  editChangesOf,
  editFormOf,
  editIssuesOf,
  hasEditIssues,
  type RecordEditForm,
  type RecordEditIssues,
} from '../model/record-edit';
import {
  RECORD_EDIT_REASON_MAX,
  RECORD_NARRATIVE_MAX,
  RECORD_NO_CHANGE,
  RECORD_NOT_AUTHOR,
  RECORD_NOT_EDITABLE,
} from '../model/record-service';
import { DIAGNOSES, RECORD_VISIT_TYPES, type MedicalRecord } from '../model/types';

import { TreatmentPlanEditor } from './TreatmentPlanEditor';

/**
 * Edit a draft record (DEC-004).
 *
 * Offered only while the record is a draft with nothing signed
 * (`canEditRecord`); after the first signature corrections are addenda. Only
 * the fields that changed are sent, because the server refuses an edit that
 * changes nothing, and each edit becomes a version row the record's history
 * shows — who, when, before and after.
 *
 * Notes are not edited here: they have their own sign and amend flow. What
 * else is left out, and why — department, medications, allergies — is in
 * `model/record-edit.ts`.
 *
 * BR-DEC-004: the server refuses anyone but the record's author (403
 * `not_record_author`) and keeps an optional reason on the version row. The
 * dialog offers the reason as optional — whether to require it is an open
 * owner decision — and names the author refusal. It still opens for any
 * doctor who can see the draft: the record names its doctor, not the
 * session's account, so the client cannot tell the author (DEC-004).
 */

function failureOf(error: unknown): string {
  if (error instanceof Error && error.message === RECORD_NO_CHANGE) {
    return 'The record already holds these values.';
  }
  if (error instanceof Error && error.message === RECORD_NOT_AUTHOR) {
    return 'Only the doctor who wrote this record can edit it. Add an addendum to correct it.';
  }
  if (error instanceof Error && error.message === RECORD_NOT_EDITABLE) {
    return 'This record can no longer be edited. Add an addendum instead.';
  }
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const { detail } = error as { readonly detail?: unknown };
    if (typeof detail === 'string' && detail !== '') return detail;
  }
  return 'Nothing was saved. Please try again.';
}

export function EditRecordDialog({
  open,
  record,
  onClose,
}: {
  open: boolean;
  record: MedicalRecord;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const update = useUpdateRecordMutation();
  const original = useMemo(() => editFormOf(record), [record]);
  const [form, setForm] = useState<RecordEditForm>(original);
  const [reason, setReason] = useState('');
  const [showIssues, setShowIssues] = useState(false);

  // Each opening starts from the record as it now stands.
  useEffect(() => {
    if (!open) return;
    setForm(original);
    setReason('');
    setShowIssues(false);
  }, [open, original]);

  const changes = editChangesOf(original, form);
  const changedCount = Object.keys(changes).length;
  const issues = editIssuesOf(form, reason);
  const valid = !hasEditIssues(issues);
  const issue = (field: Exclude<keyof RecordEditIssues, 'treatmentPlan'>) =>
    showIssues ? issues[field] : undefined;

  const close = () => {
    update.reset();
    onClose();
  };

  const submit = () => {
    setShowIssues(true);
    if (!valid || changedCount === 0) return;
    update.mutate(
      { recordId: record.id, changes, actor: user?.name ?? 'Doctor', reason },
      {
        onSuccess: () => {
          close();
          toast({
            variant: 'success',
            title: `${record.id} updated`,
            description:
              reason.trim() === ''
                ? 'The change is in the record’s edit history.'
                : 'The change and your reason are in the record’s edit history.',
          });
        },
      },
    );
  };

  const set = <K extends keyof RecordEditForm>(field: K, value: RecordEditForm[K]) =>
    setForm((previous) => ({ ...previous, [field]: value }));

  const addable = DIAGNOSES.filter(
    (concept) => !form.diagnoses.some((diagnosis) => diagnosis.code === concept.code),
  );

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Edit draft record"
      description={`${record.id} · ${record.patient.name}. Editable until a note on it is signed; after that, corrections are addenda.`}
      dismissible={!update.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={update.isPending} disabled={changedCount === 0}>
            Save changes
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              type="date"
              label="Visit date"
              required
              value={form.visitDate}
              onChange={(event) => set('visitDate', event.target.value)}
              error={issue('visitDate')}
            />
            <Select
              label="Visit type"
              value={form.visitType}
              onChange={(value) => set('visitType', value)}
              options={RECORD_VISIT_TYPES.map((type) => ({ value: type, label: type }))}
            />
            {/* Read-only: the records service keeps the department it was created with. */}
            <div className="flex flex-col gap-1">
              <span className="text-body-sm font-medium text-text-primary">Department</span>
              <span className="text-body-sm text-text-secondary">
                {record.department === '' ? '—' : record.department}
              </span>
              <span className="text-caption text-text-tertiary">
                Set when the record was created
              </span>
            </div>
          </div>
          <Textarea
            label="Chief complaint"
            required
            rows={2}
            maxLength={RECORD_NARRATIVE_MAX}
            value={form.chiefComplaint}
            onChange={(event) => set('chiefComplaint', event.target.value)}
            error={issue('chiefComplaint')}
          />
          <Textarea
            label="History of present illness"
            required
            rows={4}
            maxLength={RECORD_NARRATIVE_MAX}
            value={form.historyOfPresentIllness}
            onChange={(event) => set('historyOfPresentIllness', event.target.value)}
            error={issue('historyOfPresentIllness')}
          />
          <Textarea
            label="Physical examination"
            required
            rows={4}
            maxLength={RECORD_NARRATIVE_MAX}
            value={form.physicalExamination}
            onChange={(event) => set('physicalExamination', event.target.value)}
            error={issue('physicalExamination')}
          />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-body-sm font-medium text-text-primary">Diagnoses</legend>
            {form.diagnoses.length === 0 ? (
              <p className="text-body-sm text-text-secondary">No diagnoses on this record.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {form.diagnoses.map((diagnosis) => (
                  <li key={diagnosis.code} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-2 text-body-sm">
                      <span className="font-mono" dir="ltr">
                        {diagnosis.code}
                      </span>
                      <span className="text-text-secondary">{diagnosis.label}</span>
                      {diagnosis.isPrimary ? <Badge variant="info">Primary</Badge> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {diagnosis.isPrimary ? null : (
                        <IconButton
                          icon={Star}
                          size="sm"
                          aria-label={`Make ${diagnosis.code} primary`}
                          onClick={() =>
                            set('diagnoses', withPrimaryDiagnosis(form.diagnoses, diagnosis.code))
                          }
                        />
                      )}
                      <IconButton
                        icon={X}
                        size="sm"
                        aria-label={`Remove ${diagnosis.code}`}
                        onClick={() =>
                          set('diagnoses', withDiagnosisRemoved(form.diagnoses, diagnosis.code))
                        }
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {addable.length > 0 ? (
              <Select
                label="Add a diagnosis"
                value={null}
                placeholder="Choose a diagnosis…"
                onChange={(code) => set('diagnoses', withDiagnosisAdded(form.diagnoses, code))}
                options={addable.map((concept) => ({
                  value: concept.code,
                  label: `${concept.code} — ${concept.label}`,
                }))}
              />
            ) : null}
          </fieldset>

          <TreatmentPlanEditor
            steps={form.treatmentPlan}
            issues={showIssues ? issues.treatmentPlan : {}}
            onChange={(steps) => set('treatmentPlan', steps)}
          />

          <div className="flex flex-wrap items-end gap-2">
            <Input
              type="date"
              label="Follow-up date (optional)"
              containerClassName="min-w-0 sm:max-w-xs"
              min={form.visitDate === '' ? undefined : form.visitDate}
              value={form.followUpDate}
              onChange={(event) => set('followUpDate', event.target.value)}
              error={issue('followUpDate')}
            />
            {form.followUpDate === '' ? null : (
              <Button variant="ghost" size="sm" onClick={() => set('followUpDate', '')}>
                Clear follow-up
              </Button>
            )}
          </div>

          <Textarea
            label="Reason for the change (optional)"
            rows={2}
            maxLength={RECORD_EDIT_REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={issue('reason')}
            helperText="Kept with this version in the edit history."
            placeholder="e.g. Corrected the visit date entered at intake."
          />

          {showIssues && valid && changedCount === 0 ? (
            <p className="text-body-sm text-text-secondary">Nothing has changed yet.</p>
          ) : null}
          {update.isError ? (
            <Alert variant="error" title="The record was not updated">
              {failureOf(update.error)}
            </Alert>
          ) : null}
        </Stack>
      </form>
    </Modal>
  );
}
