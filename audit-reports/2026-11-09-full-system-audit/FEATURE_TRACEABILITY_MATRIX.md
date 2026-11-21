# Medora — Feature Traceability Matrix

Audited tree: `claude/emr-visual-redesign` at `ad4c6a8d` plus the uncommitted working
tree, 2026-11-09. Finding IDs refer to `FULL_TECHNICAL_AUDIT.md` and
`SECURITY_AND_PRIVACY_AUDIT.md`.

## How status was assigned

Each feature was traced through the path
*UI → client validation → API client → controller → authentication and authorization →
service → database or external service → response → UI state*.

No feature in this matrix is rated **"Implemented and verified"**. That rating needs an
observed request crossing a client and the real API, and this audit had no database,
Redis or object store. The backend e2e suite, which exercises the server half against a
real PostgreSQL, was not run here either. The strongest rating available is therefore
**"Implemented, not verified end-to-end"**, and it means: the code on both sides exists,
the client adapter has contract tests that passed in this audit, and the server route
has an e2e spec that was *not* executed in this audit.

| Status | Meaning |
| --- | --- |
| Implemented, not verified E2E | Both sides exist and are wired; unit/contract tests exist; no cross-system run observed |
| Partially implemented | Some of the path exists and is wired; a named part is absent |
| Mocked / fixture-backed | The UI works only against in-client fixtures; a production build refuses or hides it |
| Scaffolded / placeholder | Structure exists, core function does not |
| Missing | No implementation found |
| Blocked by dependency | Cannot work until a named finding or decision is resolved |
| N/A | The client has no such surface by design |

"Tests" names the evidence that exists. "Web tests ran" means the file passed in this
audit's execution; "BE e2e (not run)" means the spec exists and was not executed.

---

## 1. Identity and access

| Feature | Web | Mobile | Backend | DB | External | Tests and evidence | Missing links / mismatches | E2E functional? | Blockers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sign-in (password) | Implemented — `features/auth/service.ts:21` | Implemented — `src/api/endpoints/auth.ts` | Implemented — `auth.controller.ts`, `login.service.ts` | `users`, `user_credentials`, `sessions`, `login_events` | — | Web/app adapter tests ran; `auth-login.e2e-spec.ts` (not run) | — | Not verified | MED-SEC-002, MED-SEC-003 |
| Token refresh | Implemented — cookie, single-flight (`api/client.ts:199-205`) | Implemented — body token, keychain (`src/api/client.ts:285-294`) | Implemented — rotation and reuse detection | `sessions` | — | `auth-refresh.e2e-spec.ts`, `auth-mobile-client.e2e-spec.ts` (not run) | **Defect:** cookie session can obtain a body token | Not verified | **MED-SEC-001** |
| Two-factor (TOTP) | Implemented — settings and login step-up | Implemented on `HEAD`; recovery-code sign-in only on `origin/patient-app` | Implemented; recovery-code hashing and redemption only on `origin/backend` | `user_credentials` | — | `auth-two-factor.e2e-spec.ts` (not run) | Recovery flow split across unmerged branches | Not verified | MED-ARCH-001 |
| Registration (patient, doctor) | Implemented | Implemented | Implemented — `registration.service.ts`; `admin` refused | `users`, `doctors`, `patients` | SMTP | `auth-register.e2e-spec.ts` (not run) | — | Not verified | — |
| Email verification, password recovery | Implemented | Implemented | Implemented; always-202 anti-enumeration | `verification_tokens` | SMTP | `auth-recovery.e2e-spec.ts`, `mail.e2e-spec.ts` (not run) | — | Not verified | Production SMTP provider undecided |
| Administrator invitation | Implemented — `features/auth/invitation-service.ts:14` | N/A | Implemented — `admin-invitation.service.ts`, mandatory 2FA | `admin_invitations` | SMTP | `auth-admin-invitation.e2e-spec.ts` (not run) | — | Not verified | — |
| Sessions, devices, login history | Implemented | Implemented (`sessions.ts`) | Implemented | `sessions`, `trusted_devices`, `login_events` | — | `account-security.e2e-spec.ts` (not run) | — | Not verified | — |
| Session timeout / password expiry policy | *[withheld: security-sensitive]* | *[withheld: security-sensitive]* | *[withheld: security-sensitive]* | `platform_settings` | — | *[withheld: security-sensitive]* | *[withheld: security-sensitive]* | **No** | **MED-SEC-004** |
| Roles and permission matrix | Implemented — `features/admin/access/service.ts:7` | N/A | Implemented — `shared/authz/*`, Redis cache | `roles`, `role_permissions`, `user_permissions` | Redis | `authz-matrix.e2e-spec.ts`, `roles-permissions.e2e-spec.ts` (not run); resolver unit specs ran | — | Not verified | — |
| Personal data export | Not offered | Not offered | **`501`** — `settings.controller.ts:80-87` | — | — | — | — | **No** | MED-SEC-006 |

---

## 2. Clinician workspace (web)

| Feature | Web | Mobile | Backend | DB | External | Tests and evidence | Missing links / mismatches | E2E functional? | Blockers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Patient directory and registration | Implemented — `shared-domain/patient-identity/directory-queries.ts:17` | N/A | Implemented — `patient.controller.ts`, care-scoped | `patients`, `patient_doctor_assignments` | — | `http-directory.test.ts` ran; `patient-api.e2e-spec.ts` (not run) | Only an account with a `doctors` row can register a patient | Not verified | MED-BE-004 |
| Patient chart and tabs (history, allergies, notes, vitals, medications, studies) | Implemented — `features/doctor/patients/service.ts:31` | N/A | Implemented — `patient-tabs.service.ts`, scope on every method | 15 patient models | — | `http-profile-service.test.ts` ran; `patients-tabs.e2e-spec.ts` (not run) | — | Not verified | — |
| Patient documents — upload | Implemented — `patients/service.ts:36` | N/A | Implemented — MIME, size, signature checks | `files`, `patient_documents` | S3 | `patient-documents.e2e-spec.ts` (not run) | — | Not verified | — |
| Patient documents and attachments — **download** | Implemented | N/A | Implemented but **always refused**: no scanner bound | `files.scan_result` | Malware scanner (unbound) | `files.e2e-spec.ts` (not run) | Fixed only on `origin/backend` | **No** | **MED-BE-001** |
| Identity reveal (masked PHI) | Implemented | N/A | Implemented — capability, justification, audit | `audit_events` | — | `patients-reveal.e2e-spec.ts` (not run) | — | Not verified | — |
| Appointment book and booking (doctor) | Implemented — `appointments/service.ts:18` | N/A | Implemented — conflict check, status machine | `appointments`, `appointment_events` | — | `http-appointment-service.test.ts` ran; `appointments-book.e2e-spec.ts` (not run) | **No concurrency guarantee** | Not verified | **MED-DB-001** |
| Appointment transitions, reschedule, slot proposals | Implemented | N/A | Implemented | as above | — | `appointments-transitions.e2e-spec.ts` (not run) | Same race on reschedule and proposals | Not verified | MED-DB-001 |
| Availability and time off | Implemented — `appointments/service.ts:24, 30` | N/A | Implemented | `doctor_availability`, `doctor_time_off` | — | `doctor-availability.e2e-spec.ts` (not run) | — | Not verified | — |
| Medical records — list, author, sign, version | Implemented — `medical-records/service.ts:12` | N/A | Implemented | 10 record models | — | `http-record-service.test.ts` ran; `medical-records.e2e-spec.ts` (not run). One page test fails on Node 24 (MED-TEST-004) | — | Not verified | — |
| Laboratory — worklist, ordering, results, review | Implemented — `labs/service.ts:12` | N/A | Implemented | 10 lab/pharmacy models | — | `http-lab-service.test.ts` ran; six `lab-*.e2e-spec.ts` (not run) | Lab annotations have no endpoint | Not verified | — |
| Prescribing — formulary, safety screen, sign, renew, cancel | Implemented — `pharmacy/service.ts:12` | N/A | Implemented | prescription models | — | `http-prescription-service.test.ts` ran; `test:safety` 100%-coverage script exists (not run) | — | Not verified | — |
| Pharmacy **dispensing** | Missing | N/A | Missing — pharmacy role holds no prescription capability | — | — | — | No workflow for the pharmacy role | **No** | MED-BE-004 |
| Doctor dashboard (KPIs, schedule, action queue, trends) | Implemented — `dashboard/service.ts:12` | N/A | Implemented | aggregates | — | `http-dashboard-service.test.ts` ran; `doctor-dashboard.e2e-spec.ts` (not run) | "Practice pulse" has no server source | Not verified | — |
| Notifications — in-app inbox and badges | Implemented — `notifications/service.ts:19` | Implemented — `src/api/endpoints/notifications.ts` | Implemented — outbox and delivery jobs | `notifications`, `domain_events` | — | adapter tests ran; `notifications.e2e-spec.ts` (not run) | — | Not verified | — |
| Notifications — email | — | — | Implemented | `notification_deliveries` | SMTP | `notification-delivery.e2e-spec.ts` (not run) | Production provider undecided | Not verified | — |
| Notifications — **push** | N/A | Device registration only; no push library | Port unbound — `push.module.ts:13` | `trusted_devices.push_token` | Push provider (none) | `push-delivery.e2e-spec.ts` (not run) | Nothing is ever delivered | **No** | **MED-BE-003** |
| Notifications — **SMS** | — | — | Stub | — | SMS provider (none) | — | — | **No** | MED-BE-003 |
| Messaging (staff conversations) | **Partially** — only the unread badge is live (`http-messaging-service.ts:26`); threads show "Not connected yet" | N/A | Implemented — `/conversations/*` | 21 communication models | S3 for attachments | `messaging.e2e-spec.ts` (not run) | Web adapter not written | **No** | MED-ARCH-002 |
| Reports and analytics | Implemented — `reports/service.ts:19` | N/A | Partially — CSV export; `excel`/`pdf` and some analytics `501` | report models | S3 | `reports-analytics.e2e-spec.ts` (not run) | — | Partial | MED-BE-005 |
| Global search | Implemented | N/A | Implemented — role-derived scope | trigram indexes | — | `search.e2e-spec.ts` (not run) | — | Not verified | — |
| Settings — profile, account, privacy, notification preferences | Implemented — `settings/service.ts:12` | Implemented (profile, preferences) | Implemented | settings models | — | `http-settings-service.test.ts` ran | Calendar integration connect is `501` | Partial | MED-BE-005 |
| Profile photo | Implemented in working tree (`ProfilePhotoField.tsx` modified) | — | Implemented — `PUT /me/profile/photo` | `files` | S3, scanner | `profile-photo.e2e-spec.ts` (not run) | Display depends on the scan gate | Unknown | MED-BE-001 |

---

## 3. Administrator workspace (web)

| Feature | Web | Backend | Tests and evidence | Missing links / mismatches | E2E functional? | Blockers |
| --- | --- | --- | --- | --- | --- | --- |
| Doctor roster and verification | Implemented — `admin/doctors/api/service.ts:8` | Implemented — `/doctors/*` | adapter tests ran; `doctor-administration.e2e-spec.ts` (not run) | — | Not verified | — |
| Users, roles, invitations | Implemented | Implemented | as section 1 | — | Not verified | — |
| Appointment oversight | Implemented — the only entry in `LIVE_SECTIONS` (`admin/routes.tsx:31`) | Implemented — `/admin/appointments/*` | `live-oversight.test.tsx` ran (timed out once under load); `appointments-oversight.e2e-spec.ts` (not run) | — | Not verified | MED-DB-001 on reassign |
| Platform settings | Implemented | Implemented; integrations SSRF-guarded | `platform-settings.e2e-spec.ts` (not run) | Backups `501` | Partial | MED-OPS-001 |
| Admin overview | **Mocked** in demo; "Not connected" live | Implemented — `/administration/overview` | — | No web adapter | **No** | MED-FE-001 |
| Clinic management — 13 sections (staff, departments, rooms, shifts, holidays, policies, templates, …) | **Mocked** — `clinic-operations/store.ts:1024` binds `unconnectedClinicOperationsApi` | Implemented — `/administration/*` | `administration-center.e2e-spec.ts` (not run) | No web adapter | **No** | MED-FE-001 |
| Queue and waiting room | **Mocked**; reception read access added in the uncommitted tree | Implemented; actions admin-only | uncommitted `administration.controller.authz.spec.ts` | Reception can read, cannot act | **No** | MED-FE-001, MED-BE-004 |
| System logs (audit ledger viewer) | **Mocked** — `admin/logs/api/logs.api.ts` (local store) | Implemented — `/audit-events`, export | `audit-ledger.e2e-spec.ts` (not run) | No web adapter | **No** | MED-FE-001 |
| Communications oversight | **Mocked** | Implemented — metadata, gated content access, flags | `messaging-oversight.e2e-spec.ts` (not run) | No web adapter; grant TTL has no default (`env.schema.ts:177`) | **No** | MED-FE-001, owner decision |
| Admin patients (account governance) | **Mocked** | **Missing** — no admin patient-account API | — | Neither side | **No** | Scope decision |
| Admin reports | **Mocked** | Partially | — | Not integrated | **No** | MED-FE-001 |
| Platform status | — | **`501`** | — | Needs monitoring probes | **No** | MED-OPS-003 |
| Backups and restore | UI present | **`501`** both | — | No backup exists anywhere | **No** | **MED-OPS-001** |

---

## 4. Patient application (mobile)

| Feature | Mobile | Backend | DB | Tests and evidence | Missing links / mismatches | E2E functional? | Blockers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Doctor discovery | Implemented — `features/doctors/http-doctor-service.ts` | Implemented — `GET /patient/doctors`, `/:id`, `/patient/specialties` | `doctors`, `specialties` | adapter tests ran; `patient-api.e2e-spec.ts` (not run) | One method (availability/slots) refuses | Not verified | — |
| View own appointments | Implemented — `GET /me/appointments`, `/:id` | Implemented — subject from token | `appointments` | `http-appointment-service.test.ts` ran; `patient-appointments.e2e-spec.ts` (not run) | — | Not verified | — |
| **Book** an appointment | Booking flow UI exists (`booking/BookingFlow.tsx`); production adapter **refuses** | **Missing** — no `POST /me/appointments` on any branch | — | app test asserts the refusal | No route; booking model undecided | **No** | **MED-MOB-001**, ADR-033 (proposed), MED-DB-001 |
| **Cancel / reschedule** an appointment | UI exists; adapter refuses | **Missing** | — | as above | — | **No** | as above |
| Health records (allergies, conditions, medications, history, labs) | **Fixture-backed**; production refuses (`features/health/service.ts:17`) | **Missing** — no patient-facing records route | exists for clinicians | fixture tests only | No route | **No** | MED-MOB-001 |
| Documents and prescriptions (patient view) | Fixture-backed | Missing | — | fixture tests; `waitFor` failures under load (MED-TEST-004) | No route | **No** | MED-MOB-001 |
| Messaging with the clinic | **Fixture-backed**; production refuses (`features/messages/service.ts:152`) | **Missing** for patients — `/conversations` admits staff roles only | — | — | No patient participant model | **No** | MED-MOB-001 |
| Clinic profile, hours, announcements | Fixture-backed; production refuses | Missing — no public or patient clinic route | exists for admin | — | No route | **No** | MED-MOB-001 |
| Recent activity | Fixture-backed; section hidden in production | Missing | — | — | No route | **No** | MED-MOB-001 |
| **Emergency access** | Static guidance and disclaimer; **no number configured**, cannot dial | **Missing** — no emergency-contacts route | — | `features/emergency` tests | Numbers must be operator-approved and region-specific | **No** (guidance only) | MED-MOB-001; clinical and legal owner |
| Notifications and preferences | Implemented | Implemented | as section 2 | adapter tests ran | No push | Not verified | MED-BE-003 |
| Profile | Implemented — `src/api/endpoints/profile.ts` | Implemented — `GET/PATCH /me/profile` | `patients`, `users` | `patient-identity-from-session.e2e-spec.ts` (not run) | — | Not verified | — |
| Biometric unlock, background PHI sweep | Implemented client-side | N/A | — | `features/auth` tests ran | — | Client-only | — |
| Forced upgrade gate | Implemented; fails open; no store URL configured | Version header | — | `features/app-version` tests | No store listing | Unknown | MED-MOB-003 |

---

## 5. AI and intelligent features

| Feature | Web | Mobile | Backend | AI / external | Tests and evidence | E2E functional? | Blockers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Clinician AI assistant (chat) | **Mocked** — canned replies with a mock-output disclaimer (`features/doctor/ai/service.ts:25`) | N/A | **Scaffolded** — threads, context binding, SSE, settings; generation always `503` (`shared/ai/ai.module.ts:18`) | No provider, no SDK, no adapter | `ai-prompt.builder.spec.ts`, `ai-containment.spec.ts` (one case fails on Windows); `ai-assistant.e2e-spec.ts` (not run) | **No** | **MED-AI-001**, MED-AI-002, MED-AI-003, MED-ARCH-003 |
| Patient chatbot | N/A | **Placeholder** — `connected: false` constant | Missing | None | `ai-honesty.test.ts` asserts no network call and no canned reply | **No** | MED-AI-001; AD-4 and BE-14 named in code |
| Text symptom input → diagnostic suggestions | N/A | Placeholder screen (`AiSymptomsScreen.tsx`) | Missing | None | — | **No** | MED-AI-001, clinical owner |
| Voice symptom input | Missing | Missing — no speech or audio dependency | Missing | None | — | **No** | Not started |
| Image-based analysis | Missing | Placeholder; picker disabled; `expo-image-picker` not installed | Missing | None | `ai-states.test.tsx` renders states | **No** | Not started |
| Emergency detection / triage | Missing | Missing | Missing | None | — | **No** | Not started; clinical validation required |
| Personalised recommendations | Missing | Missing | Missing | None | — | **No** | Not started |
| Smart-speaker interaction | Missing | Missing | Missing | None | — | **No** | Not started |
| Medication reminders | Missing | Missing | Missing | — | — | **No** | Not started; claimed in root README |
| Mental-health support | Missing | Missing | Missing | — | — | **No** | Not started; claimed in root README |

---

## 6. Platform capabilities

| Capability | State | Evidence | E2E functional? | Blockers |
| --- | --- | --- | --- | --- |
| Audit trail (write) | Implemented | `shared/audit/*`, partitioned ledger | Not verified | — |
| File storage | Implemented (S3 adapter) | `shared/files/s3-file-storage.ts`; `s3-live.e2e-spec.ts` skips without a live store | Not verified | — |
| Malware scanning | **Unbound** on `HEAD`/`main`; ClamAV on `origin/backend` | `file-storage.module.ts:41` | **No** | MED-BE-001 |
| Background jobs | Implemented — inline and BullMQ drivers, dead-letter store, admin replay | `shared/jobs/*` | Not verified (BullMQ spec needs Redis) | MED-BE-006 |
| Rate limiting | *[withheld: security-sensitive]* | *[withheld: security-sensitive]* | Not verified | MED-SEC-003 |
| Health and readiness | Implemented, **database only** | `health.module.ts:29` | Not verified | MED-BE-002 |
| Metrics | Implemented, token-gated | `metrics.controller.ts` | Not verified | MED-OPS-003 |
| Backups | **Missing** | `backup.service.ts:57-74` | **No** | MED-OPS-001 |
| Deployment — web | Demo only (mock data) | `frontend/vercel.json` | Demo | MED-FE-002 |
| Deployment — API | **Undefined** | no production compose/IaC | **No** | MED-OPS-002 |
| Deployment — mobile | **Undefined** — placeholder EAS project | `patient-app/app.json` | **No** | MED-MOB-003 |

---

## 7. Summary

The matrix has 80 rows. **None is rated "Implemented and verified".** The rows were not
tallied into percentages, because a completion figure would imply a precision this audit
does not have; the pattern by area is clear enough without one:

| Area | Rows | Predominant status |
| --- | ---: | --- |
| Identity and access | 10 | Implemented, not verified; one confirmed defect, one unenforced policy, one `501` |
| Clinician workspace (web) | 22 | Implemented, not verified; downloads, push, SMS, dispensing and messaging are not functional |
| Administrator workspace (web) | 13 | 4 implemented, not verified; 9 mocked, missing or `501` |
| Patient application | 14 | 6 implemented (2 of them client-only); 8 fixture-backed, missing or placeholder |
| AI and intelligent features | 10 | 0 functional |
| Platform capabilities | 11 | Mixed; backups and all three deployments undefined |

**Reading.** The clinician web workspace against the backend is the one substantially
built vertical: patients, chart, appointments, records, labs and prescribing all have
both halves and contract tests. It has never been observed working end to end in this
audit, and its integration record says the same of its own final pass. The administrator
workspace is half connected. The patient application delivers sign-in, profile, doctor
discovery and read-only appointments. Every AI feature is absent.

## 8. Contract mismatches worth fixing first

1. **Refresh delivery** (MED-SEC-001) — *[Withheld from the published copy: security-sensitive content.]*
2. **Patient booking** — the app holds a complete booking flow, an idempotency key
   (`features/appointments/hooks.ts:64`) and a slot model for a route that does not
   exist; the server has no idempotency support on `HEAD` (it exists on
   `origin/backend`).
3. **Download gate** (MED-BE-001) — clients present download controls the server will
   always refuse on `main`.
4. **Admin sections** — server routes exist for which the client only has local stores.
5. **Security policy fields** (MED-SEC-004) — *[Withheld from the published copy: security-sensitive content.]*

---

## Addendum — 2026-11-10 (Phase 0 completion)

Not a re-assessment; the rows above stay as observed on 2026-11-09.

| Row | Change since the audit |
| --- | --- |
| Queue and waiting room (§3) | The owner approved the reception change (DEC-04 option (a), 2026-11-10): Queue and Waiting Room belong to the Reception workspace and leave the Admin sidebar; reception reads both, actions stay admin-only. The uncommitted work implementing it is preserved as backend slice 2 and frontend slice 1H (`audit-reports/2026-11-10-rs1-implementation/PHASE_0_COMPLETION_REPORT.md` §21); not merged |
| System logs (audit ledger viewer) (§3) | *[withheld: security-sensitive]* — MED-DB-004 (P1), task R-DB-05 |
| API keys (platform) | Issued without a hospital — MED-SEC-015 (P3), task R-SEC-14 |
