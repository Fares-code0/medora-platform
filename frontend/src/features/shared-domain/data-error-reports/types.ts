/**
 * Doctor-raised data-error reports (D-07, UX §2.3 "flag data error →
 * routed to admin").
 *
 * **Why this lives in `shared-domain` and not in either feature.** The
 * doctor's patient profile raises the report and the administrator's
 * patients area acts on it; §3.4 forbids one feature reaching into the
 * other, and a model both need is exactly what §3.3 defines this layer for.
 * The alternative — the profile keeping its own list — is how "routed to
 * admin" becomes a claim nobody can check.
 *
 * **The admin side already had the vocabulary.** `SupportFlagKind` includes
 * `'data-correction'`, seeded on a couple of accounts, feeding
 * `openWorkCount` and therefore the ADM-01 action queue's "Accounts with
 * open issues" row and its `/admin/patients?flag=open` destination. Nothing
 * produced one. This is the producer, so a doctor's report lands in a queue
 * that already exists rather than in a new screen built to receive it.
 */

/**
 * Which part of the record is wrong. Deliberately the demographic and
 * identity fields, not the clinical ones: the admin patients area is
 * "account support, access governance and lifecycle — **never clinical
 * review**" (its own section description), so a route that delivered "this
 * lab result is on the wrong patient" would land it with people whose remit
 * excludes acting on it. Clinical corrections are the amend path of D-21.
 */
export const DATA_ERROR_FIELDS = [
  'name',
  'date-of-birth',
  'contact',
  'insurance',
  'identifiers',
  'other',
] as const;

export type DataErrorField = (typeof DATA_ERROR_FIELDS)[number];

export const DATA_ERROR_FIELD_LABEL: Record<DataErrorField, string> = {
  name: 'Patient name',
  'date-of-birth': 'Date of birth',
  contact: 'Phone, email or address',
  insurance: 'Insurance or policy details',
  identifiers: 'MRN or other identifiers',
  other: 'Something else on this record',
};

/** One report, as the doctor filed it. Append-only; admins resolve, not edit. */
export interface DataErrorReport {
  readonly id: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly patientMrn: string;
  readonly field: DataErrorField;
  /** The doctor's own words. Rendered verbatim to the administrator. */
  readonly description: string;
  readonly reportedBy: string;
  readonly reportedAt: string;
  readonly status: 'open' | 'resolved';
}
