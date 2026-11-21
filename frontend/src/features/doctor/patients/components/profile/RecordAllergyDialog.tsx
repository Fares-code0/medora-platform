import { useState } from 'react';

import { useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Input, Modal, Radio, RadioGroup, Textarea } from '@/components/ui';
import { isApiError } from '@/types/api';

import { useAddAllergyMutation } from '../../api/usePatientProfileQuery';
import { ALLERGEN_MAX, ALLERGY_NOTES_MAX, ALLERGY_REACTION_MAX } from '../../model/profile-service';
import {
  ALLERGY_SEVERITY_META,
  type AllergyRecord,
  type AllergySeverity,
} from '../../model/profile-types';

/**
 * Record an allergy (API §4.6). What is recorded here is what the
 * prescription safety screen screens against — the server's list in a live
 * build, the directory store in the mock — which is why:
 *
 * - **Severity has no default.** Pre-selecting "mild" would put a clinical
 *   judgement on the chart that nobody made.
 * - **The write is pessimistic.** The dialog closes and the row appears only
 *   once the server holds it.
 * - **An allergen already on record is refused**, not merged: the server
 *   answers 409 so the chart can never say "severe" and "mild" about one
 *   substance, and the dialog says that in place of a generic failure.
 *
 * There is no edit or remove — correcting an allergy is its own clinical act.
 */
export interface RecordAllergyDialogProps {
  open: boolean;
  patientId: string;
  patientName: string;
  /** Already on the chart — checked here so the common duplicate never round-trips. */
  existing: readonly AllergyRecord[];
  onClose: () => void;
}

const SEVERITIES: readonly AllergySeverity[] = ['mild', 'moderate', 'severe'];

interface Draft {
  readonly allergen: string;
  readonly severity: AllergySeverity | null;
  readonly reaction: string;
  readonly notes: string;
}

const EMPTY: Draft = { allergen: '', severity: null, reaction: '', notes: '' };

function failureOf(error: unknown): string {
  if (isApiError(error) && error.kind === 'conflict') {
    return error.detail ?? 'That allergen is already recorded for this patient.';
  }
  return error instanceof Error && error.message !== '' ? error.message : 'Please try again.';
}

export function RecordAllergyDialog({
  open,
  patientId,
  patientName,
  existing,
  onClose,
}: RecordAllergyDialogProps) {
  const { toast } = useToast();
  const add = useAddAllergyMutation(patientId);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [showIssues, setShowIssues] = useState(false);

  const allergen = draft.allergen.trim();
  const duplicate = existing.some(
    (allergy) => allergy.allergen.trim().toLowerCase() === allergen.toLowerCase(),
  );
  const issues = {
    allergen:
      allergen === ''
        ? 'Name the allergen'
        : duplicate
          ? `${allergen} is already on this chart`
          : undefined,
    severity: draft.severity === null ? 'Choose a severity' : undefined,
    reaction: draft.reaction.trim() === '' ? 'Describe the reaction' : undefined,
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
    if (!valid || draft.severity === null) return;
    add.mutate(
      {
        allergen,
        severity: draft.severity,
        reaction: draft.reaction.trim(),
        notes: draft.notes.trim(),
      },
      {
        onSuccess: (record) => {
          close();
          toast({
            variant: 'success',
            title: `${record.allergen} recorded`,
            description: 'It is now part of the prescription safety screen.',
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
      title="Record an allergy"
      description={`For ${patientName}. Recorded allergies are screened against every new prescription.`}
      dismissible={!add.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={add.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={add.isPending}>
            Record allergy
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
          <Input
            label="Allergen"
            required
            maxLength={ALLERGEN_MAX}
            value={draft.allergen}
            onChange={(event) => setDraft({ ...draft, allergen: event.target.value })}
            error={issue('allergen')}
            placeholder="e.g. Penicillin"
          />
          <RadioGroup
            label="Severity"
            name="allergy-severity"
            required
            orientation="horizontal"
            value={draft.severity}
            onChange={(value) => setDraft({ ...draft, severity: value as AllergySeverity })}
            error={issue('severity')}
          >
            {SEVERITIES.map((severity) => (
              <Radio
                key={severity}
                value={severity}
                label={ALLERGY_SEVERITY_META[severity].label}
              />
            ))}
          </RadioGroup>
          <Input
            label="Reaction"
            required
            maxLength={ALLERGY_REACTION_MAX}
            value={draft.reaction}
            onChange={(event) => setDraft({ ...draft, reaction: event.target.value })}
            error={issue('reaction')}
            placeholder="e.g. Hives, angioedema"
          />
          <Textarea
            label="Notes (optional)"
            rows={2}
            maxLength={ALLERGY_NOTES_MAX}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
          {add.isError ? (
            <Alert variant="error" title="The allergy was not recorded">
              {failureOf(add.error)}
            </Alert>
          ) : null}
        </Stack>
      </form>
    </Modal>
  );
}
