/**
 * The time-off port (FE-10.4) — UX §2.4's "Block time off" and its
 * emergency-unavailability mode, against API §3.9 and §5.9.
 *
 * Two phases, as the backend has them, and the split is a safety property:
 *
 * 1. `createBlock` books the time off and returns what it would disturb —
 *    a **preview**. Nothing is moved (ADR-005 RA-005.2).
 * 2. `resolve` acts on that impact in bulk, and only after the doctor has
 *    seen the blast radius. It sends the number of appointments the doctor
 *    was shown; if the server's count has changed since, it refuses (409
 *    `blast_radius_changed`) and nothing is sent, so a confirmation screen
 *    rendered minutes ago cannot act on a list that has since grown.
 */

export type TimeOffKind = 'vacation' | 'emergency-block';

export type ResolutionAction = 'reschedule-proposal' | 'handover' | 'cancel-apology';

export const RESOLUTION_LABELS: Readonly<
  Record<ResolutionAction, { readonly label: string; readonly description: string }>
> = {
  'reschedule-proposal': {
    label: 'Ask patients to pick a new time',
    description:
      'Each patient is told the slot is gone and asked to choose again. Applies to requests still awaiting your decision; booked appointments are reported as skipped.',
  },
  handover: {
    label: 'Offer a colleague handover',
    description:
      'Patients and the clinic are notified; the appointments stay as they are until an administrator reassigns them.',
  },
  'cancel-apology': {
    label: 'Cancel with an apology',
    description: 'Each appointment is cancelled and the patient is sent the reason.',
  },
};

export interface ImpactedAppointment {
  readonly id: string;
  readonly scheduledAt: string;
  readonly durationMin: number;
  readonly status: string;
  /** The patient's `PT-…` handle — the API sends no name here. */
  readonly patientId: string;
}

export interface TimeOffBlock {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly kind: TimeOffKind;
}

export interface TimeOffCreated {
  readonly block: TimeOffBlock;
  readonly impacted: readonly ImpactedAppointment[];
}

export interface ResolutionOutcome {
  /** Appointment ids that were acted on. */
  readonly resolved: readonly string[];
  /** Appointment ids left alone, each with the server's reason. */
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
  /** How many notifications were queued. */
  readonly notified: number;
}

export interface TimeOffService {
  createBlock(input: {
    readonly from: string;
    readonly to: string;
    readonly kind: TimeOffKind;
  }): Promise<TimeOffCreated>;
  resolve(
    blockId: string,
    input: {
      readonly action: ResolutionAction;
      /** How many impacted appointments the doctor was shown. */
      readonly confirmedCount: number;
      readonly reason?: string;
    },
  ): Promise<ResolutionOutcome>;
  /** The doctor's own blocks that have not finished yet, soonest first. */
  listBlocks(): Promise<readonly TimeOffBlock[]>;
  /**
   * The appointments an **existing** block disturbs now, by the same rule
   * `resolve` counts them with — what a follow-up interrupted after
   * `createBlock` (the page was left, the tab reloaded) re-reads, since the
   * API returns the impact list only with the create. It is a read: nothing
   * is booked or moved. `resolve` still checks the count it is sent against
   * its own, so a list that has changed since is refused, never acted on.
   */
  previewImpact(block: TimeOffBlock): Promise<readonly ImpactedAppointment[]>;
  /**
   * Cancels one of the doctor's own blocks, freeing the time for bookings.
   * Appointments a resolution already acted on stay as they were — removing
   * the block does not undo a cancellation the patient has been sent.
   */
  removeBlock(blockId: string): Promise<void>;
}
