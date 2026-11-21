import { useCallback, useState } from 'react';

import { NETWORK_WRITE_OUTCOME_UNKNOWN } from '@/api/errors';
import { useDoctorProfile, useToast } from '@/app/providers';
import { isApiError } from '@/types/api';

import {
  useAmendRecordMutation,
  useSetRecordStatusMutation,
  useSignNoteMutation,
} from '../api/useRecordMutations';
import type { SignableNote } from '../model/record-lifecycle';
import type { MedicalRecord, MedicalRecordStatus, RecordClinicalNote } from '../model/types';

/**
 * The D-21 lifecycle actions in one place, so the record page and any future
 * entry point cannot drift apart — the shape `usePrescriptionLifecycle` and
 * `useLabReviewActions` established.
 *
 * **Failure keeps the dialog open and says why.** Each of these is a claim
 * about a clinical record, so none closes on error and none shows a success
 * toast the write did not earn. The message is handed back to the dialog as
 * well as toasted, because a toast is gone in seconds and the doctor is still
 * looking at the thing that did not happen.
 */
/**
 * The reason a write was refused, in words a doctor can act on: the server's
 * own explanation for a conflict (a transition off the map, a note signed
 * meanwhile), and a plain sentence for the rest — never "API error: …".
 */
function failureMessage(error: Error): string {
  if (!isApiError(error)) return error.message;
  switch (error.kind) {
    case 'conflict':
      // Server details are phrases; the dialogs follow them with a sentence.
      return /[.!?]$/.test(error.detail) ? error.detail : `${error.detail}.`;
    case 'forbidden':
      return 'You are not allowed to make this change to this record.';
    case 'not_found':
      return 'This record is no longer available to you.';
    case 'validation':
      return (
        Object.values(error.fieldErrors)[0]?.[0] ?? 'Some of what was entered was not accepted.'
      );
    case 'network':
      return NETWORK_WRITE_OUTCOME_UNKNOWN;
    default:
      return 'The server did not accept this. Nothing was changed.';
  }
}

/**
 * Whether the client knows the write did not happen. It does whenever the
 * server answered; after a `network` failure — the request may have been
 * applied before the connection dropped or the client timed out — it does
 * not, and saying "unchanged" would invite the doctor to sign or amend twice.
 */
function outcomeKnown(error: Error): boolean {
  return !(isApiError(error) && error.kind === 'network');
}

/** The refusal, followed by `unchanged` only when that is known to be true. */
function refusalWithOutcome(error: Error, unchanged: string): string {
  const message = failureMessage(error);
  return outcomeKnown(error) ? `${message} ${unchanged}` : message;
}

export function useRecordLifecycleActions() {
  const { toast } = useToast();
  const { profile } = useDoctorProfile();
  const clinician = profile.fullName || 'Doctor';

  const signNote = useSignNoteMutation();
  const amendRecord = useAmendRecordMutation();
  const setStatus = useSetRecordStatusMutation();

  const [signing, setSigning] = useState<RecordClinicalNote | null>(null);
  const [amending, setAmending] = useState<MedicalRecord | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [amendError, setAmendError] = useState<string | null>(null);

  const openSign = useCallback((note: RecordClinicalNote) => {
    setSignError(null);
    setSigning(note);
  }, []);

  const openAmend = useCallback((record: MedicalRecord) => {
    setAmendError(null);
    setAmending(record);
  }, []);

  const confirmSign = useCallback(
    (signable: SignableNote) => {
      signNote.mutate(signable, {
        onSuccess: (updated) => {
          toast({
            variant: 'success',
            title: 'Note signed',
            description: `Recorded against ${clinician} on ${updated.id}. It can no longer be edited — corrections are addenda.`,
          });
          setSigning(null);
          setSignError(null);
        },
        onError: (error) => {
          setSignError(refusalWithOutcome(error, 'It is unchanged and still unsigned.'));
          toast({
            variant: 'error',
            title: 'Could not sign the note',
            description: outcomeKnown(error)
              ? 'It is unchanged and still unsigned.'
              : 'Check the note before signing again.',
          });
        },
      });
    },
    [signNote, clinician, toast],
  );

  const confirmAmend = useCallback(
    (title: string, body: string) => {
      const record = amending;
      if (record === null) return;
      amendRecord.mutate(
        { recordId: record.id, title, body, author: clinician },
        {
          onSuccess: () => {
            toast({
              variant: 'success',
              title: 'Addendum added',
              description:
                'It stands beside the signed note rather than replacing it, and is unsigned until you sign it.',
            });
            setAmending(null);
            setAmendError(null);
          },
          onError: (error) => {
            setAmendError(refusalWithOutcome(error, 'The record is unchanged.'));
            toast({
              variant: 'error',
              title: 'Could not add the addendum',
              description: outcomeKnown(error)
                ? 'The record is unchanged.'
                : 'Check the record before adding it again.',
            });
          },
        },
      );
    },
    [amendRecord, amending, clinician, toast],
  );

  const changeStatus = useCallback(
    (record: MedicalRecord, status: MedicalRecordStatus) => {
      setStatus.mutate(
        { recordId: record.id, status, actor: clinician },
        {
          onSuccess: (updated) =>
            toast({
              variant: 'success',
              title: `${updated.id} is now ${status}`,
            }),
          onError: (error) =>
            toast({
              variant: 'error',
              title: 'Could not change the status',
              description: refusalWithOutcome(error, 'The record is unchanged.'),
            }),
        },
      );
    },
    [setStatus, clinician, toast],
  );

  return {
    clinician,
    signing,
    amending,
    signError,
    amendError,
    signSubmitting: signNote.isPending,
    amendSubmitting: amendRecord.isPending,
    statusSubmitting: setStatus.isPending,
    openSign,
    openAmend,
    closeSign: useCallback(() => {
      if (!signNote.isPending) setSigning(null);
    }, [signNote.isPending]),
    closeAmend: useCallback(() => {
      if (!amendRecord.isPending) setAmending(null);
    }, [amendRecord.isPending]),
    confirmSign,
    confirmAmend,
    changeStatus,
  } as const;
}
