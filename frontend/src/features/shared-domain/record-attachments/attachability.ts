import type { AttachmentTarget, LabReportRef } from './types';

/**
 * The identity check in front of an attachment (D-14, UX §2.6).
 *
 * UX §2.6 asks for "attach report to patient record (confirmation with
 * patient-identity check)". A confirmation dialog satisfies that on paper and
 * not in fact: a dialog is a thing you can dismiss with Enter, and the failure
 * it guards against — a result filed onto the wrong patient's chart — is one
 * of the few in this app that cannot be undone by looking at it again.
 *
 * So the check is structural, the same way the pharmacy's signature is
 * (`model/safety-check.ts`): `assessAttachability` is the only producer of
 * `AttachableReport`, that type carries a module-private symbol, and
 * `attachLabReport` demands one. A mismatched patient, an unconfirmed
 * identity, an order with no released results, and a report already on this
 * record all reach the same place — there is no value to hand to the store,
 * and none can be forged: not in TypeScript, because the symbol cannot be
 * named outside this module, and not at runtime, because `assertAttachable`
 * compares against it.
 *
 * The two identity fields are compared independently. A patient id match with
 * a differing MRN is not a near miss to be waved through — it means one of the
 * two records is wrong about who this is, which is precisely when a human
 * should stop.
 */

const ATTACHABLE: unique symbol = Symbol('medora.records.attachable');

export interface AttachableReport {
  readonly [ATTACHABLE]: true;
  readonly report: LabReportRef;
  readonly target: AttachmentTarget;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
}

export type AttachBlockedReason =
  | 'no-target'
  | 'no-results'
  | 'patient-mismatch'
  | 'unconfirmed'
  | 'already-attached';

export const ATTACH_BLOCKED_META: Record<AttachBlockedReason, string> = {
  'no-target': 'Choose the encounter this report belongs to.',
  'no-results': 'This order has no released results, so there is nothing to attach.',
  'patient-mismatch':
    'The chosen record belongs to a different patient than this result. Attaching is refused.',
  unconfirmed: 'Confirm the patient identity before attaching.',
  'already-attached': 'This report is already attached to that record.',
};

export interface AttachabilityInput {
  readonly report: LabReportRef;
  /** The patient the LAB result belongs to. */
  readonly reportPatient: { readonly patientId: string; readonly patientMrn: string };
  readonly target: AttachmentTarget | null;
  /**
   * The identity the user positively confirmed, echoed back from the dialog.
   * A boolean "confirmed" flag would stay true while the selected record
   * changed underneath it; carrying the confirmed identity means changing the
   * target invalidates the confirmation by itself.
   */
  readonly confirmed: { readonly patientId: string; readonly patientMrn: string } | null;
  readonly confirmedBy: string;
  /** Attachments already on the target record, to refuse a duplicate. */
  readonly existingLabIds: readonly string[];
  readonly now?: () => Date;
}

export type AttachabilityResult =
  | { readonly attachable: AttachableReport; readonly blockedBy: null }
  | { readonly attachable: null; readonly blockedBy: AttachBlockedReason };

/** The only producer of `AttachableReport`. */
export function assessAttachability(input: AttachabilityInput): AttachabilityResult {
  const { report, reportPatient, target, confirmed, confirmedBy, existingLabIds } = input;
  const now = input.now ?? (() => new Date());

  if (report.resultCount === 0) return { attachable: null, blockedBy: 'no-results' };
  if (target === null) return { attachable: null, blockedBy: 'no-target' };

  if (target.patientId !== reportPatient.patientId || target.patientMrn !== reportPatient.patientMrn) {
    return { attachable: null, blockedBy: 'patient-mismatch' };
  }
  if (existingLabIds.includes(report.labId)) {
    return { attachable: null, blockedBy: 'already-attached' };
  }
  if (
    confirmed === null ||
    confirmed.patientId !== target.patientId ||
    confirmed.patientMrn !== target.patientMrn
  ) {
    return { attachable: null, blockedBy: 'unconfirmed' };
  }

  return {
    attachable: {
      [ATTACHABLE]: true,
      report,
      target,
      confirmedBy,
      confirmedAt: now().toISOString(),
    },
    blockedBy: null,
  };
}

export class NotAttachableError extends Error {
  constructor() {
    super('Refusing to attach: the value did not come from a confirmed identity check.');
    this.name = 'NotAttachableError';
  }
}

/** The runtime half of the guarantee — a cast does not survive this. */
export function assertAttachable(value: AttachableReport): void {
  const candidate = value as unknown as Record<symbol, unknown> | null;
  if (typeof candidate !== 'object' || candidate === null || candidate[ATTACHABLE] !== true) {
    throw new NotAttachableError();
  }
}
