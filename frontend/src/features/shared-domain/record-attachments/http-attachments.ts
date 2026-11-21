import { apiClient } from '@/api/client';
import { asRecord, malformedResponse, readArray, readData, readString } from '@/api/http';

import { assertAttachable, type AttachableReport } from './attachability';
import type { LabReportAttachment } from './types';

/**
 * Filing a lab report onto a record over HTTP (FE-10.7) —
 * `POST /lab-orders/{id}/attach-to-record` (API §8.9).
 *
 * The server re-checks what `assessAttachability` checked — the record is
 * this patient's, the identity the doctor confirmed matches — and copies
 * the order's report documents onto the record. It refuses an order with
 * no uploaded report (`No report document`), and that refusal reaches the
 * dialog as the server's words; nothing is filed locally in its place.
 *
 * What it files appears in the record's own `attachments` and the order's,
 * served with each document — so the lists below are empty by design, not
 * by omission: there is no second, client-side register in live mode for
 * the screens to merge with what the server returns.
 */

export async function attachLabReportHttp(
  attachable: AttachableReport,
): Promise<LabReportAttachment> {
  assertAttachable(attachable);
  const { report, target, confirmedBy, confirmedAt } = attachable;
  const data = asRecord(
    readData(
      await apiClient.post(`/lab-orders/${encodeURIComponent(report.labId)}/attach-to-record`, {
        recordId: target.recordId,
        confirmedPatient: { name: target.patientName, mrn: target.patientMrn },
      }),
      'attachment',
    ),
    'attachment',
  );
  const ids = readArray(data, 'attachmentIds', 'attachment').map((id) => {
    if (typeof id !== 'string') throw malformedResponse('attachment.attachmentIds');
    return id;
  });

  return {
    id: ids[0] ?? `${report.labId}-${target.recordId}`,
    recordId: readString(data, 'recordId', 'attachment'),
    labId: readString(data, 'labOrderId', 'attachment'),
    patientId: target.patientId,
    patientName: target.patientName,
    patientMrn: target.patientMrn,
    name: `${report.testName} — ${report.labId}`,
    testName: report.testName,
    resultCount: report.resultCount,
    abnormalCount: report.abnormalCount,
    hasCriticalResult: report.hasCriticalResult,
    attachedAt: confirmedAt,
    attachedBy: confirmedBy,
    note: `Filed on the record by the laboratory service (${String(ids.length)} document${ids.length === 1 ? '' : 's'}).`,
  };
}
