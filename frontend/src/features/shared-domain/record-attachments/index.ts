/**
 * Lab report → medical record attachments (D-14). The labs feature writes,
 * the medical-records feature reads, and neither imports the other (§3.3).
 */
export {
  ATTACH_BLOCKED_META,
  NotAttachableError,
  assertAttachable,
  assessAttachability,
  type AttachBlockedReason,
  type AttachabilityInput,
  type AttachabilityResult,
  type AttachableReport,
} from './attachability';
export {
  labAttachmentsForLabKey,
  recordAttachmentKeys,
  useAttachLabReportMutation,
  useLabAttachmentsQuery,
  useRecordAttachmentsQuery,
} from './queries';
export {
  __resetRecordAttachments,
  attachLabReport,
  listAttachmentsForLab,
  listAttachmentsForRecord,
} from './store';
export type {
  AttachmentIdentity,
  AttachmentTarget,
  LabReportAttachment,
  LabReportRef,
} from './types';
