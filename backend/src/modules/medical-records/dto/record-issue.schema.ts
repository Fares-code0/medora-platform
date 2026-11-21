import { z } from 'zod';

/**
 * The administrators' record-issue queue (API §6.9 "→ admin queue",
 * RM M12.7). `record_issue_reports.status` is `open | investigating |
 * resolved`, closed by a CHECK, and the wire speaks the same words.
 */
export const RECORD_ISSUE_STATUS_VALUES = ['open', 'investigating', 'resolved'] as const;

export type RecordIssueStatus = (typeof RECORD_ISSUE_STATUS_VALUES)[number];

/**
 * `GET /admin/record-issues`.
 *
 * Oldest first by default: a queue is worked in arrival order, and the
 * `(status, created_at)` index the table already carries serves exactly
 * that read.
 */
export const recordIssueListSchema = z.object({
  status: z.enum(RECORD_ISSUE_STATUS_VALUES).optional(),
  sort: z.enum(['reportedAt:asc', 'reportedAt:desc']).default('reportedAt:asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type RecordIssueListQuery = z.infer<typeof recordIssueListSchema>;

/**
 * `PATCH /admin/record-issues/{id}` — triage (`investigating`) or close
 * (`resolved`). `open` is not a target: an issue is reopened by a new
 * report, which keeps the first one's resolution on the record.
 */
export const updateRecordIssueSchema = z.object({
  status: z.enum(['investigating', 'resolved']),
});

export type UpdateRecordIssueInput = z.infer<typeof updateRecordIssueSchema>;
