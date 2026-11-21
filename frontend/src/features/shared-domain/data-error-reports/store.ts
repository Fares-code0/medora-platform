import type { DataErrorField, DataErrorReport } from './types';

/**
 * The data-error report store — session-lifetime and in memory,
 * deliberately not in `localStorage`: `services/preferences.ts` is the
 * app's only sanctioned storage boundary and it is for UI preferences,
 * "never PHI". A report names a patient and quotes a doctor about them, so
 * it stays in memory and dies with the tab, exactly as
 * `record-attachments/store.ts` reasons about its own rows.
 *
 * Append-only apart from resolution. Nothing in UX §2.3 lets a doctor
 * withdraw a report, and a delete path would be the one way this store
 * could quietly lose the record of who raised what.
 */

const REPORT_LATENCY_MS = 350;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const reports = new Map<string, DataErrorReport>();

let sequence = 0;

/** Test-only reset, so suites do not leak reports into each other. */
export function __resetDataErrorReports(): void {
  reports.clear();
  sequence = 0;
}

export function listDataErrorReports(): readonly DataErrorReport[] {
  return Array.from(reports.values()).sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
}

/** Open reports against one patient — what the admin account view shows. */
export function openReportsForPatient(patientId: string): readonly DataErrorReport[] {
  return listDataErrorReports().filter(
    (report) => report.patientId === patientId && report.status === 'open',
  );
}

export interface FileDataErrorInput {
  readonly patientId: string;
  readonly patientName: string;
  readonly patientMrn: string;
  readonly field: DataErrorField;
  readonly description: string;
  readonly reportedBy: string;
  readonly now?: () => Date;
}

/**
 * Files one report. Rejects an empty description rather than storing a row
 * an administrator cannot act on — "the record is wrong" with no detail is
 * a ticket that gets closed unread, which is the same nothing as the
 * `mailto:` this replaced.
 */
export async function fileDataErrorReport(input: FileDataErrorInput): Promise<DataErrorReport> {
  const description = input.description.trim();
  if (description.length === 0) {
    throw new Error('DATA_ERROR_DESCRIPTION_REQUIRED');
  }

  await delay(REPORT_LATENCY_MS);
  const now = input.now ?? (() => new Date());
  sequence += 1;

  const report: DataErrorReport = {
    id: `DER-${String(sequence).padStart(4, '0')}`,
    patientId: input.patientId,
    patientName: input.patientName,
    patientMrn: input.patientMrn,
    field: input.field,
    description,
    reportedBy: input.reportedBy,
    reportedAt: now().toISOString(),
    status: 'open',
  };

  reports.set(report.id, report);
  return report;
}

/** Marks one report handled. The row stays; only its status moves. */
export function resolveDataErrorReport(reportId: string): void {
  const existing = reports.get(reportId);
  if (existing === undefined) return;
  reports.set(reportId, { ...existing, status: 'resolved' });
}
