import { useCallback, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { useDoctorProfile, useToast } from '@/app/providers';
import { routes } from '@/routes';

import {
  useDiscardPrescriptionDraftMutation,
  useEndPrescriptionMutation,
  useRenewPrescriptionMutation,
} from '../api/usePrescriptionMutations';
import { prescriptionKeys } from '../api/usePrescriptionsQuery';
import { PRESCRIPTION_NOT_DRAFT, PRESCRIPTION_NOT_FOUND } from '../model/prescription-service';
import { endActFor, isDiscardableDraft, type EndAct } from '../model/selectors';
import type { PrescriptionSummary } from '../model/types';

/**
 * The D-19 lifecycle actions, in one place so the row menu and the detail
 * page cannot drift apart: renew (opens the authoring flow pre-filled) and
 * end with a reason — cancel or discontinue, chosen by the status (DEC-002) —
 * pessimistic: the status changes only once the server has ended it, and a
 * refusal keeps the dialog open over an unchanged prescription.
 *
 * An unsigned draft has no therapy to end: `openEnd` opens the discard
 * confirmation for it instead (BR-DEC-002), equally pessimistic.
 *
 * Sign & send and save-as-draft are deliberately *not* here — they belong to
 * the authoring flow, where the safety verdict that gates them lives.
 */

/** What a refused discard means, in the doctor's words. */
function discardFailure(error: unknown): string {
  if (error instanceof Error && error.message === PRESCRIPTION_NOT_DRAFT) {
    return 'It is no longer an unsigned draft — it may have been signed. A signed prescription is cancelled or discontinued instead.';
  }
  if (error instanceof Error && error.message === PRESCRIPTION_NOT_FOUND) {
    return 'It was not found. It may already have been discarded.';
  }
  return 'It is unchanged. Please try again.';
}

export function usePrescriptionLifecycle(options: { onDiscarded?: () => void } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { profile } = useDoctorProfile();
  const { onDiscarded } = options;

  const renew = useRenewPrescriptionMutation();
  const end = useEndPrescriptionMutation();
  const discard = useDiscardPrescriptionDraftMutation();

  const [discarding, setDiscarding] = useState<PrescriptionSummary | null>(null);

  const [ending, setEnding] = useState<{
    readonly prescription: PrescriptionSummary;
    readonly act: EndAct;
  } | null>(null);

  /**
   * Opens the dialog for the act the status allows — the end dialog, or the
   * discard confirmation for an unsigned draft; does nothing for none.
   */
  const openEnd = useCallback((prescription: PrescriptionSummary) => {
    const act = endActFor(prescription);
    if (act !== null) setEnding({ prescription, act });
    else if (isDiscardableDraft(prescription)) setDiscarding(prescription);
  }, []);

  const onRenew = useCallback(
    (prescription: PrescriptionSummary) => {
      renew.mutate(prescription.id, {
        onSuccess: (draft) => {
          toast({
            variant: 'info',
            title: `Renewing ${prescription.id}`,
            description:
              'A draft was pre-filled from it. The safety screen runs again before you can sign.',
          });
          navigate(routes.doctor.newPrescription({ draftId: draft.id }));
        },
        onError: () =>
          toast({
            variant: 'error',
            title: 'Could not start the renewal',
            description: 'Please try again.',
          }),
      });
    },
    [renew, toast, navigate],
  );

  const onConfirmEnd = useCallback(
    (reason: string, details: string) => {
      if (ending === null) return;
      const { prescription, act } = ending;
      const done = act === 'cancel' ? 'cancelled' : 'discontinued';
      end.mutate(
        {
          act,
          prescriptionId: prescription.id,
          reason,
          details,
          actor: profile.fullName || 'Doctor',
        },
        {
          onSuccess: () => {
            toast({
              variant: 'success',
              title: `${prescription.id} ${done}`,
              description: `${prescription.medication.name} — ${reason}.`,
            });
            setEnding(null);
          },
          onError: () =>
            toast({
              variant: 'error',
              title: `Could not ${act} the prescription`,
              description: 'It is unchanged. Please try again.',
            }),
        },
      );
    },
    [end, ending, profile.fullName, toast],
  );

  const onConfirmDiscard = useCallback(() => {
    if (discarding === null) return;
    const prescription = discarding;
    discard.mutate(prescription.id, {
      onSuccess: () => {
        toast({
          variant: 'success',
          title: `${prescription.id} discarded`,
          description: `The unsigned draft for ${prescription.medication.name} is off your list.`,
        });
        setDiscarding(null);
        onDiscarded?.();
        // After the page that showed it has moved on: its detail is a 404 now.
        queryClient.removeQueries({
          queryKey: prescriptionKeys.detail(prescription.id),
          exact: true,
        });
      },
      onError: (error) =>
        toast({
          variant: 'error',
          title: 'Could not discard the draft',
          description: discardFailure(error),
        }),
    });
  }, [discard, discarding, onDiscarded, queryClient, toast]);

  return {
    discarding,
    discardPending: discard.isPending,
    closeDiscard: useCallback(() => setDiscarding(null), []),
    onConfirmDiscard,
    renewPending: renew.isPending,
    endPending: end.isPending,
    ending,
    onRenew,
    openEnd,
    closeEnd: useCallback(() => setEnding(null), []),
    onConfirmEnd,
  };
}
