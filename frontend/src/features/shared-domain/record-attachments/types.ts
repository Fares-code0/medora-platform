/**
 * Lab report → medical record attachments (D-14).
 *
 * **Why this lives in `shared-domain` and not in either feature.** The labs
 * module performs the attachment and the medical-records module renders the
 * result; §3.4 forbids one reaching into the other, and a model both need is
 * exactly what §3.3 defines this layer for. The alternative — labs keeping
 * its own "attached" list — would let the Labs screen claim an attachment the
 * record does not carry, which is the false-success this feature exists to
 * avoid.
 *
 * Nothing here is transmitted anywhere. The store is session-lifetime, and
 * the attachment's own note says so, so the UI reads the wording from the
 * data rather than inventing a "filed to the chart" claim of its own.
 */

/** The lab side of an attachment, as the attaching feature knows it. */
export interface LabReportRef {
  readonly labId: string;
  readonly testName: string;
  readonly testCode: string;
  readonly collectedAt: string | null;
  readonly completedAt: string | null;
  /** Released analytes; an order with none has nothing to attach. */
  readonly resultCount: number;
  readonly abnormalCount: number;
  readonly hasCriticalResult: boolean;
}

/**
 * The identity the attachment is checked against. Both features carry these
 * three fields on their own patient snapshot, so neither has to import the
 * other's model to speak this language.
 */
export interface AttachmentIdentity {
  readonly patientId: string;
  readonly patientName: string;
  readonly patientMrn: string;
}

/** The medical record an attachment targets, reduced to what the check needs. */
export interface AttachmentTarget extends AttachmentIdentity {
  readonly recordId: string;
  readonly label: string;
  readonly visitDate: string;
}

/** One stored attachment. Append-only: nothing detaches in this model. */
export interface LabReportAttachment extends AttachmentIdentity {
  readonly id: string;
  readonly recordId: string;
  readonly labId: string;
  readonly name: string;
  readonly testName: string;
  readonly resultCount: number;
  readonly abnormalCount: number;
  readonly hasCriticalResult: boolean;
  readonly attachedAt: string;
  readonly attachedBy: string;
  /** States, in words, that nothing left the browser. Rendered verbatim. */
  readonly note: string;
}
