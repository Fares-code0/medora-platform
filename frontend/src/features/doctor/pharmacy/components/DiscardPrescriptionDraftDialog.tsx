import { ConfirmationDialog } from '@/components/ui';

/**
 * Discard an unsigned server draft (BR-DEC-002, ADR-044).
 *
 * No reason is asked for: the server takes none, and a draft nobody signed
 * dispenses nothing — there is no therapy to explain stopping. The dialog
 * says what the server does: the draft leaves the list and every read, and
 * the row is kept for the audit trail. A signed prescription never reaches
 * this dialog; it is cancelled or discontinued instead (DEC-002).
 */
export interface DiscardPrescriptionDraftDialogProps {
  prescriptionId: string;
  medicationLabel: string;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DiscardPrescriptionDraftDialog({
  prescriptionId,
  medicationLabel,
  loading,
  onConfirm,
  onClose,
}: DiscardPrescriptionDraftDialogProps) {
  return (
    <ConfirmationDialog
      open
      onClose={onClose}
      onConfirm={onConfirm}
      title="Discard this draft?"
      description={`${prescriptionId} · ${medicationLabel}`}
      confirmLabel="Discard draft"
      loading={loading}
    >
      <div className="flex flex-col gap-3 text-body-sm text-text-secondary">
        <p>
          It was never signed and dispenses nothing. Discarding takes it off your prescriptions; it
          cannot be signed afterwards.
        </p>
        <p>It is not erased: the record of the draft and of who discarded it is kept.</p>
      </div>
    </ConfirmationDialog>
  );
}
