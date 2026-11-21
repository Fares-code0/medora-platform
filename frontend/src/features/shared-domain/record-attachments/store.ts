import { assertAttachable, type AttachableReport } from './attachability';
import type { LabReportAttachment } from './types';

/**
 * The attachment store — session-lifetime and in memory, deliberately not in
 * `localStorage`: `services/preferences.ts` is the app's only sanctioned
 * storage boundary and it is for UI preferences, "never PHI". An attachment
 * names a patient, so it stays in memory and dies with the tab.
 *
 * Append-only. Nothing in UX §2.6 detaches a report, and a delete path would
 * be the one way this store could quietly lose a record of who filed what.
 */

const ATTACHMENT_LATENCY_MS = 400;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const attachments = new Map<string, LabReportAttachment>();

let sequence = 0;

/** Test-only reset, so suites do not leak attachments into each other. */
export function __resetRecordAttachments(): void {
  attachments.clear();
  sequence = 0;
}

export function listAttachmentsForRecord(recordId: string): readonly LabReportAttachment[] {
  return Array.from(attachments.values())
    .filter((attachment) => attachment.recordId === recordId)
    .sort((a, b) => a.attachedAt.localeCompare(b.attachedAt));
}

export function listAttachmentsForLab(labId: string): readonly LabReportAttachment[] {
  return Array.from(attachments.values())
    .filter((attachment) => attachment.labId === labId)
    .sort((a, b) => a.attachedAt.localeCompare(b.attachedAt));
}

/**
 * Files a report against a record. Takes `AttachableReport`, whose only
 * producer is `assessAttachability` — so no caller reaches this without a
 * confirmed identity — and re-checks the private symbol at runtime.
 */
export async function attachLabReport(
  attachable: AttachableReport,
): Promise<LabReportAttachment> {
  assertAttachable(attachable);
  await delay(ATTACHMENT_LATENCY_MS);

  const { report, target, confirmedBy, confirmedAt } = attachable;
  sequence += 1;
  const id = `ATT-${String(sequence).padStart(4, '0')}-${report.labId}`;

  const attachment: LabReportAttachment = {
    id,
    recordId: target.recordId,
    labId: report.labId,
    patientId: target.patientId,
    patientName: target.patientName,
    patientMrn: target.patientMrn,
    name: `${report.testName} — ${report.labId}.pdf`,
    testName: report.testName,
    resultCount: report.resultCount,
    abnormalCount: report.abnormalCount,
    hasCriticalResult: report.hasCriticalResult,
    attachedAt: confirmedAt,
    attachedBy: confirmedBy,
    note: 'Linked in this demo session. No document service is connected, so nothing was uploaded or transmitted.',
  };

  attachments.set(id, attachment);
  return attachment;
}
