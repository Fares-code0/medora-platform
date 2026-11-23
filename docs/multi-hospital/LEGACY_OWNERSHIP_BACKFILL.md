# Legacy assignment ownership backfill (S2)

Tooling for enforcement stage **S2** of
[`BACKEND_ENFORCEMENT_INVENTORY.md`](BACKEND_ENFORCEMENT_INVENTORY.md) §4: give live
`patient_doctor_assignments` rows their `hospital_id`, `doctor_employment_id` and
`hospital_medical_record_id` **only where the data already proves them**.

> **Not authorized against any real environment.** Which hospital owns a legacy row is an open
> owner decision (GitHub issue **#17**, RLS blocker **B3**). Running `--apply` against development
> shared data, staging or production requires that decision first. `--apply` refuses
> `APP_ENV=production` outright. The report (dry run) is read-only and may be run anywhere.

| Item | Where |
|---|---|
| Rules (importable, tested directly) | `backend/prisma/backfill/legacy-assignment-ownership.ts` |
| CLI | `backend/prisma/backfill/run-legacy-assignment-ownership.ts` |
| npm script | `npm --prefix backend run db:backfill:assignments` (add `-- --apply` to write) |
| Tests | `backend/test/legacy-assignment-backfill.e2e-spec.ts` (throwaway database) |

## Rules

Evaluated per row, in this order; the first rule that fails decides the classification.

| # | Rule | Classification if it fails |
|---|---|---|
| 1 | Candidate: `hospital_id IS NULL`. The CHECKs `…_employment_scope_check` and `…_hospital_scope_pair_check` make the three columns all-NULL or all-set, so a candidate is wholly unowned | (not a candidate) |
| 2 | The assignment is live (`revoked_at IS NULL`) | `revoked` |
| 3 | At `t = assigned_at` (the row's only creation timestamp), **exactly one** employment of the same doctor satisfies `started_at <= t < COALESCE(ended_at, infinity)` | none: `no_employment`; several: `ambiguous_employment` |
| 4 | That employment is still active (`ended_at IS NULL`) | `employment_ended` |
| 5 | The patient has **exactly one** `hospital_medical_records` row at that employment's hospital | none: `no_hospital_record`; several: `ambiguous_hospital_record` |
| 6 | All of the above | `proven`: the three columns are written together |

Why the two conservative choices:

- **Revoked rows are never written.** Authorization only reads live assignments, so owning history
  adds no enforcement, and assigning history to a hospital is part of the #17 decision.
- **`employment_ended` is not proven.** The data shows where the assignment began, but the doctor
  has left that hospital while the assignment is still live. Ownership cannot be changed in place
  once set (`prevent_tenant_scope_reassignment`), so writing it would pin the row for good to a
  hospital the doctor no longer works at. Whether such a row is revoked or transferred is #17's
  call. (The shadow rule denies it either way: `assignment_employment_ended`.)

`ambiguous_hospital_record` cannot occur while `hospital_medical_records_patient_hospital_key`
(one record per patient and hospital) holds; the rule is kept so the tool does not silently rely
on that constraint.

## Never inferred

- A hospital from anything other than the doctor's employment covering `assigned_at`: not from the
  doctor's *current* employment, the patient's records, appointments, departments, clinics or the
  granting user.
- A medical record: none is ever created; a missing one is reported (`no_hospital_record`).
- A choice between candidates: two employments or two records mean the row is left alone.
- Anything about revoked rows.

## Behaviour

- **Dry run (default):** one `REPEATABLE READ READ ONLY` transaction; JSON report on stdout
  (`mode`, `database`, `snapshotAt`, `candidates`, `counts` per classification, `rowsUpdated: 0`,
  and `rows` with each assignment's ids, classification, reason and derived owner), a one-line
  summary on stderr.
- **`--apply`:** refused when `APP_ENV=production`, before connecting. Otherwise one
  `SERIALIZABLE` transaction computes the same report and writes the proven rows with a single
  `UPDATE` whose `WHERE` re-checks each row is still live and wholly unowned. A concurrent change to
  anything it read aborts the run with a serialization failure (nothing is written; rerun).
  Ordinary `UPDATE`s: every FK, CHECK and trigger on the table applies unchanged.
- **Idempotent:** owned rows are no longer candidates, so a second `--apply` updates nothing.
- Rows it leaves untouched stay listed in every report, with their reason, for the #17 decision.
