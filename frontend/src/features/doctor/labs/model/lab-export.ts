import { formatDateTime } from '@/i18n';
import type { ExportDataset } from '@/utils/export';

import type { LabAttachment, LabTest } from './types';

/**
 * Per-test export datasets — feed the shared export engine (print / PDF)
 * from the lab quick actions and row menus, so every document action on a
 * lab order produces a real file of that order's released results.
 */

export function labReportDataset(test: LabTest): ExportDataset {
  return {
    filename: `medora-lab-${test.id.toLowerCase()}`,
    title: `${test.testName} (${test.testCode}) — ${test.patient.name}`,
    columns: ['Analyte', 'Value', 'Unit', 'Reference range', 'Flag'],
    rows: test.results.map((result) => [
      result.analyte,
      result.value,
      result.unit,
      result.referenceRange.text,
      result.flag,
    ]),
  };
}

export function labAttachmentDataset(test: LabTest, attachment: LabAttachment): ExportDataset {
  return {
    filename: attachment.name.replace(/\.[^.]+$/, ''),
    title: `${attachment.name} — ${test.testName}, ${test.patient.name}`,
    columns: ['Field', 'Value'],
    rows: [
      ['Attachment', attachment.name],
      ['Kind', attachment.kind],
      ['Size', `${String(attachment.sizeKb)} KB`],
      ['Uploaded by', attachment.uploadedBy],
      ['Uploaded', formatDateTime(attachment.uploadedAt)],
      ['Lab order', `${test.id} · ${test.testName}`],
      ['Patient', test.patient.name],
    ],
  };
}
