# Backend → frontend contracts, by branch

**What this is.** The frontend's reading of what the API serves, **on which branch**, and what each
contract unblocks in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md). It is
frontend-owned documentation: nothing here changes, promises or verifies backend behaviour.

**What it is not.** Not the API contract — that is `backend/docs/BACKEND_API_CONTRACT.md` (on
`backend`, ahead of `main`'s copy). Not the FE-10 integration log — that is
[`docs/FE-10-INTEGRATION-STATUS.md`](../FE-10-INTEGRATION-STATUS.md), which records the routes the
web client already calls on `main`. Where this file and the backend source disagree, **the source
wins** and this file is corrected.

**How it was produced.** Read from source, not from commit messages or PR titles: route decorators
and Zod schemas in `backend/src/modules/**`, the generated route × role table
`backend/test/authz-route-matrix.snapshot.txt` (RM M34.2, PR #97), and
`backend/docs/FRONTEND_DECISION_REQUIREMENTS.md`. Route inventories were extracted per branch by
script from `@Controller`/`@Get|@Post|@Patch|@Put|@Delete` decorators. **Nothing was run against a
live API** (the global caveat G-1 of the checklist §13 applies to every row).

---

## A. Revisions inspected — 2026-10-25

*Re-read the same day for the completion sprint (checklist §21): `backend` still `7ed7e4d`, `main` still
`f4a9e8d`, `frontend` now `02dd6fe` (PRs #106, #107). The divergence below is unchanged except
`frontend`, now 7 behind / 27 ahead.*

| Branch | SHA | Date | Routes served (decorator count) |
| --- | --- | --- | ---: |
| `main` | `f4a9e8d` | 2026-10-23 — merge of PR #85 | 162 |
| `frontend` | `f798830` | 2026-10-25 — merge of PR #105 | 162 (its `backend/` tree is byte-identical to `main`'s) |
| `backend` | `7ed7e4d` | 2026-10-24 — merge of PR #101 | **286** (matches the M34.2 snapshot's 286 lines) |

**Divergence**, measured with `git rev-list --left-right --count origin/main...origin/<b>`:

| Branch | Behind `main` | Ahead of `main` |
| --- | ---: | ---: |
| `frontend` | 7 | 23 |
| `backend` | 107 | 90 |
| `Database` | 398 | 5 |
| `Ai` | 104 | 18 |
| `patient-app` | 112 | 0 |

`frontend` and `backend` share no commit newer than `f21eca0` (`git merge-base`); neither has
merged the other since. **124 routes exist only on `backend`.** None exists only on `main`.

> **The `CLAUDE.md` branch-state table (measured 2026-09-03 at `cc8d455`) is stale** — it shows
> `backend` 3 ahead / 0 behind. Its own instruction applies: measure, do not trust it.

### Backend PRs merged since the last backend reading in the checklist

The checklist's last backend reading (§13.3, 2026-10-24) cited PRs #89, #90, #91, #94 and #101.
Everything merged to `backend` since `849a51b` (PR #81):

| PR | Head commit | What | Reaches `main`? | Recorded in the checklist before this pass? |
| --- | --- | --- | --- | --- |
| #86, #96 | `744f224`, `1848659` | Test clock pinning (M27.1) | No | n/a (tests) |
| #87 | `e1a7a4f` (merge) | **M7.3** — `POST /patients/{id}/reveal`, atomic with its audit row | No | **No** |
| #88 | `75a8f26` (merge) | **M12.5** — record attachments via `POST /files`, scan-gated download | No | **No** |
| #89 | `acc2c7e` | BR-DEC-001 — chart-note author check | No | Yes |
| #90 | `2eb3b87` | BR-DEC-004 — record-edit author check + reason | No | Yes |
| #91 | `17ddda2` | BR-DEC-002 — `DELETE /prescriptions/{id}` (draft) | No | Yes |
| #92 | `c394165` | **M37.1** — Helmet headers, verified CORS, dependency audit | No | **No** |
| #93 | `3a4ea28` | M25 status reconcile (docs) | No | No |
| #94 | `8d9b655` | BR-DEC-005 — clinic timezone + stranded report | No | Yes |
| #97 | `5fa1b90` | **M34.2** — every real route driven against every role | No | **No** |
| #98 | `69e4a2c` | **BR-DEC-006 part 4** — staff messaging verified for reception, laboratory, pharmacy | No | **No** |
| #99 | `d7cd5fc` | Roadmap reconcile (docs) | No | No |
| #100 | `4060c77` | Test isolation in the shared database | No | n/a (tests) |
| #101 | `0ee2a79` | BR-DEC-003 (part) — persisted reasons | No | Yes |

PR links: `https://github.com/Fares7324/smart-healthcare-assistant-system/pull/<n>`.

**Nothing above is on `main`.** Every BR-DEC route the web client already consumes on `frontend`
(PRs #102–#105) answers only when the API is built from `backend`; built from `main`, those calls
fail (404 for a route, or the field is absent and the client falls back — see §C).

---

## B. Contract inventory

Notation: **Who** is the guard from the M34.2 snapshot (`A`dmin `D`octor `R`eception
`L`aboratory `P`harmacy pa`T`ient `N`urse). The guard is *one* of two checks: many services add a
second (care scope via `PatientScopeService`, `requireDoctor`, participant membership, author).
**Where** is `main` (and therefore `frontend`'s tree) or `backend` only. All paths are under
`/api/v1`. Envelope (`backend/src/common/http/response.interceptor.ts`, `all-exceptions.filter.ts`, identical
on both branches): success bodies are `{ data }`, and a paginated list is
`{ data: { items, page, pageSize, totalItems, totalPages } }` (`readPage`, `frontend/src/api/http.ts`);
errors are `{ message, code, fieldErrors?, detail?, ref? }` with the HTTP status, which
`frontend/src/api/errors.ts` already maps. 204 answers have no body.

### B.1 Already consumed by the web client (all on `main` unless marked)

`docs/FE-10-INTEGRATION-STATUS.md` holds the per-route detail. The web client calls exactly these
families, all of which `main` serves: `/auth/*`, `/me/{account,activity,availability,devices,
login-history,password,profile,sessions,time-off,2fa/*}`, `/appointments/*`,
`/admin/appointments/*`, `/admin/users/*`, `/doctors/*`, `/dashboard/doctor/action-queue`,
`/lab-orders/*`, `/lab-tests/catalogue`, `/medical-records/*` (create, read, versions, notes,
sign, status, report-issue, `PATCH`), `/medications/*`, `/notifications` (feed, read, unread,
read-all, badge-counts), `/patients/*` (list, register, profile, tabs and their writes),
`/prescriptions/*`, `/roles*`. **Backend-only routes** called: `DELETE
/prescriptions/{id}` (PR #104, BR-DEC-002), and — with NEW-24 — `POST
/notifications/{id}/{archive,favorite,pin}`, `POST /notifications/clear-read` and `GET`/`PUT
/me/notification-preferences`; with §3.1 pulse (2026-10-25) `GET /dashboard/doctor/{trends,
satisfaction,recent-activity}` and, with §3.1 widgets, `/kpis`; with NEW-30 (2026-10-25)
`GET /dashboard/doctor/critical-alerts`; with §3.12 (2026-10-25) `GET /me/settings`, `PATCH
/me/settings/privacy` and `POST /me/integrations/{id}/disconnect`; with §3.11 (2026-10-25) `GET
/reports/{analytics,insights,saved,scheduled}`, `POST /reports/{saved,scheduled}`, `PATCH
/reports/scheduled/{id}` and `DELETE /reports/{saved,scheduled}/{id}`. **Backend-only fields** read with a fallback:
`clinicTimezone` and `stranded[]` on `/me/availability` (PR #105).

### B.2 BR-DEC routes — on `backend` only

| Route | Purpose | Who · second check | Request | Response / errors | Unblocks |
| --- | --- | --- | --- | --- | --- |
| `PATCH /patients/{p}/notes/{n}` · `POST …/sign` | Edit / sign an unsigned chart note | `ADRLP` `patients.view` · care reach · **author** (`authorId` in the `updateMany` predicate) | edit: `{ body }` | 403 `not_note_author` before 409 `invalid_status_transition` | §3.3 notes (BR-DEC-001) — consumed |
| `PATCH /medical-records/{r}` | Edit a draft/active record | `D` `records.edit` · care reach · **author** | changed fields + `reason?` (≤300, trimmed) | 403 `not_record_author`; 409 `record_not_editable`; 422 `no_effective_change`; `reason` returned on `GET …/versions` | NEW-12 (BR-DEC-004) — consumed |
| `DELETE /prescriptions/{rx}` | Discard the caller's own unsigned draft (soft delete, ADR-044) | `D` `prescriptions.create` · prescriber | — | 204; 409 `prescription_not_draft`; 404 for anyone else's | NEW-10 discard (BR-DEC-002) — consumed |
| `GET`/`PUT /me/availability` | Weekly grid | authenticated · `doctors` row | `PUT`: the week | adds `clinicTimezone` (IANA) and, on `PUT`, `stranded[]` computed in that zone (report mode) | NEW-08 (BR-DEC-005) — consumed |
| `DELETE /patients/{p}/history/{e}` | Soft-delete a history event | `ADRLP` · care reach | `{ reason }` **required** (≤300) | 422 without; removed rows hidden from every read | NEW-04b removal (BR-DEC-003) — consumed |
| `DELETE /patients/{p}/emergency-contacts/{c}` · `PATCH …/alerts/{a}` `{active:false}` | Remove contact · resolve alert | `ADRLP` · care reach | `reason?` | reason persisted | NEW-04a (BR-DEC-003) — consumed |

**Still not served (BR-DEC-003):** a history-correction route (point 1), a read of removed or
superseded entries (point 4); the who-may rule (point 5) is the owner's.

### B.3 Other backend-only contracts relevant to open checklist rows

| Route(s) | Purpose | Who · second check | Key request rules | Response / gates | Checklist rows | Frontend reading |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /notifications/{id}/archive` · `/favorite` · `/pin` | Set one flag explicitly | authenticated · recipient = caller (404 otherwise, indistinguishable) | `{ value: boolean }`, default `true` — **not a toggle** | 204 | §3.10 (archive/pin "no route") | **Connected — NEW-24** |
| `POST /notifications/clear-read` | Archive every read, unarchived row | authenticated | — | `{ archived: number }` | §3.10 "clear all read" | **Connected — NEW-24** |
| `GET /notifications/summary`; `GET /notifications?q=` | Summary cards; free-text filter (1–120 chars, trimmed) | authenticated | — | — | §3.10 | Usable; not required |
| `GET`/`PUT /me/notification-preferences` | Channels, quiet hours, category opt-ins | authenticated · self | `PUT` is the **whole document**; `categories.security` is `z.literal(true)` (422 otherwise); times `HH:MM` 24 h | `GET` returns column defaults, never 404 | §3.12 notification prefs ("no route", MOCK_ONLY) | **Connected — NEW-24** (same shape as the web client's `NotificationPreferences`) |
| No `DELETE /notifications/{id}` | — | — | — | — | §3.10 delete | **Not served** on any branch |
| `POST /patients/{p}/reveal` | Reveal a masked identity | `AD` `patients.revealIdentity` | `{ category: clinical-review \| patient-request \| safety-investigation \| billing-dispute \| legal-request, reason: 12–500 }` | `{ patientId, fullName, mrn, email?, phone, dateOfBirth, revealed: true, revealedAt }`; **503 `audit_unavailable`** with no identity if the audit row cannot be written (same transaction, `TransactionalAuditWriter`) | ADM-10 (server enforcement), ADM-04 | Server half of ADM-10 now exists on `backend`. The admin directory (ADM-04) is still `MOCK_ONLY`: account governance (M10.7) is not built and the directory must be hospital-scoped (API-W07, OD-07) |
| `POST /files` · `GET /files/{id}` · `…/download` · `DELETE /files/{id}` | Upload (per-kind type/size rules, server checksum), metadata, signed download | authenticated | multipart | download **403 `scan_pending`** until `scan_result = 'clean'` | D-04b, NEW-13, record attachments | **Not usable end to end:** no scan engine is bound (M25.3 PARTIAL), so every upload is undownloadable; `S3FileStorage` exists but no object store is configured (M25.2 PARTIAL, RA-M25.1) |
| `POST /medical-records/{r}/attachments` · `GET …/attachments/{a}/download` | Link an upload (kind `record_attachment`) to a record; download | `D` `records.edit` (link) · `DL` `records.view` (download) · care reach | `{ fileId: uuid, kind: <5 kinds>, name?: ≤200 }` | `attachment-added` timeline event; download 403 `scan_pending` / infected; else a signed **60 s** URL, audited `file.download` | D-14 / §3.8 attachments | Same scan-gate blocker as `/files` |
| `/conversations*`, `/messages/search`, `/attachments/{a}/download` | Messaging (M20) | `ADRLP` `messages.send` · **participant** (404 for a thread you are not in) | create: `{ participantIds: uuid[1..50], topic?, patientId? }`; send: `{ body: 1–16000, attachmentIds?: ≤10 }` | — | D-24 / §3.9, staff workspaces | **Blocked for the web client:** no route lists who a user may message (a picker would need user UUIDs it cannot obtain), the staff participant rule is open (API-W09), and the module is single-tenant (AF-34). Verified for the three staff roles by PR #98 |
| `/admin/conversations*`, `/admin/message-flags*` | Oversight (M20.7) | `A` (metadata also `DR`) | access request: `{ justificationCategory: complaint\|safety\|legal\|audit, … }` | content read audited in the same transaction | ADM-06 | Single-tenant; API-W09 |
| `/administration/*` (50 routes) | Administration Center (M23), jobs (M30) | `roles:admin` | — | — | AC-01…AC-16 | Single-tenant; API-W05 (hospital-scoped) not built |
| `/audit-events*`, `/me/incident-bookmarks*` | Audit ledger (M28) | `A` `logs.view` / `logs.export` | — | — | ADM-07 | Single-tenant; API-W10 |
| `/platform-settings*` | Platform settings (M24) | `A` | — | backups restore answers 501 | AC-14, ADM-09 | Platform-admin console is ORG-03 / API-W13 |
| `GET /dashboard/doctor/trends` · `/satisfaction` · `/recent-activity` | Overview widgets (M27.2) | `DL` `records.view` · every row scoped to the caller's own `doctors` row; no row → empty answers, never 403 | none | trends: `[{ day: YYYY-MM-DD, completed, cancelled }]` × 14, every day present; satisfaction: `{ total, average, buckets: [{ rating 1–5, count }] × 5 }` for the current UTC month; recent-activity: `[{ id, kind: note-signed\|prescription-issued\|lab-released, at, text }]`, ≤ 8, newest first, `id` an internal row id (not routable). "Today" is the server's UTC day | §3.1 pulse | **Connected — §3.1 pulse** (filed as NEW-25, retired). Loaded apart from the core; 404 = no source, other failures fail one widget |
| `GET /dashboard/doctor` · `/kpis` · `/schedule` · `/critical-alerts` | Composite, KPI counts, today's book, Row-0 banner (M27.1–M27.3) | `DL` `records.view` | — | `/kpis` adds `completedWeekDelta` and `nextAt`; no consultation length, response time or no-show rate anywhere | §3.1 widgets | **`/kpis` connected for one tile** (2026-10-25): "Completed this week" takes `completedWeek` and `completedWeekDelta` from it, falling back to the summary with no comparison on a 404 or failure. **`/critical-alerts` connected — NEW-30** (2026-10-25): the Overview's Row-0 banner, on its own query; a 404 shows nothing (nothing was checked), any other failure shows "Couldn't check for critical alerts", an unknown kind fails the answer, links are rebuilt from the client's routes per kind. An `allergy-conflict` alert carries no patient id, so it links to the day's book. The composite and `/schedule` are not wired: the other KPIs and the schedule are served on `main` by `/appointments/*` |
| `GET /reports/analytics` · `GET /reports/insights` | Snapshot and insights (M21.1–M21.2) | `DR` `appointments.manageOwn` · every figure keyed on the caller's own `doctors` row; no row → empty snapshot | `category` (9), `range` (6, default month), `from`/`to` `YYYY-MM-DD` (both **required** for `custom`, 422 otherwise), `compare`, `gender`, `ageBand` — **no** department, status, medication or lab test; insights take the period only | analytics: the frontend's `AnalyticsSnapshot` with every member present (charts outside the category empty), `kpis` without `icon`, `billingEnabled: false`; **`category=revenue` answers the alternate** `{ alternate: 'top-visit-types', notice, topVisitTypes, range }` (ADR-037 §3). Insights: seven kinds, tone by direction. Days are UTC | §3.11 | **Connected — §3.11.** Only applied filters offered |
| `GET`/`POST /reports/saved` · `DELETE /reports/saved/{id}` | Saved reports (M21.3) | as above · own `owner_id` (404 for anyone else's) | `POST`: `{ name 1–120, category, range, favorite, filters: ReportFilters }` (filters validated whole) | 201 with the row; `lastViewedAt` nullable; **no rename, favourite-toggle or "viewed" route** | §3.11 | **Connected — §3.11** (save, duplicate as create, delete; filed as NEW-28, retired) |
| `GET`/`POST /reports/scheduled` · `PATCH`/`DELETE /reports/scheduled/{id}` · `GET …/{id}/runs` | Scheduled reports (M21.4) | as above · own `owner_id` | `POST`: `{ name, category, frequency, format (default pdf), recipients: email[1..20] }` (lower-cased); `PATCH`: `{ status: active\|paused }` — sets, not toggles | `nextRunAt` computed at creation's time of day; history `sent\|failed`. **The executor `reports.scheduled-run` is registered blocked** (no mail attachments, ADR-025; links refused by the M25.3 scan gate): **nothing is ever sent** | §3.11 | **Connected — §3.11**; the panel says nothing is sent |
| `POST /reports/export` | Synchronous export (M21.5) | as above | `{ category, format: csv\|excel\|pdf, range, from?, to? }` | CSV bytes (not enveloped) of the same snapshot; excel/pdf **501** | — | Not used: the client's engine exports every format from the snapshot on screen |
| `GET /me/settings` · `PATCH /me/settings/{privacy\|preferences\|appearance\|accessibility}` | Settings Center (M22.1–M22.2) | authenticated · self (`@Authenticated()`, the token's subject is the document) | `PATCH`: `{ updatedAt: ISO, value }` — `updatedAt` **required**; `value` the whole slice (privacy: `dataSharing, analytics, cookies, aiDataUsage`, all boolean); unknown section 404 | `GET` returns defaults, never 404; one `updatedAt` = later of `user_settings` and `user_interface_preferences`; stale `updatedAt` → **409** "These settings changed since you loaded them"; 422 per field; answers the re-read document; privacy writes also emit an audit event (field names only) | §3.12 privacy | **Connected — §3.12** (privacy only; filed as NEW-26, retired). `preferences`/`appearance`/`accessibility` not read: those stay per browser |
| `POST /me/integrations/{google-calendar\|outlook\|zoom\|teams}/connect` · `/disconnect` | Integrations (M22.3) | authenticated · self | — | connect: **501 `not_implemented`** always (no OAuth client, RA-M22.1); disconnect: clears tokens, records activity, answers the document; unknown id 404 | §3.12 integrations | **Read + disconnect connected — §3.12** (filed as NEW-27, retired). Connect withheld |
| `POST /me/data-export` | Own-data export (M22.4) | authenticated | — | **501** (needs M30 jobs + M25 storage) | — | Not used; the client-side JSON download stays |
| `/search` | Role-scoped global search (M26) | authenticated | — | — | D-26 | API-W14 (hospital scope) |
| `/meta/enums`, `/prescriptions/summary` | Enum catalogue; Rx KPI | authenticated / `D` | — | — | — | Not required by any open row |

### B.4 Not served on any branch

Lock-screen re-authentication (A-12a); a drug reference dataset or typeahead (D-18); an imaging
source (D-05); lab annotations (D-15); pharmacy list/view/dispense, reception booking on behalf of
a doctor, lab-technician scoping (BR-DEC-006 parts 1–3); history correction and a removed-entry read
(BR-DEC-003 points 1 and 4); notification delete; hospital/employment in the session (API-W01 as
superseded by DR-02/DR-08); any hospital-scoped route (Phases 21–26).

---

## C. Changes since the previous reading, and their frontend impact

| Change | Before | Now (on `backend`) | Frontend impact | Tests that would verify integration |
| --- | --- | --- | --- | --- |
| **M19 notification flags + clear-read** (pre-dates PR #81, never connected) | Web client declared them "no route" and hid archive, favourite, pin and "clear all read" in live builds | Served, explicit `{ value }` | **Done (NEW-24):** connected in the HTTP adapter; `remove` split into delete (still unserved) and `clearRead` | Adapter contract tests per route and body; UI shows the controls live; a refusal rolls back |
| **M19.4 preferences** | Live builds showed "Notification preferences — not connected yet" | Served; defaults on first read | **Done (NEW-24):** read and written through the notifications port; serialised whole-document writes | Adapter: `GET`, whole-document `PUT`, `security` always `true`; UI: failure keeps the previous value |
| **M7.3 reveal** (#87) | No server reveal; ADM-10 was client-only | Audited, atomic reveal; 503 without identity when audit fails | ADM-10's server half exists. No UI change in this pass: the admin directory is not connected (M10.7) and must be hospital-scoped first | Reveal shows identity only on 200; 503 shows nothing |
| **M12.5 record attachments** (#88) | Lab report attach only (`/lab-orders/{id}/attach-to-record`) | Any uploaded file can be linked; download scan-gated | None usable yet — no scanner bound, so downloads are always 403 | Upload → link → 403 `scan_pending` shown as "awaiting malware scan", never as a broken file |
| **M37.1 headers / CORS** (#92) | Helmet absent; CORS unverified | `default-src 'none'`, `frame-ancestors 'none'`, exact-origin credentialed CORS | None for the SPA: its origin must be in `CORS_ORIGINS` (deployment config, as before); downloads are presigned URLs on the store's host | Live run only |
| **M34.2 route × role table** (#97) | Hand-maintained matrix | Generated snapshot of all 286 routes | A reliable source for the guard half of every row in §B | — |
| **BR-DEC-006 part 4** (#98) | "Staff messaging: empty scaffold" (DEC-006 record) | Reception, laboratory and pharmacy reach `/conversations` | DEC-006a's "messaging unavailable" statement stays true for the web client: no recipient lookup, participant rule open (API-W09) | — |

**Unresolved assumptions.** (1) That `backend` → `main` will carry the BR-DEC routes unchanged; the
client already depends on four of them. (2) That the 404 a `main`-built API gives for the new
notification routes is acceptable in the interim, as it was for `DELETE /prescriptions/{id}`: the
client reports the failure and changes nothing.

---

## D. Security and clinical constraints

| Constraint | Status | Where |
| --- | --- | --- |
| Chart-note edit/sign: author only | **Confirmed — `backend` only** | `patient-tabs.repository.ts` `updateUnsignedNote`/`signNote` predicate; `patients-tabs.e2e-spec.ts` |
| Record edit: author only; reason kept per version | **Confirmed — `backend` only**; mandatory-reason and other roles are the owner's | `record.service.ts`; `medical-records.e2e-spec.ts` |
| Record-note sign: author only; signed notes immutable (no update route) | **Confirmed — `main`** | `RecordService.signNote` (403 `not_note_author`) |
| Prescription draft discard: prescriber's own, unsigned only | **Confirmed — `backend` only** | ADR-044; `prescription.service.ts` |
| History removal: mandatory reason, soft delete | **Confirmed — `backend` only** | `0ee2a79` |
| History correction (versioned) and removed-entry read | **Not implemented** | BR-DEC-003 points 1, 4 |
| Identity reveal: capability + justification + audit in one transaction; 503 with no identity on audit failure | **Confirmed — `backend` only** | `PatientService.revealIdentity`, `TransactionalAuditWriter`, `patients-reveal.e2e-spec.ts` |
| Download only after a clean malware scan | **Confirmed gate; no scanner** — every file is held | `shared/files/scan-gate.ts` `assertScanClean` |
| Notification rows: recipient only; 404 indistinguishable for others' | **Confirmed — `main`** (flags on `backend`) | `notification.controller.ts` |
| `categories.security` cannot be switched off | **Confirmed — `backend` only** (schema literal + DB CHECK) | `notification.schema.ts` |
| Quiet hours never suppress a critical lab alert | **Confirmed — `backend` only** (applied at send time) | `channel-selection.ts` |
| Thread existence hidden from non-participants (404) | **Confirmed — `backend` only** | `conversation.controller.ts` |
| Hospital isolation on any route | **Not implemented** on any branch — every route is single-tenant | `docs/multi-hospital/AUDIT_FINDINGS.md` AF-34; Phases 21–26 |
| No client-side hospital switcher; context server-derived | **Owner decision** DR-08 | `docs/multi-hospital/OWNER_DECISIONS.md` |
| Staff messaging participant rule | **Proposal awaiting backend** (API-W09) | checklist §9.1 |

Client checks in the web app are display rules. The server is the boundary in every row above.
