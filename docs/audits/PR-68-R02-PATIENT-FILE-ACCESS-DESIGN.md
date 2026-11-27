# PR-68 R-02: patient access to clinical files, design and migration proposal

> **Status: AWAITING APPROVAL. The database part is NOT implemented.**
> This document proposes a migration and does not apply one. No Prisma schema
> or migration file was changed. The application-layer enforcement in
> §5 is implemented on `claude/patient-app-end-to-end`, together with its e2e
> test. The database change in §6 needs the owner's DB-change approval.

Source finding: `docs/audits/PR-68-FINAL-SECURITY-INTEGRATION-AUDIT.md` §8, R-02.
Owner decision: a patient must never access the full medical record, clinical
results, lab results, medical documents or clinical attachments. ADR-031
(results release) is open.

## 1. Classification today

`files.kind` is constrained by `files_kind_check`
(`backend/prisma/migrations/20260825162641_m5_1_enums_lookups_files/migration.sql:451`)
to eight values:

| Kind | Content | Clinical? | Subject resolved through |
| --- | --- | --- | --- |
| `patient_document` | Referral, consent, external record, insurance, report | **Yes** | `patient_documents.patient_id` |
| `record_attachment` | Attachment to an encounter | **Yes** | `record_attachments → medical_records.patient_id` |
| `lab_attachment` | Lab report, addendum, raw data | **Yes** | `lab_attachments → lab_orders.patient_id` |
| `message_attachment` | Staff messaging attachment | Possibly | conversation participants |
| `verification_document` | A doctor's credentials | No (not patient PHI) | `doctor_verification_documents` |
| `profile_photo` | Staff avatar | No | public |
| `branding_asset` | Clinic logo | No | public |
| `backup_artifact` | Backup | Not client-mintable | none (deny) |

The classification is **already explicit**: the kind is a NOT NULL, CHECK-
constrained column set by the server at creation. Lab attachment files are
minted by `LabAttachmentRepository.attachToOrder` with `kind = 'lab_attachment'`,
and record or document links require `kind` to match (`record.repository.ts`
`attachUpload`, `patient-tabs.repository.ts` `linkDocument`). **No new
classification column or access-policy table is needed**, and **no backfill is
needed.** Every existing row already has one of the eight kinds, and the rule
is a function of `(role, kind)`.

A clinical row cannot hide under a non-clinical kind. `record_attachments` can
cite a `lab_attachment` file (lab attach-to-record reuses the file), but that is
still a clinical kind. The link paths refuse any other kind.

## 2. Every path through which a file, its metadata or a URL can reach a patient

Routes admitting the patient role (`T`) were taken from
`backend/test/authz-route-matrix.snapshot.txt`. Every module that touches
`files`, `patient_documents`, `record_attachments`, `lab_attachments` or
`signedDownloadUrl` was then read.

| Path | Patient admitted by route? | Exposure before this change | Status now |
| --- | --- | --- | --- |
| `GET /files/:fileId` (metadata) | Yes (`authenticated`) | Uploader shortcut: a patient can upload any clinical kind and read it back. Own-chart branch: see §3 | **Closed in app** (`FileAccessService.canRead`) |
| `GET /files/:fileId/download` (signed URL) | Yes | Same as above | **Closed in app** (same gate, `FilesService.downloadUrl → access.readable`) |
| `DELETE /files/:fileId` | Yes | Uploader only. No disclosure | Unchanged |
| `POST /files` | Yes | A patient can mint `patient_document`/`record_attachment`/`lab_attachment` rows (upload is not role-gated per kind) | Rows cannot be linked by anyone else (§4). Recommendation R-02b below |
| `GET /patients/:id/documents[/:docId/download]` | No (`patients.view`, `ADRLP..`) | None | Asserted 403/404 in e2e |
| `GET /medical-records/:id[/attachments/:aid/download]` | No (`records.view`) | None | Asserted 403/404 in e2e |
| `GET /lab-orders/:id` (carries attachments) | No (`labs.*`) | None | Asserted 403/404 in e2e |
| `GET /attachments/:id/download` (messaging) | No (`messages.send`, `ADRLP..`) | None | Asserted 403/404 in e2e |
| `GET /me/lab-orders` | Yes | Status projection only. No attachment or file id (`patient-lab-status.service.ts`) | Asserted no file id in e2e |
| `GET /me/profile`, `/me/patient-link` | Yes | No file ids | Asserted no file id in e2e |
| `PUT /me/profile/photo` | Yes | `profile_photo` only (public kind) | Unchanged |
| `/me/verification-documents` | Yes | `verification_document` only, own | Unchanged |
| `POST /me/data-export` | Yes | 501 Not Implemented (`settings.controller.ts:82`) | Must be re-reviewed when built |
| `GET /exceptional-access/:id/data`, `/information-requests/:id/shared` | Route-level yes | Service refuses everyone except a clinical doctor or admin (`controlled-access.service.ts` `assertMayRequestExceptional`, line ~390) | Unchanged |
| `/me/ai/*` (patient AI) | Yes | No file or attachment access in `src/modules/ai` | Unchanged |
| `/notifications*`, `/search` | Yes | No file ids. Search refuses a role without an index | Unchanged |
| DB: `files_read` policy through `app_rls.file_of_current_patient` and `uploaded_by = current_user_id()` | n/a | Admits the linked patient to all three kinds | **Open. Needs the migration in §6** |

## 3. A latent defect found during the investigation

In `FileAccessService.reachesPatient`, the final line compares
`selfScope.patientIdFor(principal)` with the subject's patient id.
`PrismaPatientSelfRepository.findPatientIdByUserId` returns the **public id**
(`PT-…`), while `FileRepository.patientFor*` return the **UUID**
(`patient_id`). The comparison could therefore never be true. On this branch
the application never actually admitted a linked patient to their own chart's
files. The e2e test confirmed this: with the new rule temporarily disabled,
the own-chart cases still answered 404, and only the uploader-shortcut cases
failed.

This means R-02 was **latent** at the API, not exploitable, apart from the
uploader shortcut. It was one "bug fix" away from becoming exploitable: anyone
correcting the id-type mismatch would have opened all three kinds to patients.
The new rule makes the refusal explicit and independent of that comparison.
The mismatch itself is left as is, since it is now unreachable for the three
kinds. It is reported here, not fixed. When ADR-031 permits release, whoever
lifts the rule must fix the comparison with it.

The **database** layer has no such mismatch. `app_rls.file_of_current_patient`
compares UUIDs and does admit the linked patient.

## 4. The uploader rule

**Can a patient upload a clinical kind?** Yes. `POST /files` is
`@Authenticated()`. `FilesService.upload` only gates on clinical standing, and
the `patient` role is not standing-gated (`standingKindOf` returns `null`, so
standing is `clinical`). `uploadFileSchema` accepts all seven client kinds.
The e2e test proves a patient's `patient_document`, `record_attachment` and
`lab_attachment` uploads return 201.

**Can that upload become a clinical attachment?** No, through every current
path:
- `RecordRepository.attachUpload` requires `files.uploaded_by = <linking
  user>` and `kind = 'record_attachment'`, and only `records.edit` (doctor)
  reaches it.
- `PatientTabsRepository.linkDocument` requires `uploaded_by = <linking user>`
  and `kind = 'patient_document'`, and only `patients.view` (staff/doctor)
  reaches it.
- Lab attachment files are created inside `attachToOrder` with
  `uploaded_by = <lab/doctor user>`. They are never adopted from `/files`.

So a patient-uploaded clinical-kind file only ever holds bytes the patient
supplied. Reading it back is not, today, a disclosure of clinical content.

**Recommendation and decision (implemented):** close the shortcut for the
patient role anyway. The rule "a patient never reads these three kinds" is then
a property of `(role, kind)`. It does not depend on the linking invariant, which
lives in two other modules and is one relaxed `WHERE` clause away from making
the shortcut a bypass (for example, a future "patient submits a document for
review" flow that links patient uploads). No patient client uses `/files`
(`patient-app/src` has no reference), so nothing legitimate breaks. A patient's
own `profile_photo` stays readable.

**R-02b (recommended, not implemented, separate approval):** refuse
`patient_document`, `record_attachment` and `lab_attachment` at
`POST /files` for the patient role (422 on `kind`). This would stop patients
creating rows they can neither read nor link. It changes upload behaviour, so
it was left out of this fix.

## 5. Implemented: application-layer enforcement (database-independent)

`backend/src/modules/files/services/file-access.service.ts`:
- New `CLINICAL_KINDS_DENIED_TO_PATIENTS = {patient_document,
  record_attachment, lab_attachment}`.
- In `canRead`, after the standing check and **before** the uploader shortcut:
  `if (user.role === 'patient' && kind ∈ set) return false`, which answers 404
  through `readable()`.
- `readable()` is the single gate for both `detail` and `downloadUrl`, so both
  routes are covered. `deletable()` is unchanged (uploader only, no
  disclosure).
- Unchanged: doctors (care scope plus file hospital = reach hospital), the
  uploader rule for every non-patient role, public kinds, message
  participants, verification documents, and default deny for `backup_artifact`
  and unknown kinds.

`patient` is the only role that can hold patient self-scope. Custom roles
cannot derive from `patient` (`roles.service.ts` `createRole`), so
`user.role === 'patient'` is the complete test.

## 6. Proposed migration (NOT implemented)

A **new** migration, for example
`backend/prisma/migrations/<timestamp-after-latest>_r02_patient_clinical_files_deny/migration.sql`.
`20261125095000_rls_files_conversations` is applied and must not be edited.
Choose the timestamp when implementing, after every migration on `main` and
on the branch.

```sql
-- R-02 (PR-68): a patient never reads a clinical-kind file at the database
-- layer either. Owner decision (no lab results, documents or clinical
-- attachments for patients); ADR-031 (release) is open.

-- 1. The helper answers no. Same signature, so the policy that calls it
--    and the grants on it are untouched. CREATE OR REPLACE keeps the ACL:
--    the REVOKE FROM PUBLIC of 20261125095000 and the runtime role's EXECUTE
--    survive. The REVOKE is restated so the file is self-evidently safe.
CREATE OR REPLACE FUNCTION app_rls.file_of_current_patient(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT false
$fn$;
REVOKE ALL ON FUNCTION app_rls.file_of_current_patient(uuid) FROM PUBLIC;

-- 2. The uploader term must not reopen the kinds under patient scope
--    (parity with the application rule in §5).
DROP POLICY files_read ON public.files;
CREATE POLICY files_read ON public.files FOR SELECT USING (
     app_rls.scope() IN ('system', 'platform')
  OR (hospital_id IS NOT NULL AND app_rls.org_visible(hospital_id))
  OR (uploaded_by = app_rls.current_user_id()
      AND NOT (app_rls.scope() = 'patient'
               AND kind IN ('patient_document', 'record_attachment', 'lab_attachment')))
  OR kind IN ('profile_photo', 'branding_asset')
  OR app_rls.file_of_current_patient(id)
  OR app_rls.file_in_my_conversation(id));
```

Design points:
- **Why `SELECT false` instead of dropping the function.** `files_read` calls
  it. Dropping it would need `CASCADE` or a policy rewrite in the same step.
  Keeping the signature makes the change one statement, and it is trivially
  reversible. An alternative is to drop the term from `files_read` (already
  being recreated in step 2) and `DROP FUNCTION` it. Either works. Keeping it
  leaves one place to restore if ADR-031 later grants release.
- **The `hospital_id` term cannot reopen the kinds to a patient.**
  `app_rls.org_visible` (`20261124130000_rls_enforcement:129`) returns `false`
  for any scope other than `system`, `platform` or `hospital`, and therefore
  for `patient`. Under patient scope, only the uploader, public-kind,
  `file_of_current_patient` and conversation terms can admit a row. Step 1
  closes the third, and step 2 guards the first.
- **Default deny.** Unknown or future kinds reach a patient only through the
  uploader, public-kind or conversation terms. No new term admits them.
- **Staff and doctor access preserved.** The `system`/`platform`, `hospital_id`
  + `org_visible`, uploader (for non-patient scope) and conversation terms are
  byte-for-byte unchanged. Doctors keep reaching linked files through
  `org_visible(hospital_id)`, since linking adopts the file into the chart's
  hospital.
- **Cross-patient and cross-hospital exposure.** The change only removes
  admissions. No term is widened, so neither exposure can grow. Hospital
  isolation stays with `org_visible` and the application's
  `file.hospitalId === reach.hospitalId`.
- **Backfill.** None. The rule reads `kind`, which every row already has.
- **Rollback.** A follow-up migration restoring the 20261125095000 function
  body and policy text verbatim. No data is touched in either direction.
- **Drift.** `prisma/schema` does not model functions or policies. Run
  `npm --prefix backend run db:check` after applying. It should report no
  difference.
- **Locking.** `DROP/CREATE POLICY` takes a short `ACCESS EXCLUSIVE` lock on
  `files`. Apply it in a low-traffic window.

**Related, out of R-02's scope (report only):** `app_rls.clinical_visible` admits
`scope = 'patient'` to its own rows in every clinical table (`medical_records`,
`lab_orders`, `patient_documents`, `record_attachments`, `lab_attachments`, and
others; `20261124130000_rls_enforcement`). At the API those tables are only
reachable through capability-gated routes the patient role does not hold, so
nothing is exposed today. The database still does not enforce the owner
decision for that metadata. That is a wider policy review than R-02 and needs
its own decision.

## 7. Test plan

Implemented: `backend/test/patient-file-access.e2e-spec.ts`, real API plus
Postgres, files created through the real upload and link routes, in-memory
object store:
1. The link works: `/me/lab-orders` shows the patient's own order and not the
   other chart's.
2. The linked patient gets 404 on `GET /files/:id` and `/download` for each of
   the three kinds on their own chart. The refusal is identical to the one for
   a nonexistent id.
3. Another patient's chart: 404 for each kind.
4. The patient's own uploads of each clinical kind: 201 on upload, then 404 on
   read and download. The patient's own `profile_photo` is still 200.
5. Alternate routes (documents list and download, record and record-attachment
   download, lab order, messaging attachment download): 403 or 404, with no
   URL in the body. `/me/lab-orders`, `/me/profile` and `/me/patient-link`
   carry no clinical file id.
6. The treating doctor: 200 on read and download for each kind, plus the chart
   document download and the record-attachment download.
7. Staff (reception) keeps the uploader rule on its own clinical-kind uploads.
8. A doctor at hospital B gets 404 for each kind, even after the patient gains
   a record at B.

To add with the migration (needs the runtime-role run,
`test/support/run-e2e-as-runtime-role.ts`):
- Under patient scope, `SELECT` on `files` for each clinical kind, whether
  linked to the patient's chart or uploaded by the patient, returns zero rows.
- Under hospital scope, a doctor still sees the same rows.
- `app_rls.file_of_current_patient` is not executable by `PUBLIC`
  (`has_function_privilege`).
- `db:check` reports no difference.

## 8. Shared files not changed (for the coordinator)

- `backend/test/authz-route-matrix.snapshot.txt`: no change is needed. The
  route-level admission stays `authenticated`, and the refusal is per file.
- `backend/docs/openapi.json`: no change is needed. The 404 is already the
  documented refusal.
- `docs/DECISIONS.md`: the PR's statement that no result, record, note or
  prescription is readable by a patient is now true at the API. It stays false
  at the database until §6 is approved and applied.
