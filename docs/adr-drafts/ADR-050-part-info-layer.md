## ADR-050 (part) — The Patient-Facing Information Layer

**Status:** Accepted for the boundaries below (owner decision 2026-11-26).
The Patient AI part of ADR-050 is drafted separately.

### Decision

The patient never sees the medical record, physician notes, internal
documentation or unrestricted clinical history. A separate, narrow
*patient-facing information layer* is allowed. In this slice it is:

- **`GET /me/lab-orders`** — test *status* only: `id`, `testName`,
  `category`, `specimenType`, `status`, `requestedAt`, `collectedAt`,
  `completedAt`, `hospital {id,name}`, and a fixed
  `results: { available: false, reason: 'release_policy_pending' }`.
  Status mapping: `ORDERED → awaiting_collection`,
  `COLLECTED | PROCESSING → in_progress`, `COMPLETED → completed`,
  `CANCELLED → cancelled`. The repository's explicit `select` never reads
  `clinical_indication`, `interpretation`, results, flags,
  `has_critical_result` or the reviewer, so they cannot leak by a mapper
  change. Soft-deleted rows and legacy rows with `hospital_id IS NULL`
  (#17) are excluded.
- **`GET /me/insurance`** — the policy on file (active, else latest):
  `providerName`, `plan`, `policyNumberLast4`, `validUntil`, `isActive`;
  plus `authorizations: { available: false, reason:
  'authorization_workflow_undecided' }`.

Both are patient-only (403 `patient_only` for any other role), resolve the
patient from the session only (`PatientSelfScopeService`), and answer an
unlinked account 409 `patient_not_linked` so the app can show the linking
screen. Under RLS a patient scope reads only its own rows.

### Not decided here

- **Results release (ADR-031) remains proposed.** No release column, no
  release rule and no result values are exposed; the marker above is the
  only result-related field.
- **Insurance authorization status:** the approval/rejection state machine is
  undecided (ADR-039 item 5). No authorization data is exposed; the marker
  above documents the blocker.
- Patient instructions "where they exist as data": no patient-instruction
  field exists on these resources today, so none is exposed.
