import { useQuery } from '@tanstack/react-query';

import type { MedicalRecordSummary } from '../model/types';

import { medicalRecordKeys } from './keys';

/**
 * The encounters a report can be filed against (D-14).
 *
 * **Why this exists rather than the labs module reading records directly.**
 * §3.4: features never reach into each other, and cross-feature imports go
 * through a public `index.ts`. Attaching a lab report needs one thing from
 * this module — the list of a patient's encounters, with enough to identify
 * each — so that is what is exported, in a shape of its own, rather than
 * `MedicalRecord` and the whole clinical document behind it. The narrow type
 * is the contract; the record model stays internal, which is what lets it
 * change without breaking the labs screen.
 *
 * The one precedent for this in the codebase is Doctor Settings reading the
 * notifications module's public API. This follows it.
 *
 * The attachments themselves are NOT here: they live in
 * `shared-domain/record-attachments`, which both features read and only labs
 * writes, so the two can never disagree about what is attached.
 */
export interface AttachableRecord {
  readonly recordId: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly patientMrn: string;
  readonly visitDate: string;
  readonly label: string;
  readonly doctor: string;
  readonly department: string;
}

function toAttachable(record: MedicalRecordSummary): AttachableRecord {
  return {
    recordId: record.id,
    patientId: record.patient.id,
    patientName: record.patient.name,
    patientMrn: record.patient.mrn,
    visitDate: record.visitDate,
    label: `${record.visitType} — ${record.department}`,
    doctor: record.doctor,
    department: record.department,
  };
}

/** Most recent encounter first: a result usually belongs to the latest visit. */
export function useAttachableRecordsQuery(patientId: string) {
  return useQuery({
    queryKey: [...medicalRecordKeys.all, 'attachable', patientId] as const,
    /*
     * The service is imported when the query first runs, not with this
     * module (NEW-21): the router imports the records barrel for its routes,
     * so a static import here put the record service, both adapters and the
     * seeded records into the entry chunk of every page. The query only runs
     * inside the labs attach flow, which is lazy already.
     */
    queryFn: async () => {
      const { recordService } = await import('../service');
      return (await recordService.listRecords({ patientId }))
        .map(toAttachable)
        .sort((a, b) => b.visitDate.localeCompare(a.visitDate));
    },
    staleTime: 30_000,
    enabled: patientId !== '',
  });
}
