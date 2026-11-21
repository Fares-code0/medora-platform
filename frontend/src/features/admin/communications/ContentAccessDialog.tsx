import { useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Alert } from '@/components/feedback';
import { Button, Modal, Radio, RadioGroup, Textarea } from '@/components/ui';
import { routes } from '@/routes';

import { CONTENT_ACCESS_CATEGORIES, validateAccessReason } from './communications';
import type { ContentAccessCategory } from './communications.types';
import { useContentAccess } from './ContentAccessProvider';

/**
 * The per-conversation justification prompt (ADM-06B · Task 9 · UX §3.6).
 *
 * A closed category plus a written reason, same order as the PHI gate's
 * prompt and for the same reason: the category is what makes the log
 * reviewable in aggregate, the sentence is what makes a single entry
 * defensible. Unlike PHI's dialog, no category is pre-selected — reading an
 * entire private thread is not a default action, so Submit stays disabled
 * until the administrator picks one.
 *
 * The attribution notice sits above the reason field, not below the
 * button: a warning shown after the decision is decoration.
 *
 * `validateAccessReason` runs here first, for the administrator's benefit —
 * so the problem shows up before a submit round-trips. `request` (via
 * `useContentAccess`) calls the service, which re-validates the same reason
 * at the actual boundary; this dialog never removes or works around that
 * second check, it only surfaces whatever it rejects.
 *
 * **On a successful grant, this dialog navigates into the viewer.** UX §3.6
 * says the conversation "opens read-only" once access is granted, and this
 * is the seam where that has to happen: `request`'s promise only resolves
 * once the grant already exists in provider state (see
 * `ContentAccessProvider`'s own doc comment), so navigating in that
 * `.then()` — never before it, never in a `catch` — is what guarantees the
 * viewer's `isLiveFor` check finds a live grant the instant it mounts. This
 * dialog is the seam rather than `ConversationLogsTab`: it already owns the
 * only place `request`'s resolution is observed, so navigating here needs
 * no extra callback threaded back through `onClose`.
 */
export function ContentAccessDialog({
  open,
  conversationId,
  onClose,
}: {
  open: boolean;
  conversationId: string | null;
  onClose: () => void;
}) {
  const { request } = useContentAccess();
  const navigate = useNavigate();

  const [category, setCategory] = useState<ContentAccessCategory | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // A fresh prompt every time: a reason typed for one conversation must
  // never carry over to the next one.
  useEffect(() => {
    if (open) {
      setCategory(null);
      setReason('');
      setReasonError(undefined);
      setSubmitError(null);
    }
  }, [open]);

  const submit = () => {
    if (category === null || conversationId === null) return;
    // Captured into a local so the `.then()` below closes over a value
    // narrowed to `string`, not the nullable prop — a rebind rather than a
    // reliance on control-flow narrowing surviving into the closure.
    const targetConversationId = conversationId;

    const check = validateAccessReason(reason);
    if (!check.ok) {
      setReasonError(check.message);
      return;
    }
    setReasonError(undefined);
    setSubmitError(null);
    setSubmitting(true);

    request({ conversationId: targetConversationId, category, reason }).then(
      () => {
        setSubmitting(false);
        onClose();
        // Only reached once the grant already exists (see the doc comment
        // above) — a rejected `request` falls into the error branch below
        // and never navigates.
        navigate(routes.admin.conversation(targetConversationId));
      },
      (error: unknown) => {
        setSubmitting(false);
        setSubmitError(
          error instanceof Error ? error.message : 'The access could not be logged. Try again.',
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
      title="Justify content access"
      description="Reading full message content for this conversation."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting} disabled={category === null}>
            Open conversation
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
          <Alert variant="error" title="Nothing was opened">
            {submitError}
          </Alert>
        ) : null}

        <p className="text-body-sm text-text-secondary">
          This access is recorded against your name and is visible to whoever audits it.
        </p>

        <RadioGroup
          name="content-access-category"
          label="Reason category"
          value={category}
          onChange={(next) => setCategory(next as ContentAccessCategory)}
          required
        >
          {CONTENT_ACCESS_CATEGORIES.map((entry) => (
            <Radio
              key={entry.id}
              value={entry.id}
              label={entry.label}
              description={entry.description}
            />
          ))}
        </RadioGroup>

        <Textarea
          label="Reason"
          placeholder="e.g. Reviewing this thread for the complaint filed on ticket A-104."
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={reasonError}
        />
      </form>
    </Modal>
  );
}
