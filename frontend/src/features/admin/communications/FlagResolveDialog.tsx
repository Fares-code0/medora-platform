import { useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Button, Modal, Radio, RadioGroup, Textarea } from '@/components/ui';
import { SEED_CONTACTS } from '@/features/shared-domain/conversations';
import { routes } from '@/routes';

import { maskExcerpt } from './communications';
import { useResolveFlagMutation } from './communications.queries';
import type { FlagResolution, SafetyFlag } from './communications.types';

/**
 * The flag-resolution prompt (ADM-06B Task 11 · UX §3.6).
 *
 * A radio group over the three resolutions plus a required note. Submit
 * stays disabled until a resolution is chosen and the note is non-empty
 * after trimming.
 *
 * **Awaits the write; closes only on success** — the same shape as
 * `ContentAccessDialog`'s `submit`, and for the same reason: a reviewer can
 * work through several flags in a row, and only closing once `resolveFlag`
 * has actually landed means `document.flags` already reflects the decision
 * by the time this dialog is gone, so `SafetyFlagsTab` never needs a
 * local, optimistic view of its own to stay in sync. `resolveFlag`
 * re-validates the note at the actual boundary; the disabled button keeps
 * that path closed in the normal flow, and `submitError` below surfaces
 * whatever it rejects instead.
 *
 * **This dialog never suspends anyone.** "Escalate for suspension" resolves
 * the flag like any other resolution, then navigates to the flagged
 * account's own page — `/admin/doctors/:id` or `/admin/patients/:id` — with
 * `?flagRef=<flag.id>`. ADM-02/03/04 already ship that page's suspension
 * flow, with its own reason capture and audit write; this dialog does not
 * re-implement it. A second implementation of suspension policy here would
 * be a hardening fix that reaches one copy and misses the other.
 *
 * **Resolving the escalation target.** `SafetyFlag` carries `authorLabel`
 * (a display name — "Dr. Amira Hassan", "Patient") but no `authorId`: §3.6's
 * minimum-necessary-context rule applies to who flagged a message the same
 * way it applies to what they wrote, so the type was never given one. This
 * is the one place that walks the label back to a contact, via
 * `SEED_CONTACTS`, to learn both the role (doctor vs. patient) and the id
 * the destination route needs. A label with no matching contact — the
 * signed-in doctor's own "You" — escalates nowhere rather than guessing.
 */
export function FlagResolveDialog({
  open,
  flag,
  onClose,
}: {
  open: boolean;
  flag: SafetyFlag | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const resolveFlag = useResolveFlagMutation();

  const [resolution, setResolution] = useState<FlagResolution | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // A fresh prompt every time, the same rule `ContentAccessDialog` states
  // for its own reason field: a note typed against one flag must never end
  // up attached to another.
  useEffect(() => {
    if (open) {
      setResolution(null);
      setNote('');
      setSubmitError(null);
    }
  }, [open]);

  const submit = () => {
    if (flag === null || resolution === null) return;

    const trimmedNote = note.trim();
    if (trimmedNote === '') return;

    setSubmitError(null);
    setSubmitting(true);

    resolveFlag
      .mutateAsync({ flagId: flag.id, resolution, note, decidedBy: user?.name ?? 'Administrator' })
      .then(
        () => {
          setSubmitting(false);
          onClose();
          if (resolution === 'escalated') {
            const target = escalationTargetFor(flag);
            if (target !== null) {
              navigate(`${target}?flagRef=${encodeURIComponent(flag.id)}`);
            }
          }
        },
        (error: unknown) => {
          setSubmitting(false);
          setSubmitError(
            error instanceof Error ? error.message : 'The flag could not be resolved. Try again.',
          );
        },
      );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      role="alertdialog"
      dismissible={false}
      title="Resolve safety flag"
      description="This decision, and the note below, become part of the flag's permanent record."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={submitting}
            disabled={resolution === null || note.trim() === ''}
          >
            Record decision
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {submitError ? (
          <Alert variant="error" title="Nothing was recorded">
            {submitError}
          </Alert>
        ) : null}

        {flag !== null ? (
          <blockquote className="border-s-2 border-border-strong ps-3 text-body-sm text-text-secondary">
            {/* Masked, not verbatim (§6.4) — the same transform the queue
                card already goes through. `resolveFlags` is only ever
                seeded bundled with `viewContent`, but `roles.manage` can
                grant one without the other, and this dialog must not be
                the leak that reopens when it does. */}
            &ldquo;{maskExcerpt(flag.excerpt)}&rdquo;
          </blockquote>
        ) : null}

        <RadioGroup
          name="flag-resolution"
          label="Resolution"
          value={resolution}
          onChange={(next) => setResolution(next as FlagResolution)}
          required
        >
          <Radio value="dismissed" label="Dismiss" description="Reviewed — no action needed." />
          <Radio
            value="warned"
            label="Warn the participant"
            description="Logs that a warning was issued outside this system."
          />
          <Radio
            value="escalated"
            label="Escalate for suspension"
            description="Opens the account's own suspension flow — this dialog does not suspend anyone."
          />
        </RadioGroup>

        <Textarea
          label="Note"
          placeholder="What did you find, and what did you decide?"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </form>
    </Modal>
  );
}

function escalationTargetFor(flag: SafetyFlag): string | null {
  const contact = SEED_CONTACTS.find((candidate) => candidate.name === flag.authorLabel);
  if (contact === undefined) return null;
  return contact.role === 'patient'
    ? routes.admin.patient(contact.id)
    : routes.admin.doctor(contact.id);
}
