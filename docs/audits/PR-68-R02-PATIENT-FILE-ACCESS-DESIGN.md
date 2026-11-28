# PR-68 R-02: patient access to clinical files, design and migration proposal

> **Status: IMPLEMENTED (uncommitted) after the owner's explicit approval of revision 3 (2026-11-27). See §12.** Sections 1–11 are kept as the design record.
> **Revision 3 (2026-11-27, final review): §11 supersedes the SQL in §6.3, the
> grant step in §6.5, the rollback in §6.6 and the runtime-role plan in §7.2.**
> Every claim in §11 was verified on a disposable PostgreSQL 16 database,
> provisioned from the real role templates and connected as the restricted
> runtime role. No project database was touched, and no migration file was
> created in the repository. Recommendation: **APPROVABLE**, with the
> conditions in §11.9.
> **Revision 2 (2026-11-27):** §6 was redesigned after the owner's review. In
> revision 1, the patient denial guarded only the uploader term, so
> `file_in_my_conversation` could still admit a clinical file. The denial is
> now an outer restriction over every ordinary term, keyed on the caller's
> **identity** rather than on `scope = 'patient'`, and on the file's **kind or
> linkage**. New sections: §6.1 (conversation analysis), §6.2 (why scope alone
> is insufficient), §6.4 (reasoning per OR term), §6.6 (rollback), §9
> (separate finding on `clinical_visible`) and §10 (remaining uncertainty).
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

**At the application layer**, a clinical row cannot hide under a non-clinical
kind. `record_attachments` can cite a `lab_attachment` file (lab
attach-to-record reuses the file), but that is still a clinical kind. The link
paths refuse any other kind.

**At the database layer this is not guaranteed** (revision 2, §6.1). Nothing
in SQL ties a link table to a file kind:
- `record_attachments`, `patient_documents`, `lab_attachments` and
  `message_attachments` reference `files(id)` with no kind check.
- `files.kind` is not immutable: no trigger guards it, and `files_update`
  admits the uploader.

The revised policy therefore treats a file as clinical by its **kind or its
linkage**, not by kind alone.

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
| DB: `files_read`, through `app_rls.file_of_current_patient`, `uploaded_by = current_user_id()` **and** `app_rls.file_in_my_conversation` | n/a | Admits the linked patient to all three kinds. The uploader and conversation terms can also admit an **unlinked** patient (`self` scope, §6.2) | **Open. Needs the migration in §6** |

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

## 6. Proposed migration, revision 2 (NOT implemented)

Revision 1 of this section guarded only the uploader term. The owner's review
pointed out that PostgreSQL ORs the terms of a permissive policy, so any other
term could still admit a clinical file to a patient. §6.1 and §6.2 show that
two other terms really can. Revision 2 applies the denial **outside** every
ordinary term.

### 6.1 Conversation-file association

**The function** (`20261125095000_rls_files_conversations/migration.sql:78-85`,
SECURITY DEFINER, `search_path = pg_catalog`):

```sql
SELECT app_rls.current_user_id() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.message_attachments ma
    JOIN public.messages m ON m.id = ma.message_id
    JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id
   WHERE ma.file_id = p_file AND cp.user_id = app_rls.current_user_id())
```

It looks at **no kind and no scope**. It is true for any file referenced by any
`message_attachments` row in a conversation where the caller is a participant.

**Every way a file can be associated with a conversation:**

| Path | Kind restriction | Who | Can it attach the three clinical kinds? |
| --- | --- | --- | --- |
| API: `MessageRepository.attachUploads` (`messaging/repositories/message.repository.ts:68-106`), the only writer of `message_attachments` in `src/` | Selects files with `kind = 'message_attachment'`, `uploaded_by = author`, not deleted, not already attached. Otherwise `AttachmentUnavailable` | A participant sending a message (`messages.send`; the patient role lacks it, and messaging is disabled for patients) | **No** |
| DB: `message_attachments` constraints | FK `file_id → files(id)` (`20260826123621_m5_9…:455`). **No kind column check and no unique `file_id`** | — | **Yes**, at the SQL level |
| DB: `message_attachments_via_message` RLS (`20261124130000_rls_enforcement:213-220`) | `FOR ALL USING/WITH CHECK (EXISTS message visible)`. The file's visibility is not checked, because FK checks bypass RLS | Any session that can see the message | **Yes**: any file id, including one the session cannot read |
| DB: trigger `message_attachments_file_owner_trg` → `validate_clinical_file_owner` (`20261122170000_phase21…:455-482`) | Only requires `files.hospital_id` = the conversation's `hospital_id` (`IS DISTINCT FROM`, so NULL = NULL passes) | — | **Yes**, for a same-hospital clinical file |
| DB: one file in several link tables | Nothing prevents a `lab_attachment` file also appearing in `message_attachments` | — | **Yes** |

**Conclusion.** Through the API, no clinical-kind file can be attached to a
conversation today. In the database, nothing prevents it. Any session that can
see a message can insert a `message_attachments` row pointing at a
same-hospital `lab_attachment`, `record_attachment` or `patient_document`
file. Every participant, a patient participant included, then satisfies
`file_in_my_conversation`. Revision 1 left that open, and the owner's concern
is confirmed.

The same reasoning applies to **kind relabelling**. `files.kind` has no
immutability trigger, and `files_update` admits the uploader. A file can
therefore sit in `lab_attachments` while its `kind` reads `message_attachment`
or `profile_photo`. A kind-only denial would miss it. Hence the linkage test
in §6.3.

### 6.2 Why the denial must not be keyed on `scope = 'patient'`

`TenantContextResolver.tenantOf` (`shared/authz/tenant-context.resolver.ts:44-54`)
gives a patient user scope `patient` **only when linked**. An unlinked patient
falls through to `{ scope: 'self', userId }` (line 41).

`app_rls.scope()` (`20261124130000:53-62`) maps any value it does not know,
`self` included, to **NULL**. Under `self` the uploader, public-kind and
conversation terms all still apply, because they key on
`app_rls.current_user_id()`.

A denial written as `scope() = 'patient' AND …` would therefore not cover:
- an unlinked patient;
- a patient between unlink and session revocation;
- any future code path that runs a patient's query with no tenant.

The revised policy identifies the patient by **role**, from `users.role_id →
roles.code = 'patient'`, OR scope `patient`.

Supporting facts:
- A patient user can never receive `hospital` or `platform` scope. The
  `platform` and `hospital` branches are reached only for `role = 'admin'` or
  `'doctor'` (lines 45-59), and `AdminScopeService.scopeOf` returns `none` for
  non-admins (`admin-scope.service.ts:32`).
- `system` scope is set only by server code (`runAsSystem`). `src/modules/files`
  never uses it; its reads run on the request-scoped client
  (`file.repository.ts:71`).

### 6.3 Revised SQL

A **new** migration, for example
`backend/prisma/migrations/<timestamp-after-latest>_r02_patient_clinical_files_deny/migration.sql`.
`20261125095000_rls_files_conversations` is applied and must not be edited.

```sql
-- R-02 (PR-68): a patient never reads a clinical file at the database layer,
-- whatever term would otherwise admit it. Owner decision; ADR-031 is open.

-- (a) Is the caller a patient? Scope `patient` (linked) OR, for any scope,
--     an account whose role is `patient` (covers `self` scope: unlinked
--     patients). SECURITY DEFINER so it can read users/roles regardless of
--     the caller's RLS. It discloses only a boolean about the caller.
--     COALESCE keeps it two-valued: NULL scope or no user must not turn the
--     outer NOT(...) into NULL, which would deny public kinds to everyone.
CREATE FUNCTION app_rls.current_user_is_patient() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT COALESCE(app_rls.scope() = 'patient', false)
      OR (app_rls.current_user_id() IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id
             WHERE u.id = app_rls.current_user_id() AND r.code = 'patient'))
$fn$;

-- (b) Is the file clinical? By kind, OR by linkage to any clinical parent
--     (covers a relabelled kind). Soft-deleted links count, so deleting the
--     link row does not "declassify" the file. SECURITY DEFINER: the link
--     tables are RLS-protected and must be seen in full. All three file_id
--     columns are indexed (patient_documents_file_id_idx,
--     record_attachments_file_id_idx, lab_attachments_file_id_idx).
CREATE FUNCTION app_rls.file_is_clinical(p_file uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT COALESCE(p_kind IN ('patient_document', 'record_attachment', 'lab_attachment'), true)
      OR EXISTS (SELECT 1 FROM public.patient_documents  d WHERE d.file_id = p_file)
      OR EXISTS (SELECT 1 FROM public.record_attachments a WHERE a.file_id = p_file)
      OR EXISTS (SELECT 1 FROM public.lab_attachments    l WHERE l.file_id = p_file)
$fn$;

REVOKE ALL ON FUNCTION app_rls.current_user_is_patient() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_rls.file_is_clinical(uuid, text) FROM PUBLIC;
-- See §6.5: the runtime role needs EXECUTE on both, granted by the deploy
-- step that re-runs the provisioning grant. Migrations do not know its name.

-- (c) The policy: the patient restriction wraps every ordinary term.
DROP POLICY files_read ON public.files;
CREATE POLICY files_read ON public.files FOR SELECT USING (
     app_rls.scope() IN ('system', 'platform')
  OR (
       NOT (app_rls.current_user_is_patient() AND app_rls.file_is_clinical(id, kind))
       AND (
            (hospital_id IS NOT NULL AND app_rls.org_visible(hospital_id))
         OR uploaded_by = app_rls.current_user_id()
         OR kind IN ('profile_photo', 'branding_asset')
         OR app_rls.file_in_my_conversation(id)
       )
  ));
```

What deliberately does **not** change:
- `app_rls.file_of_current_patient` is not redefined or dropped. It is simply
  no longer referenced by `files_read`. Inside the restricted group it could
  only ever admit clinically linked files, all of which the outer
  `NOT (patient AND clinical)` now refuses. It would be dead weight, and
  removing it from the policy is clearer than neutering it. Leaving its body
  untouched also keeps rollback exact (§6.6).
- `file_in_my_conversation`, `org_visible` and `scope`: not redefined.
- `files_insert`, `files_update`, `files_delete`: not changed. See §6.4 for
  why the SELECT policy is enough to stop reads through them.

### 6.4 Reasoning for every term

| Term | Who it serves | Under the outer restriction? | Why |
| --- | --- | --- | --- |
| `scope() IN ('system','platform')` | Server jobs (`runAsSystem`), Platform Admin oversight | **No, exempt** | Preserves legitimate system and platform access (owner requirement 4). Neither scope can be held by a patient user (§6.2), so exempting them cannot readmit a patient. |
| `NOT (current_user_is_patient() AND file_is_clinical(id, kind))` | — | Is the restriction | False only for a patient caller and a clinical file. Clinical means by kind **or** linkage, so relabelling cannot bypass it. A patient is identified by scope **or** role, so `self` scope cannot bypass it. Both helpers are total (COALESCE), so the restriction never turns NULL and accidentally hides public files from anonymous or `self` callers. |
| `hospital_id IS NOT NULL AND org_visible(hospital_id)` | Doctors and staff of the file's hospital | Yes | `org_visible` is false for `patient` and NULL scope (`20261124130000:129-137`), so this term never admitted a patient anyway. Wrapping costs non-patients nothing: the restriction is true for them. Hospital isolation is unchanged. |
| `uploaded_by = current_user_id()` | Every uploader (staff drafts before linking, a patient's own photo) | Yes | Closes the shortcut proven open in §4 at the database layer too, for clinical kinds and for any patient upload later linked clinically. Non-patient uploaders are unaffected. |
| `kind IN ('profile_photo','branding_asset')` | Everyone (avatars, logos) | Yes | Public kinds. The restriction only bites when the file is also clinically **linked** under a public label. Such a file is clinical and must not be public to a patient. Non-patients are unaffected. |
| `file_of_current_patient(id)` | (was: the linked patient) | **Removed** | Its only purpose was to admit a patient to clinical files, which the owner decision forbids. |
| `file_in_my_conversation(id)` | Conversation participants (message attachments) | Yes | §6.1: the database lets a clinical file be attached. Under the restriction a **patient** participant never reads one. A staff participant is unaffected, and a patient participant still reads genuine `message_attachment` files (kind not clinical, no clinical linkage), preserving owner requirement 6. |

**Reads through INSERT/UPDATE/DELETE.** PostgreSQL applies the SELECT policy's
USING expression to rows an UPDATE or DELETE must read (a `WHERE` clause or
`RETURNING`). A patient therefore cannot use `UPDATE … RETURNING` to read a
clinical file it cannot SELECT.

Residual, documented and not fixed here: a bare `UPDATE files SET kind = …`
with no `WHERE`, run by a patient-scoped session, could relabel the patient's
**own unlinked** uploads, which still pass the uploader-only `files_update`
USING. The linkage test keeps that from reaching any linked clinical file, so
it only ever exposes bytes the patient supplied. No application code issues
such a statement. A kind-immutability trigger would close it fully; that is
recommended separately (§10).

**Cross-patient and cross-hospital isolation.**
- The revision only **removes** admissions: one term is dropped, and the
  others gain an extra AND condition. No term is widened, so no exposure can
  grow.
- `org_visible` and the application's `file.hospitalId === reach.hospitalId`
  still carry hospital isolation.
- The two new SECURITY DEFINER helpers take only the file id and kind and read
  only the caller's own role row and link existence. They disclose a boolean,
  and no row.

### 6.5 Grants and deployment (blocking detail)

`prisma/roles/provision-runtime-role.sql:63-64` grants
`EXECUTE ON ALL FUNCTIONS IN SCHEMA app_rls` **once, at provisioning**.
Lines 73-77 deliberately do **not** default-grant future functions (H1).

A runtime role provisioned before this migration would therefore lack EXECUTE
on the two new helpers. Every `files` SELECT would then fail with *permission
denied for function*, so all file reads would error. That fails closed, but it
is an outage.

The precedent migration `20261125095000` created functions under the same
REVOKE-FROM-PUBLIC convention, so the existing deploy procedure must already
re-run the provisioning grant, or provision after migrating. **This needs
confirmation from whoever runs production deploys** (§10).

Proposed deploy sequence:
1. Apply the migration (`db:deploy`).
2. Re-run `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_rls TO <runtime role>`,
   the provisioning template's line 64, in the same maintenance window.

The test plan (§7, R-10) provisions the role **before** migrating so that this
failure mode is caught.

### 6.6 Rollback

A follow-up migration restores the previous behaviour exactly:

```sql
DROP POLICY files_read ON public.files;
CREATE POLICY files_read ON public.files FOR SELECT USING (
     app_rls.scope() IN ('system', 'platform')
  OR (hospital_id IS NOT NULL AND app_rls.org_visible(hospital_id))
  OR uploaded_by = app_rls.current_user_id()
  OR kind IN ('profile_photo', 'branding_asset')
  OR app_rls.file_of_current_patient(id)
  OR app_rls.file_in_my_conversation(id));
DROP FUNCTION app_rls.file_is_clinical(uuid, text);
DROP FUNCTION app_rls.current_user_is_patient();
```

The policy text is verbatim from `20261125095000_rls_files_conversations/migration.sql:96-102`.

**Why it is exact:**
- `file_of_current_patient`, `file_in_my_conversation`, `org_visible` and
  `scope` are never modified by the forward migration, so their bodies and
  ACLs are untouched and nothing about them needs restoring.
- The forward migration changes exactly one policy and adds exactly two
  functions. The rollback reverses exactly those.
- No data is touched in either direction, and there is no backfill.
- `files_insert`, `files_update` and `files_delete` are untouched.

**How exactness is verified** (test R-11): on a disposable database, capture

```sql
SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
 WHERE polrelid = 'public.files'::regclass AND polname = 'files_read';
```

plus `md5(prosrc) || proacl::text` for every `app_rls` function. Do this before
the forward migration and again after forward plus rollback, and assert the
two snapshots are identical. PostgreSQL deparses the stored expression, so
equal text means an equal policy.

**Locking.** `DROP/CREATE POLICY` takes a short `ACCESS EXCLUSIVE` lock on
`files`, so apply it in a low-traffic window.

**Correction (revision 3):** the earlier claim that "Prisma runs each migration
file in one transaction" is **false**. It was disproved by test (§11.5). The
migration must carry an explicit `BEGIN;` … `COMMIT;`.

## 7. Test plan

### 7.1 Implemented (application layer)

`backend/test/patient-file-access.e2e-spec.ts`: real API plus Postgres, files
created through the real upload and link routes, in-memory object store. 24
tests, all passing:
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

### 7.2 To add with the migration: runtime-role SQL tests (not written yet)

These go in a new spec, for example `test/rls-patient-clinical-files.e2e-spec.ts`,
run through the runtime-role runner (`test/support/run-e2e-as-runtime-role.ts`;
on Windows it needs `shell: true`, see the audit report).

Each case opens a transaction **as the restricted runtime role** (NOSUPERUSER,
NOBYPASSRLS) and sets the tenant context exactly as the application does: the
same `set_config('app.scope'|'app.hospital_id'|'app.user_id'|'app.patient_id', …, true)`
statement as `tenant-context.ts:73-74`. It then runs `SELECT id FROM public.files
WHERE id = $1` and asserts the row count.

Fixtures: hospitals H1 and H2; doctor D1 (H1), doctor D2 (H2), reception R1
(H1); patient P1 (linked, record at H1); patient P2 (linked, record at H1);
unlinked patient account U. Seeded as the owner:

| File | Kind | Uploaded by | Linked as |
| --- | --- | --- | --- |
| F1 | `lab_attachment` | D1 | `lab_attachments` on P1's order (H1) |
| F2 | `record_attachment` | D1 | `record_attachments` on P1's record (H1) |
| F3 | `patient_document` | R1 | `patient_documents` for P1 (H1) |
| F4–F6 | each clinical kind | **P1** | unlinked |
| F7 | `message_attachment` | D1 | in a conversation (H1) with participants D1 **and P1** |
| F8 | `lab_attachment` | D1 | in `lab_attachments` on P1's order **and**, inserted as the owner, in `message_attachments` of F7's conversation: the §6.1 path |
| F9 | `profile_photo` | D1 | **also** in `lab_attachments` (relabelled kind) |
| F10 | `profile_photo` | P1 | unlinked (P1's own photo) |
| F11 | `lab_attachment` | D2 | P2's order at H2 |

| # | Session | Files | Expected rows | Proves |
| --- | --- | --- | --- | --- |
| R-1 | P1, scope `patient` | F1, F2, F3 | 0 each | own-patient helper path closed |
| R-2 | P1, scope `patient` | F4, F5, F6 | 0 each | uploader path closed |
| R-3 | P1, scope `patient` | F8 | 0 | conversation path closed |
| R-4 | P1, scope `patient` | F9 | 0 | linkage beats a relabelled kind |
| R-5 | U, scope `self` (NULL) | F4–F6 re-owned to U, and F7/F8 with U as participant | 0 for the clinical ones | `self` scope cannot bypass |
| R-6 | P1, scope `patient` | F7, F10 | 1 each | legitimate message attachment and own photo preserved |
| R-7 | P2, scope `patient` | F1–F3, F11 | 0 each | cross-patient isolation |
| R-8 | D1, scope `hospital` H1 | F1, F2, F3, F7, F8, F9 | 1 each | doctor and staff access preserved |
| R-9 | D2, scope `hospital` H2 | F1, F2, F3 | 0 each; F11: 1 | hospital isolation unchanged |
| R-10 | Role provisioned **before** the migration, no re-grant | any `files` SELECT | error *permission denied for function* | §6.5 failure mode is real and caught; then re-grant and the same SELECT succeeds |
| R-11 | owner | catalog snapshot | identical before vs after forward + rollback | rollback exactness (§6.6) |
| R-12 | owner | `has_function_privilege('public', …, 'EXECUTE')` | false for both new helpers | PUBLIC cannot call them |
| R-13 | system scope; platform scope (platform admin) | F1–F11 | 1 each | system and platform exemption preserved |
| R-14 | anonymous (no user, NULL scope) | F10 | 1 | public kinds still public; helpers are two-valued |
| R-15 | P1, scope `patient` | `UPDATE files SET original_name = original_name WHERE id = F1 RETURNING id` | 0 rows | no read-through via UPDATE … RETURNING |

Also re-run after applying the migration:
- `test/patient-file-access.e2e-spec.ts`;
- the existing `files`, `record-attachments`, `patient-documents`,
  `lab-attachments`, `profile-photo` and messaging-attachment e2e specs, as the
  **runtime role**;
- `db:check`, which should report no difference, since `prisma/schema` models
  neither policies nor functions.

## 8. Shared files not changed (for the coordinator)

- `backend/test/authz-route-matrix.snapshot.txt`: no change is needed. The
  route-level admission stays `authenticated`, and the refusal is per file.
- `backend/docs/openapi.json`: no change is needed. The 404 is already the
  documented refusal.
- `docs/DECISIONS.md`: the PR's statement that no result, record, note or
  prescription is readable by a patient is now true at the API. It stays false
  at the database until §6 is approved and applied, and see §9 for the wider
  database gap.

## 9. Separate finding: `app_rls.clinical_visible` admits patient scope to every clinical table (NOT part of this migration)

**Severity:** Medium (defence-in-depth). **Confidence:** code-confirmed.
**Status:** report only; needs its own decision and remediation.

**The rule.** `app_rls.clinical_visible(hospital, patient)`
(`20261124130000_rls_enforcement:105-114`) returns
`p_patient = app_rls.current_patient_id()` under scope `patient`. It is the
SELECT policy (`<table>_read`) of every table in the clinical loop
(`20261124130000:140-160`).

**Affected tables, still governed by that rule today:**

`appointments`, `lab_orders`, `medical_records`,
`patient_doctor_assignments`, `prescriptions`,
`hospital_medical_record_conditions`, `patient_allergies`,
`patient_clinical_alerts`, `patient_documents`, `patient_medical_history`,
`patient_medications`, `patient_notes`, `patient_studies`,
`patient_vital_signs`, `hospital_medical_records`, `queue_entries`,
`waiting_room_entries`.

**Excluded, because later migrations replaced their policies:**
- `ai_conversations`: `20261125098000`, owner rule;
- `conversations`: `20261125095000`, participant rule plus `clinical_visible`
  only for patient threads;
- `notifications`: `20261125096000`, recipient rule.

**Child tables that inherit the rule.** Their policy is
`EXISTS (parent visible)` (`20261124130000:182-204`), so they are visible to
the patient whenever the parent is:
- `record_allergies`, `record_attachments`, `record_diagnoses`,
  `record_issue_reports`, `record_medications`, `record_notes`,
  `record_timeline_events`, `record_treatment_plan_items`, `record_versions`;
- `lab_results`, `lab_specimens`, `lab_attachments`, `lab_timeline_events`;
- `prescription_history_entries`, `prescription_notes`,
  `prescription_safety_warnings`, `prescription_timeline_events`;
- `appointment_events`, `appointment_reschedule_proposals`.

**Is a direct runtime-role SELECT possible?**
- A patient has no database credentials, so the patient cannot query directly.
- However, **any** query executed on a linked patient's request runs under
  scope `patient` with `app.patient_id` set. Its RLS would admit **every**
  column of the patient's own rows in all the tables above, including
  `lab_results` values and flags, `record_notes`, `patient_notes`,
  `record_diagnoses` and `prescriptions`.
- The database is therefore **not** a backstop for the owner decision. The
  only control is that patient-reachable code never queries those tables, or
  selects only permitted columns.
- RLS is row-level, so even the tables the status layer legitimately reads
  (`appointments`, `lab_orders`) expose all their columns to a patient-scoped
  query.

**Does any current API route expose those rows?**
- Patient-role routes are capability-gated away from the clinical modules (D
  workstream of the audit).
- The patient-facing repositories read only `appointments`, `lab_orders`
  (status columns), `patients`, `hospitals` and `patient_insurance`
  (`patient-lab-status.repository.ts`, `patient-appointment.repository.ts`,
  `patient-account-link.repository.ts`).
- The audit's R-06 (staff `notes` and `reason` on `GET /me/appointments/:id`)
  is the one place where the column-level gap is visible through the API
  today.
- No route reads the child tables for a patient.

**Is a separate remediation required?** Yes, as defence-in-depth. It is
recommended as its own reviewed migration, **not** folded into R-02.

Sketch, for the decision only:
- Remove the `patient` branch for tables and children a patient must never
  read: `medical_records` and all `record_*`, `lab_results`, `lab_specimens`,
  `lab_attachments`, `prescriptions` and `prescription_*`, `patient_notes`,
  `patient_documents`, `patient_studies`, `patient_vital_signs`,
  `patient_allergies`, `patient_medications`, `patient_medical_history`,
  `patient_clinical_alerts`, `hospital_medical_record_conditions`,
  `patient_doctor_assignments`, `queue_entries`, `waiting_room_entries`.
- Keep it only where the approved status layer reads under patient scope:
  `appointments`, `appointment_events`, `lab_orders`,
  `hospital_medical_records`.
- For those, consider column-restricted security-barrier views for patient
  reads.

This depends on a full inventory of patient-scope queries, and it overlaps
R-06 and the open ADR-031. It needs the owner's decision.

## 10. Remaining uncertainty

1. **Deploy grant (§6.5).** It is unconfirmed how production re-grants EXECUTE
   on new `app_rls` functions. It must be confirmed before applying, or the
   migration causes a file-read outage (fail-closed). Requires external
   validation.
2. **Multiple permissive SELECT policies.** This design assumes `files_read` is
   the only permissive SELECT policy on `files`. In the migrations,
   `files_tenant` was dropped in `20261125095000`, and no later migration adds
   one. A production database with manually added policies would OR them in.
   **Pre-apply check:**
   `SELECT polname, polpermissive, polcmd FROM pg_policy WHERE polrelid = 'public.files'::regclass;`
   must list exactly `files_read`, `files_insert`, `files_update` and
   `files_delete`.
3. **Kind relabelling of a patient's own unlinked uploads (§6.4).** This
   residual exposes only the patient's own bytes. A
   `files_kind_immutable` trigger is recommended as a separate change.
4. **The `message_attachments` integrity gap.** The database allows a
   clinical-kind file to be attached to a message (§6.1). R-02 neutralises the
   *read* consequence for patients. Whether to also forbid the association
   (a kind check in `validate_clinical_file_owner`, or a CHECK through a
   trigger) is a separate integrity decision.
5. **Per-row cost.** `file_is_clinical` runs up to three indexed EXISTS probes
   per candidate row, for patient callers only. PostgreSQL does not guarantee
   AND short-circuit order, so measure `EXPLAIN ANALYZE` on a `files` scan
   under patient scope. File reads are by primary key, so the expected cost is
   negligible.
6. **`backup_artifact` and future kinds.** These stay readable to a patient
   only through the uploader, public-kind or conversation terms, exactly as
   today. A future clinical kind must be added to `file_is_clinical`'s list.
   The linkage test covers it in the meantime if the kind is linked through
   one of the three tables.
7. **§9 is not addressed here.** R-02 does not make the database a complete
   backstop for the owner decision. Only the `files` table is closed.

## 11. Revision 3: final review, verified on a disposable database

### 11.1 Method and environment

- **Database.** A throwaway `postgres:16-alpine` container, removed afterwards.
  It was created, then migrated with every repository migration
  (`prisma migrate deploy`) and the reference seed.
- **Roles.** Both were provisioned from the real templates, with tokens
  replaced as their headers instruct:
  - the runtime role `medora_app` from `prisma/roles/provision-runtime-role.sql`;
  - the audit-maintenance group and login (`medora_audit_maintenance`,
    `medora_audit_retention`) from `provision-audit-maintenance-role.sql`.
- **Order.** The R-02 SQL was applied **after** provisioning, which is the
  production order that §6.5 worried about.
- **Fixtures.** Files `F1` to `F15` (§11.6) were inserted as the owner with
  `session_replication_role = replica`, so that only the rows under test
  exist. Triggers and FK checks were off; CHECK constraints were still
  enforced.
- **Connection under test.** Every read test connected over TCP **as
  `medora_app`**, which has a login password on the throwaway database only.
  Each run first prints `current_user`, `session_user`, `rolsuper` and
  `rolbypassrls`: `medora_app | medora_app | false/false`. No test ran as the
  owner or a superuser.
- **Tenant context.** Each case issued the same four `set_config(…, true)`
  calls as `src/shared/database/tenant-context.ts:73-74`.
- **Scripts.** The scripts were kept in the session scratchpad, not the
  repository: `forward.sql`, `rollback.sql`, `snapshot.sql`, `fixtures.sql`,
  `matrix.sql` and `probes*.sql`.

### 11.2 Verified facts about the real ACLs (C-1)

From the provisioned database:

| Object | ACL / attribute (verified) |
| --- | --- |
| Schema `app_rls` | `{medora=UC, medora_app=U, medora_audit_maintenance=U}`. **PUBLIC has no USAGE**, so PUBLIC cannot call any `app_rls` function, whatever the function's own ACL says. |
| Schema `public` | `=U` (PUBLIC), `medora_app=U`, `medora_audit_maintenance=U` |
| `medora_app` | NOSUPERUSER, **NOINHERIT**, NOBYPASSRLS. It is a member of no role, so it inherits nothing. |
| `medora_audit_retention` (login) | A member of `medora_audit_maintenance`, with INHERIT |
| `app_rls.file_in_my_conversation`, `file_of_current_patient` | `{medora=X, medora_app=X, medora_audit_maintenance=X}`, with no PUBLIC entry |
| Default ACLs | Tables and sequences in `public` only. **No default grant for functions**, confirming H1 |

The revision 2 loop (§6.3(c)) granted to every role holding USAGE on
`app_rls`. That covered the right roles here, but it has two problems:
- **Not least privilege.** It also granted the maintenance group, which never
  reads `files`.
- **Wrong source of truth.** Schema USAGE says who *may* use `app_rls`, not
  who evaluates `files_read`.

Revision 3 replaces it.

**The revision 3 grant rule.** The roles that need EXECUTE are exactly the
roles that can evaluate `files_read` today. `files_read` already calls
`app_rls.file_in_my_conversation`, whose PUBLIC EXECUTE was revoked in
`20261125095000`. So any role able to run a `files` SELECT now must be an
explicit EXECUTE grantee of that function, either directly or as a group its
login inherits from.

The migration copies that grantee set, keeps only roles that also hold SELECT
on `public.files`, and excludes PUBLIC and the owner. If PUBLIC can execute
`file_in_my_conversation`, the grantee set cannot be determined, and the
migration **raises and aborts**.

Login roles that inherit from `medora_app` receive EXECUTE through
membership. `has_table_privilege` and `has_function_privilege` both follow
INHERIT membership.

**Verified results** (`has_function_privilege` after the forward SQL):

| Role | EXECUTE on the new helper | Expected |
| --- | --- | --- |
| `medora_app` (runtime) | **true** | needs it |
| `medora_audit_maintenance` | false | does not read `files` |
| `medora_audit_retention` (inherits the group) | false | same |
| an unrelated new role `r02_unrelated` | false | — |
| PUBLIC (`aclexplode` grantee 0) | **false** | must not |

The resulting ACL is `{medora=X/medora, medora_app=X/medora}`. The maintenance
roles keep every privilege they had: the forward SQL changes no other ACL, and
the snapshot diff in §11.7 shows that only the new function appears.

- **Re-running both templates afterwards**, which is idempotent, gives
  `{medora=X, medora_app=X, medora_audit_maintenance=X}`. The maintenance
  template's blanket `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_rls`
  (`provision-audit-maintenance-role.sql:43`) adds the maintenance group
  again.
  - That is pre-existing template behaviour, which gives it every `app_rls`
    helper.
  - It is harmless: the helper returns one boolean, and the role cannot read
    `files`.
  - Narrowing that template is a separate change and is not part of R-02.
- **Guard test.** On a clone where
  `GRANT EXECUTE ON FUNCTION app_rls.file_in_my_conversation(uuid) TO PUBLIC`
  had been run, the forward SQL failed with
  `R-02: app_rls.file_in_my_conversation is executable by PUBLIC; grant set is undeterminable`.
  It left no helper and an unchanged policy.
- **Old environments.** If a runtime role had been provisioned *before*
  `20261125095000`, it would already lack EXECUTE on
  `file_in_my_conversation`, and today's `files_read` would already fail for
  it. Revision 3 copies the same grantee set, so it is never worse than the
  current state. This is code-confirmed reasoning; that order was not executed.

### 11.3 Information disclosure of SECURITY DEFINER helpers

Revision 2 exposed two general-purpose definer helpers. Called directly,
`file_is_clinical(uuid, text)` answered for **any** caller whether any file
UUID is clinically linked.

Revision 3 replaces both with **one narrowly scoped helper**,
`app_rls.file_denied_to_patient(p_file, p_kind)`. It answers only "is the
caller a patient **and** is this file clinical?". For a non-patient caller it
returns `false` **before reading any link table**.

Verified by direct calls as `medora_app`:

| Context | Call | Result |
| --- | --- | --- |
| Doctor D1, hospital scope | clinical file F1, kind given as `profile_photo` | `false`: no information |
| Doctor D1, hospital scope | a random UUID | `false`: no information |
| Patient P1, patient scope | F11 (another patient and hospital), kind given as `profile_photo` | `true`: the linkage bit is revealed |

**Residual oracle, and why it adds no capability.** Under a patient context, a
direct call still reveals one bit: whether an arbitrary UUID is clinically
linked. Only code connected as the runtime role can make that call, and that
code already sets its own RLS context.

Verified: as `medora_app`, `set_config('app.scope','system',true)` followed by
`SELECT count(*) FROM lab_attachments` returns 4, and clinical `files` returns
11. The RLS context is chosen by the application, not enforced by the
database. A caller able to invoke the helper can already read the rows, so the
helper adds nothing.

The protection R-02 provides is against **application code paths** that run
under a patient context, not against a compromised runtime role. That is the
same trust model as every other `app_rls` policy.

### 11.4 Final SQL proposal (revision 3)

**Forward**, as a new migration
`<timestamp-after-latest>_r02_patient_clinical_files_deny/migration.sql`.
This is the exact text applied in §11.5 and §11.6:

```sql
BEGIN;

CREATE FUNCTION app_rls.file_denied_to_patient(p_file uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN NOT (COALESCE(app_rls.scope() = 'patient', false)
              OR (app_rls.current_user_id() IS NOT NULL AND EXISTS (
                    SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id
                     WHERE u.id = app_rls.current_user_id() AND r.code = 'patient')))
      THEN false
    ELSE COALESCE(p_kind IN ('patient_document', 'record_attachment', 'lab_attachment'), true)
      OR EXISTS (SELECT 1 FROM public.patient_documents  d WHERE d.file_id = p_file)
      OR EXISTS (SELECT 1 FROM public.record_attachments a WHERE a.file_id = p_file)
      OR EXISTS (SELECT 1 FROM public.lab_attachments    l WHERE l.file_id = p_file)
  END
$fn$;

REVOKE ALL ON FUNCTION app_rls.file_denied_to_patient(uuid, text) FROM PUBLIC;

DO $grant$
DECLARE
  r regrole;
  public_exec boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p,
           LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = 'app_rls.file_in_my_conversation(uuid)'::regprocedure
       AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    INTO public_exec;
  IF public_exec THEN
    RAISE EXCEPTION 'R-02: app_rls.file_in_my_conversation is executable by PUBLIC; grant set is undeterminable';
  END IF;

  FOR r IN
    SELECT DISTINCT a.grantee::regrole
      FROM pg_proc p,
           LATERAL aclexplode(p.proacl) a
     WHERE p.oid = 'app_rls.file_in_my_conversation(uuid)'::regprocedure
       AND a.privilege_type = 'EXECUTE'
       AND a.grantee <> 0
       AND a.grantee <> p.proowner
       AND has_table_privilege(a.grantee, 'public.files', 'SELECT')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION app_rls.file_denied_to_patient(uuid, text) TO %s', r);
  END LOOP;
END
$grant$;

DROP POLICY files_read ON public.files;
CREATE POLICY files_read ON public.files FOR SELECT USING (
     app_rls.scope() IN ('system', 'platform')
  OR (
       NOT app_rls.file_denied_to_patient(id, kind)
       AND (
            (hospital_id IS NOT NULL AND app_rls.org_visible(hospital_id))
         OR uploaded_by = app_rls.current_user_id()
         OR kind IN ('profile_photo', 'branding_asset')
         OR app_rls.file_in_my_conversation(id)
       )
  ));

COMMIT;
```

**Rollback**, as a separate follow-up migration:

```sql
BEGIN;
DROP POLICY files_read ON public.files;
CREATE POLICY files_read ON public.files FOR SELECT USING (
     app_rls.scope() IN ('system', 'platform')
  OR (hospital_id IS NOT NULL AND app_rls.org_visible(hospital_id))
  OR uploaded_by = app_rls.current_user_id()
  OR kind IN ('profile_photo', 'branding_asset')
  OR app_rls.file_of_current_patient(id)
  OR app_rls.file_in_my_conversation(id));
DROP FUNCTION app_rls.file_denied_to_patient(uuid, text);
COMMIT;
```

The reasoning for every term in §6.4 still applies: `file_denied_to_patient`
is the conjunction of revision 2's two helpers, with the patient check
evaluated first.

**SECURITY DEFINER review of the single helper:**
- `search_path = pg_catalog, pg_temp`, and every table and function name is
  schema-qualified.
- Its owner is the migration owner (`medora`), which owns the link tables. No
  table uses FORCE RLS, so the helper sees link rows unfiltered. Test R-18
  proves this under `self` scope.
- STABLE, no writes, no dynamic SQL, and always returns true or false.
- PUBLIC EXECUTE is revoked; the grant set is as in §11.2.

### 11.5 Transaction behaviour (C-2), verified with Prisma 7.10.1

Two throwaway clones of the review database were made, and a **probe
migration** was deployed through `prisma migrate deploy`. The probe ran
`DROP POLICY files_read`, then `SELECT 1/0`, then `CREATE POLICY files_read`.
It used a scratch Prisma config and a copy of the migrations folder, not the
repository's.

| Case | Prisma result | `files_read` afterwards | `_prisma_migrations` |
| --- | --- | --- | --- |
| **No explicit transaction** | `P3018 … division by zero` | **absent**: the DROP stayed committed, leaving `files` with RLS and no read policy | `finished_at` NULL (failed) |
| **Explicit `BEGIN;` … `COMMIT;`** | error (`current transaction is aborted`) | **present, unchanged** | `finished_at` NULL (failed) |

**Conclusion (verified):**
- Prisma does **not** wrap a PostgreSQL migration in a transaction.
- With explicit `BEGIN`/`COMMIT`, a failure between `DROP POLICY` and
  `CREATE POLICY` leaves the original policy intact.
- In both cases Prisma records the migration as failed. Recovery is
  `prisma migrate resolve --rolled-back <name>`, then a fixed redeploy.

The full revision 3 forward SQL was also deployed **through Prisma** on a
third clone with both roles already provisioned. It applied successfully, the
grant block produced `{medora=X, medora_app=X}`, and the read matrix matched
§11.6.

### 11.6 Runtime-role read matrix: before and after (verified)

Fixtures (hospitals H1/H2):
- **People:**
  - linked patients P1 and P2;
  - unlinked patient account U, in `self` scope;
  - doctors D1 (H1) and D2 (H2);
  - reception R1 (H1);
  - an unaffiliated doctor N1 (`self` scope);
  - a platform admin PA.
- **Conversation:** C1 at H1, with participants D1, P1 and U.

| File | Kind | Uploader | Linkage |
| --- | --- | --- | --- |
| F1 | lab_attachment | D1 | lab_attachments (P1, H1) |
| F2 | record_attachment | D1 | record_attachments (P1, H1) |
| F3 | patient_document | R1 | patient_documents (P1, H1) |
| F4, F5, F6 | each clinical kind | P1 | none |
| F7 | message_attachment | D1 | message in C1 |
| F8 | lab_attachment | D1 | lab_attachments (P1) **and** message in C1 (§6.1 path) |
| F9 | **profile_photo** | D1 | lab_attachments (P1): relabelled kind |
| F10 | profile_photo | P1 | none |
| F11 | lab_attachment | D2 | lab_attachments (P2, H2) |
| F12 | patient_document | R1 | patient_documents (P1), **soft-deleted link** |
| F13 | message_attachment | **P1** | record_attachments (P1): a patient upload later linked |
| F14 | lab_attachment | U | none |
| F15 | record_attachment | N1 | none |

Files visible to `medora_app` per context:

| Context | Before (PR head policy) | After (revision 3) |
| --- | --- | --- |
| P1, patient | F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F12, F13 | **F7, F10** |
| P2, patient | F9, F10, F11 | **F10** |
| U, self (unlinked patient) | F7, F8, F9, F10, F14 | **F7, F10** |
| D1, hospital H1 | F1, F2, F3, F7, F8, F9, F10, F12, F13 | identical |
| D2, hospital H2 | F9, F10, F11 | identical |
| R1, hospital H1 | F1, F2, F3, F7, F8, F9, F10, F12, F13 | identical |
| N1, self (non-patient) | F9, F10, F15 | identical |
| PA, platform | all 15 | identical |
| system | all 15 | identical |
| anonymous (no user, no scope) | F9, F10 | identical |

**The "before" column proves every bypass.** The own-patient helper exposed
F1, F2, F3 and F12. The uploader term exposed F4 to F6. The conversation term
exposed F8, including to the **unlinked** patient U. The relabelled public
kind exposed F9, and the patient-upload-later-linked case exposed F13. The
"after" column closes all of them.

**What still reaches patients after the change:**
- The patient keeps genuine message attachments (F7) and public non-clinical
  files (F10).
- Doctor, staff, platform, system and anonymous visibility is unchanged row
  for row.
- Hospital isolation is unchanged: D2 still cannot see H1's files.

**Write-path probes, as P1, each rolled back:**
- `UPDATE … WHERE id = F1 RETURNING`: 0 rows.
- `DELETE … WHERE id = F4 RETURNING`: 0 rows, and nothing deleted.
- A bare `UPDATE … RETURNING` with no WHERE: only F10.
- A bare `UPDATE files SET kind = 'profile_photo'` was **refused**: "new row
  violates row-level security policy", because a target row (F13) is
  clinically linked.

**Residual, verified.** As U, a bare relabel of U's own *unlinked* upload
(F14) succeeded, and U could then read F14. This is the §6.4 residual: it
only ever exposes bytes the patient supplied. No application code issues
such a statement. A file-kind immutability trigger would close it, as a
separate change.

### 11.7 Rollback exactness (R-11), verified

A catalog snapshot (`snapshot.sql`) was taken before the forward SQL and
again after forward plus rollback. It covers:
- for each `files` policy: name, command, permissive flag, roles, and the
  deparsed USING and WITH CHECK expressions;
- for each `app_rls` function: signature, owner, `prosecdef`, ACL, md5 of the
  source, and `proconfig`;
- the RLS and FORCE flags on `files`.

The two snapshots were **byte-identical** (23 rows), and the read matrix
returned exactly the "before" column.

### 11.8 Test fidelity review: R-10 and R-16 to R-22

**Requirement for the repository spec that ships with the migration.**

The repository's runner `test/support/run-e2e-as-runtime-role.ts` provisions
the role **after** all migrations have been applied, so it cannot reproduce
R-10's production order. It also exits silently on Windows: `spawnSync('npx')`
runs without a shell.

The spec for this migration must therefore follow the order this review used:
1. Migrate a throwaway database up to the migration *before* R-02.
2. Provision both templates.
3. Apply R-02.
4. Assert the function privileges.
5. Connect **as the runtime role**, assert `rolsuper = false` and
   `rolbypassrls = false` in the first statement, and run the matrix.

`test/support/isolated-database.ts` can host the throwaway database. It too
spawns `npx`, so it needs the same Windows fix, or the spec runs on Linux CI
only.

| Test | Status in this review | Fidelity notes |
| --- | --- | --- |
| R-10 (grant in production order) | **Verified** (§11.2) | Provisioned before migrating; also re-ran both templates afterwards |
| R-16 (soft-deleted link) | **Verified** (F12 hidden from P1) | — |
| R-17 (patient upload later linked) | **Verified** (F13 hidden from P1) | — |
| R-18 (`self` scope; definer sees link rows) | **Verified** (U cannot see F8 or F9) | The runtime role's own RLS would hide the link rows under `self`; denial proves the definer read them |
| R-19 (`DELETE … RETURNING`) | **Verified** | Plus the R-15 and bare-UPDATE probes |
| R-20 (positive grant to the runtime role) | **Verified** | Plus negatives for maintenance, retention, an unrelated role and PUBLIC |
| R-21 (non-patient `self` scope keeps own upload) | **Verified** (N1 sees F15) | — |
| R-22 (only four policies on `files`) | **Verified on the migrated database** | Must be re-run against **production** before applying (§10.2); a migration cannot prove it for an environment it hasn't seen |
| R-1 to R-9, R-11 to R-15 | **Verified** (§11.6, §11.7) | Staff scope was tested with reception R1. R-14 (anonymous) is unchanged |

**Not covered here:**
- the API-level e2e spec (`test/patient-file-access.e2e-spec.ts`), which
  covers the application layer and ran earlier, 24/24;
- concurrency;
- an owner role that is not a superuser. In this container `medora` is a
  superuser. In production the owner "need not be a superuser"
  (`DATABASE_ROLES.md`), but it owns the tables, and owners bypass non-FORCE
  RLS, so the definer reads are unaffected. Requires external validation of
  the production owner's attributes.

### 11.9 Remaining uncertainties and conditions

1. **Production owner and catalog state** (external validation). Before
   applying, run in production:
   - the §10.2 policy-list check;
   - `SELECT proacl FROM pg_proc WHERE oid = 'app_rls.file_in_my_conversation(uuid)'::regprocedure`,
     which must list the runtime role and must not list PUBLIC;
   - `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '<owner>'`,
     where the owner must own `files` and the three link tables.

   The migration aborts by itself only in the PUBLIC case. An empty grantee
   set would mean `files_read` is already failing for the runtime role.
2. **Failed-migration recovery.** With explicit `BEGIN`/`COMMIT` the database
   stays consistent, but Prisma marks the migration failed. The deploy runbook
   needs `prisma migrate resolve --rolled-back <name>` before a retry.
3. **Maintenance template blanket grant.** Re-running
   `provision-audit-maintenance-role.sql` grants the maintenance group EXECUTE
   on the helper. This is harmless, pre-existing behaviour, but not least
   privilege. Fixing it is a separate template change.
4. **Residuals accepted by design:**
   - relabelling of a patient's own unlinked uploads (§11.6);
   - clinical files attachable to messages at the database level (§6.1);
   - a relabelled clinical file that was never linked looks public to
     everyone. That is pre-existing, the same before and after, and fixed only
     by a kind-immutability trigger.
5. **The trust model** (§11.3). The runtime role sets its own RLS context.
   R-02 protects against application paths running under a patient context,
   not against a compromised runtime role.
6. **Per-row cost.** Not benchmarked here: the fixtures are tiny. A
   non-patient caller pays one `users`/`roles` lookup per candidate row; a
   patient caller pays up to three more indexed probes. Measure with
   `EXPLAIN ANALYZE` on a production-sized `files` table.
7. **§9 (`clinical_visible` / `clinical_writable`)** is unchanged and
   separate.

**Recommendation: APPROVABLE.** The revision 3 SQL in §11.4 closes every
patient read path proven open in §11.6. It preserves non-patient access
row for row, grants least privilege, is atomic under Prisma with explicit
`BEGIN`/`COMMIT`, and rolls back exactly.

Approval should be conditional on:
- (a) running the §11.9.1 production checks before apply;
- (b) shipping the runtime-role spec with the production-order setup in
  §11.8;
- (c) adding the `migrate resolve` recovery step to the deploy runbook.

## 12. Implementation (approved 2026-11-27) and evidence

The owner explicitly approved the revision 3 migration (§11), subject to the
three conditions in §11.9. This section records what was built and the
evidence for it.

### 12.1 Files

| File | Change |
| --- | --- |
| `backend/prisma/migrations/20261127120000_r02_patient_clinical_files_deny/migration.sql` | **New migration.** The §11.4 forward SQL, verbatim, under an explanatory header. It is the only migration added; no existing migration and no Prisma schema file changed. |
| `backend/prisma/rollbacks/20261127120000_r02_patient_clinical_files_deny.down.sql` | **New.** The §11.4 rollback SQL. Prisma never reads this folder, and the runbook says how to ship it as a new migration if ever needed. |
| `backend/prisma/roles/r02-preapply-check.sql` | **New.** The §11.9.1 checks as one read-only script with tokens. It raises on the first failure (condition 1). |
| `backend/test/rls-patient-clinical-files.e2e-spec.ts` | **New.** The production-order, restricted-runtime-role spec (condition 2), §12.3. |
| `docs/multi-hospital/DATABASE_ROLES.md` §5 | Steps 6–8 added: run the pre-apply checks, recover a failed migration with `prisma migrate resolve`, and ship the rollback (condition 3). |
| `backend/src/modules/files/services/files.service.ts` | **Correction, §12.2:** a patient's upload of a clinical kind is refused with a 422 before storage. |
| `backend/src/modules/files/services/file-access.service.ts` | Exports the two existing constants for that refusal, and updates the comment that said the DB change was pending. No behaviour change. |
| `backend/test/patient-file-access.e2e-spec.ts` | The three uploader-shortcut cases now expect 422 with no row created. A new case checks that a clinical-kind row which a patient uploaded *before* the refusal still reads 404. The header comment is updated. |

### 12.2 Correction found during implementation

Running the file suites **as the restricted runtime role** after applying the
migration showed that a patient's `POST /files` of `patient_document`,
`record_attachment` or `lab_attachment` returned **500**, Prisma `P2039`.

The cause is in PostgreSQL. `INSERT … RETURNING` requires the new row to pass
the SELECT policy, and under R-02 a patient may not see a clinical-kind row,
**including their own upload**. That is exactly the approved rule: denial
"regardless of uploader ownership".

The application now refuses such an upload up front, with
`422 validation_error` on `kind`, before the object store is touched. This is
the "R-02b" recommendation of §4, now required by the approved migration.
Without it, the route would answer 500 in production.

It does not widen anything. Patients have no legitimate need for these kinds:
the patient app never calls `/files` (§4), and patient photos go through
`/me/profile/photo`.

### 12.3 The production-order runtime-role spec

`test/rls-patient-clinical-files.e2e-spec.ts` does the following:
1. Creates `medora_test_r02files_<tag>` next to the disposable `medora_test`
   (guarded like `isolated-database.ts`).
2. Applies every committed migration **before** R-02, one file per query.
   It uses `pg` rather than `spawn npx`, so the spec also runs on Windows.
3. Provisions both real templates with unique role names. The maintenance
   group name is substituted too, so parallel specs never collide.
4. Runs the pre-apply checks, which must pass. It then proves they fail closed
   on each bad state, each inside a rolled-back transaction: an extra
   restrictive policy (check 1), PUBLIC execute on the conversation helper
   (check 2), and FORCE RLS on a link table (check 3).
5. Asserts the 15-file baseline matrix. That is every bypass of §11.6, which
   proves the fixtures exercise them.
6. Runs the guard test: with PUBLIC granted execute on
   `file_in_my_conversation`, the migration aborts with "grant set is
   undeterminable", and the catalog snapshot is unchanged.
7. Applies the **committed migration file** and asserts least privilege. The
   runtime role can execute the helper; the maintenance group and its login
   cannot. The ACL is exactly {owner, runtime}. The helper is
   SECURITY DEFINER with `search_path=pg_catalog, pg_temp`.
8. Asserts the after-matrix: patients see only F7 and F10, and every
   non-patient context is unchanged. Every read is made **as the runtime
   role**, and the first test asserts `current_user` = the runtime role with
   `rolsuper = false` and `rolbypassrls = false`.
9. Runs the write-path probes: `UPDATE … RETURNING`, `DELETE … RETURNING`,
   and a bare `UPDATE … RETURNING` all reveal nothing.
10. Checks that the helper tells a non-patient caller nothing.
11. Runs the rollback from the committed `.down.sql`. The catalog snapshot is
    byte-identical to before, and the matrix is back to the baseline. It then
    re-applies the migration, and the matrix is back to the after state.
12. Teardown drops the database and the three roles. No roles or databases
    remain afterwards (checked).

### 12.4 Test results (local, throwaway PostgreSQL 16 and Redis 7 containers; no project or shared database)

All runs used containers created for this pass and removed afterwards. CI was
not run.

| Check | Command / method | Result |
| --- | --- | --- |
| New spec | `npx vitest run test/rls-patient-clinical-files.e2e-spec.ts` | **9/9 passed**. The first run caught a bug in the check script (`polcmd` is `"char"`), fixed in this pass |
| Prisma applies the migration | `prisma migrate deploy` on a fresh `medora_test` | `Applying migration 20261127120000_r02_patient_clinical_files_deny`, then "All migrations have been successfully applied". On a fresh environment the helper ACL is `{medora=X}`; the template provisioned afterwards grants the runtime role |
| Drift | `npm run db:check` (with a throwaway shadow database) | **No difference detected**, exit 0 |
| Regression, owner connection | 13 files: the new spec, patient-file-access, files, lab-attachments, message-attachments, messaging, patient-documents, profile-photo, record-attachments, clinical-standing-allowlist, rls-app-runtime, rls-runtime-role, rls-inventory | **267 passed, 2 failed**. Both failures are the known Windows-only ones (`rls-inventory` CRLF; one `rls-runtime-role` case, `spawn npx ENOENT`) and failed identically in the full backend run before R-02 |
| Regression, **as the restricted runtime role** | The 9 file and messaging suites through the runtime-role runner (scratch copy with `shell: true`) | **212/212 passed** after the §12.2 correction. Before it: 4 failed, the 3 patient-upload 500s plus one `ECONNREFUSED` connection drop under load, which did not recur |
| Recovery runbook | A probe migration failing inside `BEGIN`/`COMMIT`, deployed through Prisma on a clone | Database unchanged → `P3009` blocks the next deploy → `migrate resolve --rolled-back` → fixed migration deploys |
| Backend gates | `npm run typecheck`, `npm run lint`, `npm run build` | all exit 0 |
| Full backend suite | — | **Not re-run** in this pass; only the suites above. The last full run (before R-02) is in the audit report |
| Patient app, frontend | — | Not run: no code changed there |

### 12.5 Pre-apply checks: status per environment (condition 1)

| Environment | Executed? | Result |
| --- | --- | --- |
| Throwaway production-order database (the spec) | Yes, every run | Pass, and each check proven to fail closed |
| **Production** | **No: not executable from here** | No production database connection exists in this repository or on this machine (every configured `DATABASE_URL` is `localhost`; CI uses its own service database). It must be run by the operator, as `DATABASE_ROLES.md` §5 step 6 says, before the deploy that applies this migration. A failure means stop. |

### 12.6 Remaining blockers and notes

- **Production pre-apply checks** (above): operator action, required before
  deploy.
- **CI has not run** on any of this. It needs the owner's authorisation and
  working GitHub Actions billing. `rls-patient-clinical-files.e2e-spec.ts`
  runs in the ordinary backend job; it needs a superuser test owner and
  CREATEDB/CREATEROLE, which the CI PostgreSQL service has.
- **Still open, unchanged and out of scope:**
  - §9 (`clinical_visible` / `clinical_writable`);
  - ADR-031;
  - the residuals in §11.9.4: relabelling of a patient's own unlinked
    uploads, clinical files attachable to messages, and unlinked relabelled
    files;
  - the maintenance template's blanket function grant (§11.9.3);
  - the per-row cost benchmark (§11.9.6).
- **Not committed.** The work is in the working tree of
  `claude/patient-app-end-to-end` on top of `4c34ac7`, awaiting the owner's
  instruction.
