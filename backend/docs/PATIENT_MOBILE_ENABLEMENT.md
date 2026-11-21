# Medora — Patient Mobile Backend Enablement

**Purpose:** the focused backend sequence that unblocks the Patient Mobile client, and the verified state it starts from.
**Scope:** this is **not** the backend roadmap. `BACKEND_IMPLEMENTATION_ROADMAP.md` remains the overall plan (M0–M43); this document selects the shortest safe path through it for one goal and marks nothing else complete.
**Companions:** `PATIENT_MOBILE_API_CONTRACT.md` (the contract) · `docs/DECISIONS.md` ADR-030, ADR-031 (the decisions) · `patient-app/PATIENT_APP_AUDIT.md` (the client-side audit this reconciles against).
**Tree audited:** `e14bd7f` · **Date:** 2026-09-02

---

## 1. Verified baseline — measured, not asserted

Run against a real PostgreSQL 16 instance, on `e14bd7f`, **before any change in this workstream**. This is the reference every later claim of "Doctor/Admin behaviour is intact" is measured against.

| Gate | Command | Result |
|---|---|---|
| Migration drift | `npm run db:check` | **No difference detected** |
| Migrations | `npm run db:deploy` | **15 migrations applied** |
| Seed | `npm run db:seed` | **permissions 22 · roles 6 · departments 12 · specialties 9 · demoDoctors 5 · demoPatients 5** |
| TypeScript | `npm run typecheck` | **0 errors** |
| ESLint | `npm run lint` | **0 errors, 0 warnings** |
| Tests | `npm run test` | **44 files · 804 tests · 804 passed · 0 failed** |
| Build | `npm run build` | **success** |

### 1.1 After Phase 1 (ADR-030 implemented)

Same machine, same database, same commands.

| Gate | Result |
|---|---|
| Migration drift | **No difference detected** |
| Migrations, from an empty database | **16 applied** (the 15 above plus `20260902190000_adr030_patient_user_link`) |
| Seed | **roles 7** (was 6 — `patient` added), permissions still 22 |
| TypeScript | **0 errors** |
| ESLint | **0 errors, 0 warnings** |
| Tests | **45 files · 826 tests · 826 passed · 0 failed** |
| Build | **success** |

### 1.2 After Phases 3–4 (profile + doctor projection)

| Gate | Result |
|---|---|
| Migration drift | **No difference detected** (no schema change in these phases) |
| TypeScript | **0 errors** |
| ESLint | **0 errors, 0 warnings** |
| Tests | **46 files · 841 tests · 841 passed · 0 failed** |
| Build | **success** |

**804 → 841, none lost.** The whole pre-change baseline still passes, which is the evidence that Doctor and Administrator behaviour is untouched.

**+22 tests, −0.** The 804 baseline cases all still pass, which is the evidence that Doctor and Administrator behaviour is unchanged: `authz-matrix.e2e-spec.ts` still walks every route and finds none unannotated, and `permission-catalogue.spec.ts` still matches the frontend exactly because `PLATFORM_ROLES` was not touched. The 22 new cases are 19 in `patient-identity.e2e-spec.ts`, 2 added to `seed-parity.spec.ts`, and 1 that the existing per-role `it.each` generated for the seventh role.

**Live API surface: 4 controllers, 16 HTTP routes** (`auth`, `me/password`, `me/2fa`, `health`). Eighteen module folders contain an empty `@Module({})` each.

---

## 2. Audit reconciliation — what was re-verified, and what it missed

`patient-app/PATIENT_APP_AUDIT.md` was written against `9e4e0d3`. Every load-bearing claim was re-checked against `e14bd7f` rather than trusted.

### 2.1 Confirmed exactly as stated

| Audit claim | Verification |
|---|---|
| ADR-018 §3 "patients are records, not users" is Accepted and load-bearing | `docs/DECISIONS.md:1276` |
| `register.schema.ts:45` — `role: z.enum(['doctor','admin'])` | Confirmed, line-exact |
| Six seeded roles, no `patient` | Confirmed — seed run reports `roles 6` |
| `schema-reference.e2e-spec.ts:181` asserts no patient role | Confirmed, line-exact |
| `seed-parity.spec.ts` asserts `patient` is not seeded | Confirmed at line 104 |
| **`patients` has no `user_id` column** | Confirmed by column-by-column read of `05-patients.prisma` |
| `ConversationParticipant.userId`, `Notification.userId`, `AiConversation.userId` → `User` | Confirmed at `10-communication.prisma:54, 229, 313` |
| `X-Client-Type: mobile` refresh-in-body is built and tested | Confirmed — `auth.controller.ts:285`, `auth-refresh.e2e-spec.ts:250` |
| `GET /auth/session` specified (API §1.11) but absent | Confirmed — roadmap **M8.1 unticked**, no handler exists |
| 4 controllers / 16 routes | Confirmed by decorator count |
| No release/visibility column on any clinical table (AD-5) | Confirmed — only `lab_orders.reviewed_at/reviewed_by` exist, and they are a clinician workflow |
| No geo columns, no PostGIS, `clinic_id` absent and **tested** absent (AD-3) | Confirmed — `schema-adr010.e2e-spec.ts` |
| API §4.11 specifies patient account `unlock` / `reset-credentials` / `deactivate` | Confirmed — the contradiction with ADR-018 §3 is real |

### 2.2 Corrections to the audit

| Audit statement | Actual |
|---|---|
| Branch state per `CLAUDE.md`: "`backend` is 10 ahead of `main`" | **Stale.** `backend` is now **0 ahead / 3 behind** `main`; `main` has merged both `backend` (#82/#84) and `patient_mobile_app` (#85). `CLAUDE.md`'s branch-state table needs refreshing |
| Audited tree `9e4e0d3` | `main` is now `e14bd7f`; no backend source file relevant to this workstream changed between them |

### 2.3 The finding the audit did not make — and it changes the design

> **`PLATFORM_ROLES` is a transcription of the frontend, not a backend definition, and a CI-enforced parity spec binds it.**

`permission-catalogue.ts:8–14` states it outright — *"This file is a transcription, not a definition. The source of truth is the frontend."* `permission-catalogue.spec.ts` loads `frontend/src/features/admin/permissions.ts` at runtime and asserts equality, and `.github/workflows/ci.yml` runs the **backend** suite whenever that frontend file changes.

**Consequence:** the obvious implementation of a patient role — adding `'patient'` to `PLATFORM_ROLES` with a capability bundle — **cannot be done**. It fails the parity spec, and making it pass would require editing the frontend, which this workstream forbids. It would also be wrong on its own terms: the 22-capability matrix is the ADM-09 *administrator* matrix, and a `patient` column would make every patient a grantable principal in the clinic's staff-permission editor.

The audit recommended "a new `patient` role with an empty-by-default bundle" without noticing that the *union it would be added to* is frontend-owned. The resolution — `patient` as a seventh `roles` row with **no matrix column**, reusing the documented `nurse` precedent (ADR-029 §3), with ownership-based rather than capability-based authorization — is ADR-030 §6, and it is strictly better: a patient resolves to zero capabilities, so **every existing and future `@Can(...)` route denies them with no code written at all**.

---

## 3. The two decisions that gate everything

Both were written as PROPOSED and put to the project owner together. **One was accepted; one was deliberately left open.**

| Decision | Question | Blocks | Status |
|---|---|---|---|
| **ADR-030** — Patient Identity and Authentication (audit **AD-1**) | Do patients authenticate, and how do accounts relate to clinical records? | Everything below Phase 0 | ✅ **Accepted — project owner, 2026-09-02.** Implemented |
| **ADR-031** — Results Release Policy (audit **AD-5**) | May a patient see a critical result before a clinician reviews it? | Medical records, labs, visits, prescriptions | 🟠 **Pending clinical/product approval** |
| **ADR-033** — Patient Appointment Action Policy | May a patient cancel or reschedule their own appointment, from which statuses, and within what window? | Appointment writes, `availableActions` | 🟠 **Pending product/clinical approval** |

Two further decisions are recorded as open but do **not** block the first slice: **RA-030.1** (the account-to-record claim flow — deliberately deferred so that account creation, which is safe, is not held up by record claiming, which is an identity-proofing problem) and **RA-030.2** (patient self-service field authority, audit AD-2).

**AD-3 (multi-facility/geo) is not raised and must not be.** ADR-010 and ADR-018 §1 scope it out and a test enforces the absence of `clinic_id`. The MVP ships the single "Our Clinic" concept; multi-facility discovery is recorded as a separate scoped-out epic in the audit and stays there.

> ⚠ **Superseded 2026-10-07 by the FINAL Multi-Hospital decisions** ([`docs/multi-hospital/OWNER_DECISIONS.md`](../../docs/multi-hospital/OWNER_DECISIONS.md)). Hospital is the isolation boundary, with Clinics and multiple Locations inside it. Signed-in discovery of hospitals and doctors, with distance, is in scope (DR-01, DR-09, OD-06, OD-10). The paragraph above records the decision as it stood for the first slice.

---

## 4. The enablement sequence

Ordered by dependency, not by feature appeal. **Nothing after Phase 0 may start without ADR-030.**

```
Phase 0  Audit · ADR-030 · ADR-031 · contract        ◀── ✅ COMPLETE
            │
            ▼  ◀── ✅ ADR-030 APPROVED BY THE OWNER, 2026-09-02
Phase 1  Patient identity foundation                 ◀── ✅ COMPLETE
            ├─ migration: patients.user_id (nullable, unique, FK, SET NULL)
            ├─ seed: `patient` role, empty bundle (7th row, no matrix column)
            ├─ register.schema.ts: role enum += 'patient'
            ├─ PatientSelfScopeService (users.id → patients.id, 404-not-403)
            └─ the two tests that asserted patients are not users, inverted
            │
            ▼  ◀── next
Phase 2  M8.1 — GET /auth/session          ◀── not built (use the refresh payload)
            │
            ▼
Phase 3  M9  — patient-safe Doctor projection + forbidden-field contract test
            │                                ◀── ✅ COMPLETE
            ▼
Phase 4  M10 — GET /me/profile              ◀── ✅ COMPLETE
            │    (PATCH deliberately not built — blocked by RA-030.2)
            ▼  ◀── next
Phase 5  M11 — slots · book · cancel · confirm · list/detail (+ availableActions)
            │
            ▼
Phase 6  M19 — patient notifications       (no schema change needed)
            │
            ▼
Phase 7  M37 — rate limiting               ◀── BEFORE any public route ships
            │
            ▼
Phase 8  M12/M14 — clinical reads          ◀── ⛔ BLOCKED BY ADR-031
            │
            ▼
Phase 9  M20 messaging (if MVP) → M25 files → M16 patient AI (last, gated)
            │
            ▼
Phase 10 M39 contract alignment → M40 integration → M41 mobile API validation
```

**Why rate limiting sits at Phase 7 and not later.** None exists anywhere in the backend today (audit BE-17/R-9). It is the reason the doctor-discovery routes in the contract are specified as **authenticated rather than public**: a token puts a revocable credential and a session trail in front of a roster that would otherwise be walkable by anyone.

---

## 5. Frontend unblock status

Classification of every Patient Mobile area, as of this document.

| Area | Status | Basis |
|---|---|---|
| **Emergency** | ➖ **NO BACKEND REQUIRED — ship first** | Offline, signed-out, bundled. Numbers from operator config; never hardcoded |
| Design system, navigation, i18n/RTL, a11y, loading/empty/error states | ➖ **NO BACKEND REQUIRED** | Frontend-only |
| API transport layer, secure storage, single-flight refresh | ✅ **READY** | `X-Client-Type: mobile` refresh is built and e2e-tested today |
| Login / OTP / logout / password reset / email verification | ✅ **READY** | M6 complete and now proven end-to-end for a patient account |
| Registration (patient) | ✅ **READY** | `role: 'patient'` accepted; creates an account and no clinical record |
| Session restore (`GET /auth/session`) | 🟠 **CONTRACT — use the refresh payload meanwhile** | M8.1 unticked |
| Patient profile (read) | ✅ **READY** | `GET /me/profile` live; returns `patient: null` until a record is claimed |
| Patient profile (edit) | 🟠 **REQUIRES PRODUCT DECISION** | `PATCH` blocked by RA-030.2 — which fields may a patient own? |
| Doctor discovery | ✅ **READY** | `GET /patient/doctors`, `/{id}`, `/patient/specialties` live, behind the safe projection |
| Department filter chips | 🟠 **READY WITH MOCK DATA** | Filtering by `departmentId` works; the list endpoint belongs to M23 |
| Appointment list & detail | ✅ **READY** | `GET /me/appointments`, `/{id}` live with ownership and 404-not-403 |
| Appointment actions (book/cancel/reschedule/confirm/slots) | 🟠 **REQUIRES PRODUCT DECISION** | **ADR-033** — options and costs written up, nothing chosen |
| Notifications (feed, read state, badges) | ✅ **READY** | `GET /notifications`, `/badge-counts`, `POST …/read`, `/unread`, `/read-all` live. One model — a patient is a recipient because ADR-030 made patients users |
| Notification preferences, archive/favorite/pin | ⬜ **NOT BUILT** | M19 (API §10.2, §10.5) |
| **Medical records · Lab results · Visits · Prescriptions** | 🔴 **BLOCKED BY ADR-031 — REQUIRES PRODUCT/CLINICAL DECISION** | No release mechanism exists in the schema |
| Documents / photo upload | ⬜ **NOT MVP** | No object storage, no malware scanning (M25) |
| Messaging | ⬜ **NOT MVP** (structurally unblocked by ADR-030) | M20 unbuilt; sequencing choice |
| Push notifications | ⬜ **NOT MVP** | No provider, no registration endpoint |
| **Patient AI** | ⬜ **LATER PHASE — GATED** | No model provider; needs red-flag triage, clinical owner, output filter, audit |
| Hospital discovery / nearby / geo | 🚫 **OUT OF SCOPE** | ADR-010 + ADR-018 §1, enforced by test |

**The headline for the mobile team:** **five of the six P0 areas are live against real endpoints** — authentication (including the native token-in-body path), the patient profile, doctor discovery, the appointment list and detail, and the notification feed with its badge counts. Emergency needs no backend at all, so it can ship alongside them.

What is left is **not** engineering work waiting its turn — it is three decisions:

| Waiting on | Not on |
|---|---|
| **ADR-033** — appointment actions (cancel, reschedule, book, slots) and `availableActions` | a missing endpoint |
| **ADR-031** — medical records, labs, visits, prescriptions | a missing table |
| **RA-030.2** — profile editing | a missing form |

Build those screens against fixtures behind the mock seam. Each becomes an adapter swap once its decision lands.

**One mobile gap found during implementation, and it is worth reading before writing the transport layer:** `X-Client-Type: mobile` is honoured on `POST /auth/refresh` **only**. `POST /auth/login` issues the refresh token as a `Set-Cookie` header for every client, so a native client must read its first token out of that header. See `PATIENT_MOBILE_API_CONTRACT.md` §0.2.1. It belongs to M41.

---

## 6. Testing requirements for Phase 1 (when approved)

Beyond keeping the 804-test baseline green:

**Identity** — patient registration accepted · `patient` role seeded with an empty bundle · the `users ↔ patients` relation and its uniqueness · patient login / refresh (`X-Client-Type: mobile`) / logout · unauthenticated `/me/*` → 401.

**Authorization** — a patient reaching **any** `@Can(...)` clinician route is denied · patient A reaching patient B's data → **404, never 403** · a doctor attempting a patient-only route → denied · an unlinked account resolves to no clinical data rather than to someone else's.

**Regression** — Doctor and Admin authorization proven unchanged against the baseline; the `authz-matrix` route walk still names every handler.

**DTO security** — ✅ done. Three tests over the serialized body: forbidden **keys** absent at any depth from the list and detail responses, and forbidden **values** absent from the raw JSON (which catches a rename such as `licenseNumber` → `credentials`). The list is `FORBIDDEN_DOCTOR_FIELDS`, an assertable value rather than an omission.

**Clinical (Phase 8)** — an unreleased result must be **absent from the response**, not masked within it, under every query parameter, page and filter.

## 7. List payload-size audit (RM M41.2, 2026-11-14)

`test/list-payload-size.e2e-spec.ts` discovers every parameterless `GET` Express serves, calls each
as a doctor, an administrator and a patient against small fixtures (three charts, each with a lab
order in `processing`), and keeps the bodies that are lists. It asserts two things and measures the
rest:

- **Every paginated list refuses a page above API §0's cap** (`pageSize=101` → 422). The first run
  found one that did not: `GET /administration/staff` accepted up to 200 (default 50). It now
  follows §0 (default 20, max 100); no client called the route.
- **No JSON body carries credential material** by key name (`passwordHash`, `refreshTokenHash`,
  `previousTokenHash`, `totpSecretEnc`, `recoveryCodesEnc`, `keyHash`, `pushToken`, `configEnc`,
  `oauthTokensEnc`, `tokenHash`). None did.

Identity bytes for the lists that came back non-empty (one run, default page size; the numbers
follow the fixtures and are a baseline, not a budget — no per-item budget has been decided):

| List | Shape | Items | Bytes | Bytes / item |
| --- | --- | ---: | ---: | ---: |
| `GET /lab-tests/catalogue` | paginated | 5 | 5,062 | 1,012 |
| `GET /lab-orders` | paginated | 3 | 2,244 | 748 |
| `GET /patients` | paginated | 3 | 1,560 | 520 |
| `GET /medications` | paginated | 5 | 2,122 | 424 |
| `GET /doctors` (admin) | paginated | 10 | 4,147 | 415 |
| `GET /ai/prompts` | array | 6 | 1,800 | 300 |
| `GET /administration/audit-events` | array | 25 | 7,220 | 289 |
| `GET /patient/doctors` | paginated | 5 | 1,185 | 237 |
| `GET /me/login-history` | paginated | 1 | 224 | 224 |
| `GET /me/sessions` | array | 1 | 221 | 221 |
| `GET /admin/conversations` | paginated | 12 | 2,486 | 207 |
| `GET /admin/users` | paginated | 12 | 2,196 | 183 |
| `GET /me/activity` | paginated | 4 | 643 | 161 |
| `GET /roles` | array | 7 | 1,121 | 160 |
| `GET /patient/specialties` | array | 9 | 762 | 85 |

Compression (`PERFORMANCE.md` §5) cuts these by roughly 75–85% on the wire. The heaviest item is
the lab catalogue's, which carries every analyte's reference ranges by design.

**Not covered:** lists behind a path parameter (they return the same view types), and lists that
were empty for these fixtures (appointments, prescriptions, notifications, conversations,
records). Unpaginated arrays are bounded by their nature (a user's own sessions and devices, the
role list, catalogues) and are recorded, not asserted.
