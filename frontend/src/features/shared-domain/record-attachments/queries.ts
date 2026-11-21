import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';
import { selectService } from '@/api/seam';

import type { AttachableReport } from './attachability';
import { attachLabReportHttp } from './http-attachments';
import { attachLabReport, listAttachmentsForLab, listAttachmentsForRecord } from './store';
import type { LabReportAttachment } from './types';

/**
 * The selection point (FE-10.7): the session register in mock mode, the
 * laboratory API live. Live, what is filed is served inside the record's
 * and the order's own documents, so the client-side register is empty —
 * see `http-attachments.ts`.
 */
const source = selectService<{
  readonly attach: (attachable: AttachableReport) => Promise<LabReportAttachment>;
  readonly forRecord: (recordId: string) => readonly LabReportAttachment[];
  readonly forLab: (labId: string) => readonly LabReportAttachment[];
}>({
  // Called through rather than captured, so the store's live bindings are what run.
  mock: {
    attach: (attachable) => attachLabReport(attachable),
    forRecord: (recordId) => listAttachmentsForRecord(recordId),
    forLab: (labId) => listAttachmentsForLab(labId),
  },
  http: { attach: attachLabReportHttp, forRecord: () => [], forLab: () => [] },
});

/**
 * The query layer both features read through, so the Labs screen and the
 * medical record cannot disagree about what is attached: one store, one key
 * prefix, and a single invalidation on write.
 *
 * `useAttachLabReportMutation` is pessimistic. DP-05 wants optimistic updates
 * with rollback, and this is one of the two places in the app that declines
 * them (the other is signing a prescription): a row that says "Attached to
 * Encounter MR-2091" before the write lands is a doctor believing a result is
 * on a chart it is not on. It stays pessimistic, and no amount of DP-05
 * tidiness may change that.
 */

export const recordAttachmentKeys = createKeyFactory('record-attachments');

/** Attachments filed against one medical record. */
export function labAttachmentsForLabKey(labId: string) {
  return [...recordAttachmentKeys.all, 'lab', labId] as const;
}

export function useRecordAttachmentsQuery(recordId: string) {
  return useQuery({
    queryKey: recordAttachmentKeys.detail(recordId),
    queryFn: () => Promise.resolve(source.forRecord(recordId)),
    staleTime: 30_000,
    enabled: recordId !== '',
  });
}

export function useLabAttachmentsQuery(labId: string) {
  return useQuery({
    queryKey: labAttachmentsForLabKey(labId),
    queryFn: () => Promise.resolve(source.forLab(labId)),
    staleTime: 30_000,
    enabled: labId !== '',
  });
}

export function useAttachLabReportMutation() {
  const queryClient = useQueryClient();

  return useMutation<LabReportAttachment, Error, AttachableReport>({
    mutationFn: (attachable) => source.attach(attachable),
    onSuccess: () => {
      // One prefix covers both axes — the record's list and the lab's.
      void queryClient.invalidateQueries({ queryKey: recordAttachmentKeys.all });
    },
  });
}
