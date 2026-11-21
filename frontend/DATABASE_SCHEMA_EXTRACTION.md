# Medora Healthcare Platform — Production Database Specification

**Document type:** Reverse-engineered database schema extraction
**Source:** Full codebase audit of branch `claude/doctor-lab-system-phase-7-c1f15a` (Phases 0–19, 521 files)
**Prepared by:** Lead Solution Architect / Senior Database Engineer
**Date:** 2026-07-20
**Target engine:** PostgreSQL 16+

---

## 0. Methodology & Evidence Sources

Every entity below is backed by concrete evidence in the repository. Nothing is assumed; entities are inferred only where multiple files corroborate the same shape. Evidence classes used:

| Evidence class | Files |
|---|---|
| Domain type models | `src/features/**/model/types.ts`, `src/features/shared-domain/patient-identity/types.ts`, `src/types/auth/index.ts` |
| Validation schemas (Zod) | `src/features/auth/schemas/*.ts`, `src/features/doctor/settings/schemas.ts`, `src/utils/password.ts`, `src/configs/env.ts` |
| Mock services (future API contracts) | `src/features/auth/mock/*`, `src/features/doctor/**/mock/*`, `src/features/doctor/administration/*.api.ts` |
| Seed / mock data | `src/features/shared-domain/patient-identity/roster.ts`, `src/features/doctor/**/model/mock-data.ts`, catalogues |
| Persistence layers (localStorage stand-ins for tables) | `session-store.ts`, `DoctorProfileProvider.tsx`, `admin-profile.ts`, `preferences.ts`, per-feature `store.ts` files |
| Product / UX / architecture documents | `UX_ARCHITECTURE.md` (733 lines — incl. Admin dashboard §3, permission matrix §3.9, audit taxonomy §3.7, PHI rules §1.5), `FRONTEND_ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `PHASE2–PHASE19` docs |
| Route contracts | `src/routes/index.ts`, `UX_ARCHITECTURE.md §1.3` |
| Config | `src/configs/session.ts`, `src/configs/feature-flags.ts`, `src/constants/index.ts` |

**Key architectural fact:** the current build is a frontend-only React/TypeScript application. Every feature's `types.ts` explicitly states it "mirrors the future DTOs" so that "API integration swaps the data source without touching components." Those DTO mirrors, plus the UX blueprint's Admin sections (which are specified but not yet coded), are the authoritative source for this schema.

**Entity ID conventions found in code** (business identifiers, kept as unique keys alongside surrogate UUID PKs):

| Prefix | Entity | Example |
|---|---|---|
| `usr_` | User account | `usr_doctor_amelia` |
| `PT-` | Patient | `PT-1001` |
| `APT-` | Appointment | `APT-3001` |
| `MR-` | Medical record | `MR-10001` |
| `LAB-` | Lab order | `LAB-100001` |
| `RX-` | Prescription | `RX-200001` |
| `NTF-` | Notification | `NTF-LIVE…` |
| — | MRN (medical record number) | `4411-27` |

---

## 1. Complete Entity List

**CONFIRMED** = directly evidenced by code/type models/mock persistence. **SPEC** = specified in `UX_ARCHITECTURE.md` for the Admin dashboard but not yet coded (still confirmed product scope, not invention). **INFERRED RECOMMENDATION** entities are listed separately in §13 and never mixed in.

### Domain A — Identity & Access (CONFIRMED)
1. `roles` · 2. `permissions` · 3. `role_permissions` · 4. `users` · 5. `user_permissions` · 6. `user_credentials` · 7. `sessions` · 8. `trusted_devices` · 9. `login_events` · 10. `verification_tokens` (email verify + password reset) · 11. `otp_codes` · 12. `user_activity_log`

### Domain B — People & Clinical Master Data (CONFIRMED)
13. `doctors` (professional profile) · 14. `admin_profiles` · 15. `patients` · 16. `patient_allergies` · 17. `patient_chronic_conditions` · 18. `patient_emergency_contacts` · 19. `patient_insurance` · 20. `patient_documents` · 21. `patient_notes` · 22. `patient_medical_history` · 23. `patient_vital_signs` · 24. `patient_clinical_alerts` · 25. `patient_medications` (current-medication list) · 26. `patient_studies` (lab/imaging study placeholders)

### Domain C — Scheduling (CONFIRMED)
27. `appointments` · 28. `appointment_events` (status history / audit trail)

### Domain D — Medical Records / EHR (CONFIRMED)
29. `medical_records` · 30. `record_diagnoses` · 31. `record_vital_signs` · 32. `record_treatment_plan_items` · 33. `record_medications` · 34. `record_allergies` · 35. `record_notes` · 36. `record_attachments` · 37. `record_timeline_events`

### Domain E — Laboratory (CONFIRMED)
38. `lab_test_catalogue` · 39. `lab_analyte_specs` · 40. `lab_orders` · 41. `lab_specimens` · 42. `lab_results` · 43. `lab_attachments` · 44. `lab_timeline_events`

### Domain F — Pharmacy (CONFIRMED)
45. `medications` (formulary) · 46. `medication_strengths` · 47. `prescriptions` · 48. `prescription_safety_warnings` · 49. `prescription_notes` · 50. `prescription_history_entries` · 51. `prescription_timeline_events`

### Domain G — Communication (CONFIRMED)
52. `conversations` · 53. `conversation_participants` · 54. `messages` · 55. `message_attachments` · 56. `conversation_shared_links` · 57. `notifications` · 58. `notification_preferences` · 59. `broadcast_channels` (announcement/system channels of the Communication Center)

### Domain H — AI Assistant (CONFIRMED)
60. `ai_conversations` · 61. `ai_messages` · 62. `ai_user_settings` · 63. `ai_prompt_templates`

### Domain I — Reports & Analytics (CONFIRMED)
64. `saved_reports` · 65. `scheduled_reports` · 66. `scheduled_report_runs`

### Domain J — User Settings (CONFIRMED)
67. `user_settings` (account/privacy/workflow document) · 68. `user_interface_preferences` · 69. `user_integrations`

### Domain K — Clinic Administration, Phase 17 (CONFIRMED)
70. `departments` · 71. `staff_members` · 72. `staff_shift_assignments` · 73. `rooms` · 74. `resources` · 75. `clinic_working_days` · 76. `holidays` · 77. `queue_entries` · 78. `waiting_room_entries` · 79. `announcements` · 80. `policies` · 81. `document_templates`

### Domain L — Platform Administration, Phase 18 (CONFIRMED)
82. `platform_settings` (11 configuration slices) · 83. `platform_integrations` · 84. `api_keys` · 85. `backups`

### Domain M — Audit & Compliance (CONFIRMED + SPEC §3.7)
86. `audit_events` (immutable platform audit log)

### Admin-dashboard scope from UX blueprint (SPEC — §3.2–3.6, 2.11)
87. `doctor_verification_documents` · 88. `doctor_availability` (weekly grid + vacation mode) · 89. `appointment_reschedule_proposals` · 90. `communication_access_requests` · 91. `message_flags` · 92. `record_issue_reports` · 93. `satisfaction_surveys`

**Total confirmed + spec entities: 93.** Inferred recommendations (§13) add ~17 more for a production estimate of **~110 tables** (§14.8).

---
## 2. Full Database Dictionary

Conventions used throughout:

- Every table gets a surrogate PK `id uuid DEFAULT gen_random_uuid()` unless stated otherwise; business codes (`PT-1001`, `RX-200001`, MRN) are `UNIQUE` columns.
- All timestamps are `timestamptz`. `created_at DEFAULT now()`, `updated_at` maintained by trigger.
- Enum columns use PostgreSQL `ENUM` types defined in §7 (Reference Data); the enum name is given as the column type.
- "Audit cols" = `created_at, updated_at, created_by, updated_by` (+ soft delete where §8 requires it). They are not repeated in every column table.

---

### Domain A — Identity & Access

#### A1. `roles`
- **Purpose:** Coarse role that selects route tree/shell (`src/types/auth/index.ts`), extended by the platform role list (`admin-settings.types.ts` `PlatformRole`, UX §3.9 role editor incl. future Receptionist/Patient).
- **Description:** Lookup + editable custom roles ("custom role creation from a base template" — UX §3.9).
- **PK:** `id` · **Unique:** `code`
- **FK:** `base_role_id → roles.id` (custom roles derive from a template)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | Surrogate PK |
| code | varchar(30) | no | — | one of: admin, doctor, reception, laboratory, pharmacy, nurse, receptionist, patient (seed set) | `doctor` | Machine role code (`Role` / `PlatformRole` / `StaffRole` unions) |
| label | varchar(60) | no | — | non-empty | `Doctor` | Display label (`PLATFORM_ROLE_LABEL`) |
| base_role_id | uuid | yes | null | FK roles | — | Template this custom role was created from (UX §3.9) |
| is_system | boolean | no | true | — | true | Seed roles cannot be deleted |

#### A2. `permissions`
- **Purpose:** Fine-grained capabilities; "a capability that is not listed here cannot be referenced anywhere" (`src/types/auth/index.ts`).
- **PK:** `id` · **Unique:** `code`

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| code | varchar(60) | no | — | `<domain>.<action>` pattern; the 22 codes of the `Permission` union (§7.1) | `appointments.reassign` | Capability code |
| domain | varchar(30) | no | — | Clinical data / Scheduling / Communication / Administration / Audit / AI (UX §3.9 grouping) | `Scheduling` | Matrix group |
| description | text | yes | null | — | — | Human description |

#### A3. `role_permissions`
- **Purpose:** The permission matrix editor (UX §3.9: "capabilities × roles as switch grid").
- **PK:** composite (`role_id`, `permission_id`) · **FKs:** `role_id → roles` (CASCADE), `permission_id → permissions` (CASCADE)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| role_id | uuid | no | — | FK | — | Role |
| permission_id | uuid | no | — | FK | — | Permission |
| granted_by | uuid | yes | null | FK users | — | Admin who toggled it (matrix changes are audit-logged) |
| granted_at | timestamptz | no | now() | — | — | — |

#### A4. `users`
- **Purpose:** Every platform account (doctor, admin, staff). Evidence: `MockUserRecord`, `SessionUser`, `PlatformUser`, signup schema, UX §3.2.
- **Description:** One row per sign-in identity. Clinical/professional detail lives in `doctors`; patients are NOT users in current scope (patient portal out of scope per UX doc header) — but see §13.
- **PK:** `id` · **Unique:** `public_id` (`usr_…`), `email` (citext), `username`
- **FK:** `role_id → roles` (RESTRICT)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| public_id | varchar(40) | no | — | `usr_` prefix | `usr_doctor_amelia` | Client-facing id (mock users) |
| first_name | varchar(60) | no | — | 1–60 chars (signup schema) | `Amelia` | From signup `firstName` |
| last_name | varchar(60) | no | — | 1–60 chars | `Chen` | From signup `lastName` |
| display_name | varchar(120) | no | — | — | `Dr. Amelia Chen` | `SessionUser.name` |
| email | citext | no | — | RFC email (Zod `.email()`); unique | `doctor@medora.health` | Sign-in email |
| username | varchar(30) | yes | null | 3–30, `/^[a-z0-9._-]+$/i` (`accountSchema`) | `amelia.chen` | Settings → Account username |
| phone | varchar(30) | no | — | `/^\+?[0-9][0-9\s-]{6,18}$/` (signup) ; 7–30 chars (account schema) | `+1 555 012 4477` | Contact phone |
| role_id | uuid | no | — | FK | — | Coarse role |
| email_verified_at | timestamptz | yes | null | — | — | Null = unverified (`emailVerified` flag; login blocked until verified) |
| two_factor_enabled | boolean | no | false | — | false | `twoFactorEnabled`; forces OTP step at login |
| status | user_status | no | 'active' | active / inactive / locked / suspended (UX §3.2/3.4 badges) | `active` | Account lifecycle |
| license_number | varchar(40) | yes | null | ≤40 (signup `licenseNumber`, optional) | `MED-482913` | Captured at signup for doctors |
| terms_accepted_at | timestamptz | no | — | must be set (signup `acceptTerms` refine) | — | T&C consent timestamp |
| privacy_accepted_at | timestamptz | no | — | must be set (`acceptPrivacy`) | — | Privacy-policy consent |
| last_active_at | timestamptz | yes | null | — | — | `PlatformUser.lastActiveAt` |
| avatar_url | text | yes | null | — | null | Profile photo (falls back to initials) |

#### A5. `user_permissions`
- **Purpose:** Per-user capability overrides — mock users carry explicit permission arrays distinct from their role bundle.
- **PK:** (`user_id`,`permission_id`) · **FKs:** both CASCADE. Columns: `user_id`, `permission_id`, `allowed boolean NOT NULL DEFAULT true`, `granted_by`, `granted_at`.

#### A6. `user_credentials`
- **Purpose:** Password storage separated from `users` (never returned by APIs). Evidence: `MockUserRecord.password` ("Mock secret — never leaves this module"), password policy in `utils/password.ts`, `passwordUpdatedAt` in `AccountSettings`, rotation policy `passwordExpiryDays` (Phase 18 security slice).
- **PK:** `user_id` (1:1 with users, CASCADE)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| user_id | uuid | no | — | FK users | — | PK & FK |
| password_hash | text | no | — | Argon2id/bcrypt hash; plaintext policy: ≥8 chars with lower+upper+digit+symbol (`PASSWORD_MIN_LENGTH`, `passwordChecks`) | `$argon2id$…` | Never plaintext |
| password_updated_at | timestamptz | no | now() | — | — | `AccountSettings.passwordUpdatedAt`; drives expiry vs `password_expiry_days` |
| failed_attempts | int | no | 0 | ≥0 | 0 | Lockout counter vs `loginAttemptLimit` (SecurityPolicySettings) |
| locked_until | timestamptz | yes | null | — | — | Lockout window |
| totp_secret_enc | bytea | yes | null | encrypted at rest | — | 2FA TOTP secret (UX 2.11 Security: TOTP wizard) |
| recovery_codes_enc | bytea | yes | null | encrypted | — | 2FA recovery codes |

#### A7. `sessions`
- **Purpose:** Active sessions + remember-me semantics. Evidence: `session-store.ts` (token, exp, rememberMe; 12 h session / 30 d remember; silent refresh), `ActiveSession` (device, browser, location, ip, startedAt, current), `AdminSession`, single-session policy (`singleSessionPerUser`), idle lock (`configs/session.ts`: 10 min idle, 60 s warning).
- **PK:** `id` · **Unique:** `refresh_token_hash` · **FK:** `user_id → users` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK (`ActiveSession.id`) |
| user_id | uuid | no | — | FK | — | Owner |
| refresh_token_hash | text | no | — | hashed, never plaintext | — | Refresh-token exchange (`refreshSession()` stand-in) |
| remember_me | boolean | no | false | — | true | Chooses TTL: 30 d vs 12 h (`REMEMBER_MS`/`SESSION_MS`) |
| expires_at | timestamptz | no | — | > now() at creation | — | Sliding expiry (`exp`) |
| device | varchar(120) | yes | null | — | `MacBook Pro` | `ActiveSession.device` |
| browser | varchar(80) | yes | null | — | `Chrome 126` | `ActiveSession.browser` |
| ip_address | inet | yes | null | — | `84.12.9.31` | `ActiveSession.ipAddress` |
| location | varchar(120) | yes | null | — | `Portland, OR` | Approximate location |
| started_at | timestamptz | no | now() | — | — | `startedAt` |
| last_active_at | timestamptz | no | now() | — | — | Idle-lock + `AdminSession.lastActiveAt` |
| locked | boolean | no | false | — | false | Idle lock engaged (`AuthStatus 'locked'`, lock-screen route) |
| revoked_at | timestamptz | yes | null | — | — | "Revoke" / "Sign out all other sessions" (UX 2.11) |

#### A8. `trusted_devices`
- **Purpose:** Security → trusted devices. Evidence: `TrustedDevice` (settings) + `AdminDevice` (admin profile).
- **PK:** `id` · **FK:** `user_id → users` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| user_id | uuid | no | — | FK | — | Owner |
| name | varchar(80) | no | — | non-empty | `Front-office workstation` | Device label |
| platform | device_platform | no | — | windows/mac/ios/android/desktop/mobile/tablet (union of both models) | `windows` | `TrustedDevice.platform` ∪ `AdminDevice.kind` |
| added_at | timestamptz | no | now() | — | — | `addedAt`/`trustedSince` |
| last_seen_at | timestamptz | yes | null | — | — | `lastSeenAt` |
| is_current | boolean | no | false | — | — | `current` flag |
| removed_at | timestamptz | yes | null | — | — | Soft removal ("Remove trusted device") |

#### A9. `login_events`
- **Purpose:** Login history (Settings §Security; UX 3.3 Activity tab: "failures highlighted, impossible-travel auto-flagged").
- **PK:** `id` · **FK:** `user_id → users` (SET NULL — history survives account deletion for audit)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| user_id | uuid | yes | — | FK | — | Account (null after user purge) |
| attempted_email | citext | no | — | — | `doctor@medora.health` | Also records failures for unknown emails |
| occurred_at | timestamptz | no | now() | — | — | `LoginEvent.at` |
| device | varchar(120) | yes | null | — | `Windows · Chrome` | `LoginEvent.device` |
| ip_address | inet | yes | null | — | — | UX 2.11 login history: IP |
| location | varchar(120) | yes | null | — | `Portland, OR` | `LoginEvent.location` |
| result | login_result | no | — | success / failed | `failed` | `LoginEvent.status` |
| failure_code | varchar(30) | yes | null | one of `MockAuthErrorCode` (§7.1) | `invalid_credentials` | Why it failed |
| anomaly_flag | varchar(40) | yes | null | e.g. impossible-travel, new-location, burst | — | Auto-flags (UX 3.3, 3.9 alert rules) |

#### A10. `verification_tokens`
- **Purpose:** Email verification + password reset tokens. Evidence: `verifyEmail(token)`, `resetPassword(token, password)`, `token_invalid` error, resend endpoints; forgot-password anti-enumeration.
- **PK:** `id` · **Unique:** `token_hash` · **FK:** `user_id → users` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| user_id | uuid | no | — | FK | — | Subject |
| kind | token_kind | no | — | email_verification / password_reset | `password_reset` | Flow |
| token_hash | text | no | — | hashed; raw token only in the email link | — | Lookup key |
| expires_at | timestamptz | no | — | — | — | Expired ⇒ `token_invalid` |
| used_at | timestamptz | yes | null | — | — | Single-use enforcement |
| created_at | timestamptz | no | now() | — | — | Resend creates a new row |

#### A11. `otp_codes`
- **Purpose:** 2FA one-time codes. Evidence: `OTP_LENGTH = 6`, digits-only Zod rule, `verifyOtp`, `resendOtp`, `otp_invalid`/`otp_required`, `rate_limited` error code, `Countdown` resend timer.
- **PK:** `id` · **FK:** `user_id → users` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| user_id | uuid | no | — | FK | — | Subject |
| code_hash | text | no | — | source: exactly 6 digits `/^\d+$/` | — | Hashed OTP |
| channel | varchar(10) | no | 'app' | app / sms / email | `app` | Delivery channel |
| expires_at | timestamptz | no | — | — | — | Short TTL |
| consumed_at | timestamptz | yes | null | — | — | Single use |
| attempts | int | no | 0 | bounded (rate_limited) | 0 | Wrong-guess counter |

#### A12. `user_activity_log`
- **Purpose:** Per-user account activity feed (Settings → Activity; `ActivityEntry` with `ActivityKind`; `AdminActivityEntry`). Distinct from the platform `audit_events` (§M): this is the user-facing subset.
- **PK:** `id` · **FK:** `user_id → users` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| user_id | uuid | no | — | FK | — | Owner |
| occurred_at | timestamptz | no | now() | — | — | `ActivityEntry.at` |
| kind | activity_kind | no | — | profile/password/login/settings/security/integration/privacy | `security` | `ActivityKind` |
| summary | varchar(200) | no | — | non-empty | `Two-factor authentication enabled` | `summary` |
| detail | text | yes | null | — | — | `detail` |

---

### Domain B — People & Clinical Master Data

#### B1. `doctors`
- **Purpose:** The doctor's professional profile — "the SINGLE SOURCE OF TRUTH for the signed-in doctor's identity" (`DoctorProfileProvider`), plus admin-side lifecycle fields (UX §3.2/3.3: verification, suspension, rating).
- **Description:** 1:1 extension of `users` for accounts with the doctor role.
- **PK:** `id` · **Unique:** `user_id`, `license_number`, `employee_id`
- **FKs:** `user_id → users` CASCADE, `department_id → departments` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| user_id | uuid | no | — | FK, unique | — | Owning account |
| photo_url | text | yes | null | image; upload w/ crop (UX 2.11) | null | Profile photo (`photo` data-URL in mock) |
| full_name | varchar(80) | no | — | 2–80 (`profileSchema.fullName`) | `Dr. Amelia Chen` | Display name |
| title | varchar(60) | yes | null | ≤60 | `MD, FACP` | Credentials |
| specialty | varchar(60) | no | — | 2–60 (`profileSchema.specialty`) | `Internal Medicine` | Primary specialty (taxonomy select — UX 2.11) |
| license_number | varchar(40) | no | — | 3–40 | `MED-482913` | License; edits trigger re-verification (UX 2.11) |
| license_expires_on | date | yes | null | warning at <60 days (UX 2.11) | — | License expiry |
| employee_id | varchar(40) | yes | null | ≤40 | `EMP-2041` | HR id |
| department_id | uuid | yes | null | FK departments | — | Assigned department (free-text `department` today — see §16) |
| hospital | varchar(80) | yes | null | ≤80 | `Medora General Hospital` | Facility |
| years_of_experience | smallint | no | 0 | int 0–70 (`profileSchema`) | 12 | Experience |
| languages | text[] | no | '{}' | ≤8 entries | `{English,Mandarin}` | Spoken languages |
| biography | text | yes | null | ≤600 chars | — | Bio |
| education | text[] | no | '{}' | ≤8 entries | `{MD — Johns Hopkins…, Residency…}` | Degrees, newest first |
| certifications | text[] | no | '{}' | ≤8 entries | `{Board Certified…, ACLS}` | Board certifications |
| skills | text[] | no | '{}' | ≤12 entries | `{Preventive care}` | Clinical focus areas |
| linkedin_url | text | yes | null | full URL (Zod `.url()`) | — | Social |
| website_url | text | yes | null | full URL | — | Social |
| emergency_contact_name | varchar(80) | yes | null | ≤80 | — | Own emergency contact |
| emergency_contact_phone | varchar(30) | yes | null | ≤30 | — | — |
| contact_email | citext | no | — | email | `doctor@medora.health` | Public contact |
| contact_phone | varchar(30) | no | — | 7–30 | `+1 (555) 012-4477` | Public phone |
| office_location | varchar(80) | yes | null | ≤80 | `Building C · Suite 340` | Office |
| office_hours | varchar(80) | yes | null | ≤80 | `Mon–Fri, 9:00–17:00` | Display hours |
| verification_status | doctor_verification_status | no | 'pending' | pending / verified / rejected / docs_requested (UX §3.2 badges) | `verified` | Admin verification lifecycle |
| verified_at | timestamptz | yes | null | — | — | When verification completed |
| verified_by | uuid | yes | null | FK users | — | Verifying admin |
| practice_status | doctor_practice_status | no | 'active' | active / suspended / vacation (UX §3.2) | `active` | Operational status |
| rating_avg | numeric(3,2) | yes | null | 0–5 | 4.70 | From satisfaction surveys (UX §3.2 Rating column) |

#### B2. `admin_profiles`
- **Purpose:** Administrator profile document (`admin-profile.ts` `AdminProfile`) — same pattern as doctors, plus admin workspace preferences.
- **PK:** `id` · **Unique:** `user_id` · **FK:** `user_id → users` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| user_id | uuid | no | — | FK unique | — | Owning account |
| photo_url | text | yes | null | — | null | Photo |
| full_name | varchar(80) | no | — | — | `Marcus Reed` | Name |
| title | varchar(80) | yes | null | — | `Platform Administrator` | Job title |
| biography | text | yes | null | — | — | Bio |
| contact_email | citext | no | — | email | `admin@medora.health` | Contact |
| contact_phone | varchar(30) | yes | null | — | `+1 (555) 018-0001` | Phone |
| office_location | varchar(80) | yes | null | — | `Administration · Level 2` | Office |
| emergency_contact_name | varchar(80) | yes | null | — | — | — |
| emergency_contact_phone | varchar(30) | yes | null | — | — | — |
| education | text[] | no | '{}' | — | `{BSc Health Informatics…}` | Education |
| certifications | text[] | no | '{}' | — | `{CHCIO}` | Certifications |
| experience | text[] | no | '{}' | — | `{Clinic Operations Manager…}` | Work history |
| linkedin_url | text | yes | null | URL | — | Social |
| website_url | text | yes | null | URL | — | Social |
| landing_section | varchar(30) | no | 'overview' | `AdministrationSectionSlug` (§7.6) | `overview` | Default admin landing |
| weekly_digest | boolean | no | true | — | true | Digest opt-in |

#### B3. `patients`
- **Purpose:** Patient master record. Evidence: `Patient` (shared-domain), 5-person canonical roster, `AddPatientDialog` fields (email/address/insurance/medicalNotes "present on patients added in-app"), UX §2.2/§3.4.
- **PK:** `id` · **Unique:** `public_id` (`PT-…`), `mrn`
- **FK:** `assigned_doctor_id → doctors` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| public_id | varchar(20) | no | — | `PT-` + number | `PT-1001` | Business id |
| mrn | varchar(20) | no | — | unique; masked display "last-4" for admins (UX 1.5.6) | `4411-27` | Medical record number |
| full_name | varchar(120) | no | — | non-empty | `Khaled Nassar` | Name (masked `Kh••• N•••` in admin tables) |
| date_of_birth | date | no | — | past date | `1974-03-18` | DOB — age is **derived**, not stored (see §16) |
| gender | gender | no | — | female / male | `male` | `Gender` union |
| blood_type | blood_type | no | — | 8 ABO/Rh values | `O+` | `BloodType` union |
| phone | varchar(30) | no | — | phone pattern | `+20 100 214 3387` | Contact |
| email | citext | yes | null | email | — | Optional (in-app registration) |
| address | text | yes | null | — | — | Optional |
| photo_url | text | yes | null | "Null until the files service exists" | null | Avatar |
| status | patient_status | no | 'active' | active / under-treatment / critical / follow-up / discharged | `follow-up` | `PatientStatus` |
| risk_level | risk_level | no | 'low' | low / medium / high / critical | `medium` | `RiskLevel` |
| medical_notes | text | yes | null | — | — | Registration notes |
| last_visit_at | timestamptz | yes | null | — | — | Denormalized cache (source of truth: appointments/records) |
| registered_at | timestamptz | no | now() | — | — | `registeredAt` |

Derived (view/computed, not columns): `age`, `next_appointment` (earliest future non-terminal appointment), `has_severe_allergy` (EXISTS severe allergy row).

#### B4. `patient_allergies`
- **Purpose:** Allergy list — safety-critical ("Critical information cannot be missed", UX 1.5.4). Evidence: `AllergyRecord` (profile), `RecordAllergy`, `patient.allergies[]`, `allergyClass` matching in pharmacy.
- **PK:** `id` · **Unique:** (`patient_id`, `allergen`) · **FK:** `patient_id → patients` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| patient_id | uuid | no | — | FK | — | Patient |
| allergen | varchar(120) | no | — | non-empty | `Penicillin` | Allergen; matched against `medications.allergy_class` in the prescription safety screen |
| severity | allergy_severity | no | — | mild / moderate / severe | `severe` | `AllergySeverity` |
| reaction | varchar(200) | no | — | — | `Anaphylaxis` | Reaction description |
| notes | text | yes | null | — | — | `AllergyRecord.notes` |
| recorded_at | timestamptz | no | now() | — | — | `recordedAt` |
| recorded_by | uuid | yes | null | FK users | — | Provenance (UX 1.5.2) |

#### B5. `patient_chronic_conditions`
- **Purpose:** Chronic conditions per patient, from the canonical vocabulary `CHRONIC_CONDITIONS` (10 items) used by mock data and filters.
- **PK:** (`patient_id`, `condition_id`) · **FKs:** `patient_id → patients` CASCADE, `condition_id → chronic_conditions` RESTRICT (lookup, §6). Extra cols: `diagnosed_on date NULL`, `recorded_by uuid NULL`.

#### B6. `patient_emergency_contacts`
- **Purpose:** `EmergencyContact` (profile bundle). One primary contact today; table allows several.
- **PK:** `id` · **FK:** `patient_id → patients` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| patient_id | uuid | no | — | FK | — | Patient |
| name | varchar(120) | no | — | non-empty | `Huda Nassar` | Contact name |
| relationship | varchar(60) | no | — | — | `Spouse` | Relationship |
| phone | varchar(30) | no | — | phone | `+20 100 …` | Phone |
| is_primary | boolean | no | true | one primary per patient (partial unique index) | true | — |

#### B7. `patient_insurance`
- **Purpose:** `InsuranceInfo` (provider, policyNumber, plan, validUntil) + free-text `insurance` on Patient.
- **PK:** `id` · **Unique:** (`patient_id`, `policy_number`) · **FKs:** `patient_id → patients` CASCADE, `provider_id → insurance_providers` RESTRICT (lookup)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| patient_id | uuid | no | — | FK | — | Patient |
| provider_id | uuid | no | — | FK lookup | — | Insurer (`provider` string today) |
| policy_number | varchar(60) | no | — | non-empty | `AXA-99120` | Policy no. (PII) |
| plan | varchar(80) | yes | null | — | `Gold family` | Plan name |
| valid_until | date | yes | null | — | `2027-01-01` | Expiry |
| is_active | boolean | no | true | — | true | Current policy |

#### B8. `patient_documents`
- **Purpose:** Uploaded patient files (`PatientDocument`: referral/consent/external-record/insurance/report; UX 2.3 Documents tab drag-and-drop).
- **PK:** `id` · **FKs:** `patient_id → patients` CASCADE, `uploaded_by → users` SET NULL, `file_id → files` (§12)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| patient_id | uuid | no | — | FK | — | Patient |
| name | varchar(200) | no | — | non-empty | `Referral - cardiology.pdf` | Display name |
| category | document_category | no | — | referral / consent / external-record / insurance / report | `referral` | `DocumentCategory` |
| size_kb | int | no | — | >0 | 412 | `sizeKb` |
| file_id | uuid | no | — | FK files | — | Binary location |
| uploaded_by | uuid | yes | — | FK users | — | Uploader |
| uploaded_at | timestamptz | no | now() | — | — | Upload time |

#### B9. `patient_notes`
- **Purpose:** Doctor clinical notes on the patient (`ClinicalNote`: title, body, signed; unsigned notes appear in the Overview action queue).
- **PK:** `id` · **FKs:** `patient_id → patients` CASCADE, `author_id → users` RESTRICT

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| patient_id | uuid | no | — | FK | — | Patient |
| author_id | uuid | no | — | FK | — | `author` (name denormalized in DTO) |
| authored_at | timestamptz | no | now() | — | — | `authoredAt` |
| title | varchar(200) | no | — | non-empty | `Follow-up plan` | Title |
| body | text | no | — | — | — | Note body (PHI) |
| signed | boolean | no | false | must be true before record is final | false | Signature state |
| signed_at | timestamptz | yes | null | set when signed | — | Attribution |
| ai_assisted | boolean | no | false | — | false | AI-draft provenance ("AI-assisted, reviewed by …" — UX 2.5) |

#### B10. `patient_medical_history`
- **Purpose:** `MedicalHistoryEvent` — diagnosis / surgery / procedure / hospitalization / vaccination timeline.
- **PK:** `id` · **FK:** `patient_id → patients` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| patient_id | uuid | no | — | FK | — | Patient |
| kind | history_event_kind | no | — | 5 values | `surgery` | `HistoryEventKind` |
| title | varchar(200) | no | — | non-empty | `Appendectomy` | Event |
| occurred_on | date | no | — | past | `2019-04-02` | `date` |
| detail | text | yes | null | — | — | `detail` |
| facility | varchar(120) | yes | null | — | `Cairo General` | `facility` |
| recorded_by | uuid | yes | null | FK users | — | Provenance |

#### B11. `patient_vital_signs`
- **Purpose:** Vitals snapshots (`VitalSigns` = `RecordVitalSigns`, identical shapes). One table serves both patient-profile "latest vitals" and per-record vitals (`record_id` set when captured during an encounter).
- **PK:** `id` · **FKs:** `patient_id → patients` CASCADE, `record_id → medical_records` SET NULL, `recorded_by → users` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| patient_id | uuid | no | — | FK | — | Patient |
| record_id | uuid | yes | null | FK | — | Encounter that captured it |
| recorded_at | timestamptz | no | now() | — | — | `recordedAt` |
| blood_pressure_systolic | smallint | no | — | 40–300 | 128 | Split from `bloodPressure` "128/82" (see §16) |
| blood_pressure_diastolic | smallint | no | — | 20–200 | 82 | — |
| heart_rate_bpm | smallint | no | — | 20–300 | 76 | `heartRateBpm` |
| temperature_c | numeric(4,1) | no | — | 30–45 | 36.8 | `temperatureC` |
| respiratory_rate | smallint | no | — | 4–80 | 16 | `respiratoryRate` |
| oxygen_saturation | smallint | no | — | 0–100 | 98 | `%` SpO₂ |
| weight_kg | numeric(5,2) | no | — | >0 | 84.00 | `weightKg` |
| height_cm | numeric(5,1) | no | — | >0 | 178.0 | `heightCm` |
| bmi | numeric(4,1) | yes | generated | weight/(height/100)² — derived | 26.5 | Stored generated column |

#### B12. `patient_clinical_alerts`
- **Purpose:** `ClinicalAlert` — fixed, non-dismissible banner content (severity critical|warning).
- **PK:** `id` · **FK:** `patient_id → patients` CASCADE. Columns: `severity alert_severity NOT NULL` (critical/warning), `message varchar(300) NOT NULL`, `active boolean DEFAULT true`, `created_by`, audit cols.

#### B13. `patient_medications`
- **Purpose:** Current/past medication list on the profile (`MedicationRecord`: name, dosage, frequency, startDate, endDate, prescribedBy, status). Rows are materialized from prescriptions but external/self-reported meds can exist without an Rx.
- **PK:** `id` · **FKs:** `patient_id → patients` CASCADE, `prescription_id → prescriptions` SET NULL, `prescribed_by → doctors` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| patient_id | uuid | no | — | FK | — | Patient |
| prescription_id | uuid | yes | null | FK | — | Source Rx when internal |
| name | varchar(120) | no | — | non-empty | `Metformin` | Drug name |
| dosage | varchar(60) | no | — | — | `850 mg` | Dose |
| frequency | varchar(60) | no | — | — | `Twice daily` | Frequency |
| start_date | date | no | — | — | — | `startDate` |
| end_date | date | yes | null | ≥ start_date | — | `endDate` |
| prescribed_by | uuid | yes | null | FK doctors | — | Prescriber |
| status | medication_status | no | 'active' | active / completed / discontinued | `active` | `MedicationStatus` |

#### B14. `patient_studies`
- **Purpose:** Lab/imaging study placeholders grouped by category (`StudyCategory`/`StudyRecord`; UX 2.3 Imaging tab: modality, study, date, status). Radiology has no dedicated module yet — this is its confirmed foothold.
- **PK:** `id` · **FKs:** `patient_id → patients` CASCADE, `lab_order_id → lab_orders` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| patient_id | uuid | no | — | FK | — | Patient |
| modality | study_modality | no | — | lab / imaging (category groups in code) | `imaging` | Which tab bucket |
| category_label | varchar(80) | no | — | — | `X-Ray` | `StudyCategory.label` |
| name | varchar(200) | no | — | — | `Chest X-Ray PA` | `StudyRecord.name` |
| performed_on | date | no | — | — | — | `date` |
| status | study_status | no | — | completed / pending / critical | `completed` | `StudyStatus` |
| lab_order_id | uuid | yes | null | FK | — | Link when it is an internal lab order |

---
### Domain C — Scheduling

#### C1. `appointments`
- **Purpose:** The appointment book. Evidence: `Appointment` type + `availableActions()` status machine, mock IDs `APT-3001…`, UX §2.4 flows, §3.5 admin oversight.
- **PK:** `id` · **Unique:** `public_id` (`APT-…`)
- **FKs:** `patient_id → patients` RESTRICT, `doctor_id → doctors` RESTRICT, `department_id → departments` SET NULL, `visit_type_id → visit_types` RESTRICT

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| public_id | varchar(20) | no | — | `APT-` prefix | `APT-3001` | Business id |
| patient_id | uuid | no | — | FK | — | Patient (list DTO denormalizes name/mrn/phone/age/gender) |
| doctor_id | uuid | no | — | FK | — | `doctor` (free-text name today — §16) |
| department_id | uuid | yes | — | FK | — | `department` |
| visit_type_id | uuid | no | — | FK lookup | — | `visitType` (Consultation, Follow-up, …) |
| starts_at | timestamptz | no | — | — | `2026-07-20T15:00Z` | `dateTime` |
| duration_min | smallint | no | 30 | >0; defaults 15/20/30/45/60 (UX 2.11 Availability) | 30 | `durationMin` |
| status | appointment_status | no | 'pending' | 7 values; transitions per §5.1 | `confirmed` | `AppointmentStatus` |
| priority | appointment_priority | no | 'normal' | low / normal / high / urgent | `normal` | `AppointmentPriority` |
| is_new_patient | boolean | no | false | — | false | `isNewPatient` |
| is_follow_up | boolean | no | false | — | false | `isFollowUp` |
| reason | varchar(300) | no | — | non-empty | `Quarterly diabetes review` | Patient's stated reason |
| notes | text | yes | null | — | — | `notes` |
| cancelled_reason | varchar(300) | yes | null | required when status=cancelled/rejected (P4 modal) | — | Confirm-with-reason |
| created_by | uuid | yes | — | FK users | — | Who booked |
| created_at / updated_at | timestamptz | no | now() | — | — | Audit |

#### C2. `appointment_events`
- **Purpose:** Full appointment history — "every transition with actor + timestamp" (UX §2.4 detail drawer, §3.5 admin drawer). Also serves rollback/audit of accept/reject/reschedule/no-show.
- **PK:** `id` · **FKs:** `appointment_id → appointments` CASCADE, `actor_id → users` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| appointment_id | uuid | no | — | FK | — | Appointment |
| occurred_at | timestamptz | no | now() | — | — | When |
| action | appointment_action | no | — | approve/reject/cancel/reschedule/complete/no-show + created/nudged/reassigned (UX 3.5) | `reschedule` | `AppointmentAction` extended |
| from_status | appointment_status | yes | — | — | `scheduled` | Before |
| to_status | appointment_status | yes | — | — | `rescheduled` | After |
| actor_id | uuid | yes | — | FK | — | Who acted |
| reason | varchar(300) | yes | null | required for destructive actions | — | P4 reason |
| detail | jsonb | yes | null | — | `{"newStart":"…"}` | e.g. proposed slots, old/new time |

---

### Domain D — Medical Records / EHR

#### D1. `medical_records`
- **Purpose:** Clinical encounter documents. Evidence: `MedicalRecord` type, IDs `MR-10001…`, UX §2.3 Visits.
- **PK:** `id` · **Unique:** `public_id` (`MR-…`)
- **FKs:** `patient_id → patients` RESTRICT, `doctor_id → doctors` RESTRICT, `department_id → departments` SET NULL, `appointment_id → appointments` SET NULL (inferred link, encounter usually stems from an appointment)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| public_id | varchar(20) | no | — | `MR-` prefix | `MR-10001` | Business id |
| patient_id | uuid | no | — | FK | — | Patient |
| doctor_id | uuid | no | — | FK | — | Author (`doctor`) |
| department_id | uuid | yes | — | FK | — | `department` |
| visit_date | timestamptz | no | — | — | — | `visitDate` |
| visit_type | varchar(40) | no | — | RECORD_VISIT_TYPES incl. Emergency, Telemedicine | `Consultation` | Visit type (lookup) |
| status | record_status | no | 'draft' | draft / active / completed / archived | `active` | `MedicalRecordStatus` |
| priority | record_priority | no | 'normal' | low / normal / high / critical | `normal` | `MedicalRecordPriority` |
| chief_complaint | text | no | — | non-empty | `Chest tightness on exertion` | `chiefComplaint` |
| history_of_present_illness | text | no | — | — | — | HPI |
| physical_examination | text | no | — | — | — | Exam findings |
| follow_up_date | date | yes | null | ≥ visit_date | — | `followUpDate` |
| created_at / updated_at | timestamptz | no | now() | — | — | Audit; records are never hard-deleted (UX 1.5.3) |

#### D2. `record_diagnoses`
- **Purpose:** ICD-10 coded diagnoses per record (`RecordDiagnosis`, `DIAGNOSES` vocabulary of 14 ICD-10 codes).
- **PK:** `id` · **Unique:** (`record_id`,`icd_code_id`) · **FKs:** `record_id → medical_records` CASCADE, `icd_code_id → icd_codes` RESTRICT

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| record_id | uuid | no | — | FK | — | Record |
| icd_code_id | uuid | no | — | FK lookup | — | ICD-10 concept (`E11.9`) |
| is_primary | boolean | no | false | max one primary per record (partial unique index) | true | `isPrimary` |
| recorded_by | uuid | yes | — | FK users | — | Provenance |
| recorded_at | timestamptz | no | now() | — | — | — |

#### D3. `record_vital_signs`
Same shape as `patient_vital_signs` (B11) — implemented as B11 rows with `record_id` set; no separate table needed. (Kept in the entity list as a logical entity; physical table is shared.)

#### D4. `record_treatment_plan_items`
- **Purpose:** `treatmentPlan: readonly string[]`.
- **PK:** `id` · **FK:** `record_id → medical_records` CASCADE. Columns: `record_id`, `position smallint NOT NULL`, `text varchar(500) NOT NULL`; unique (`record_id`,`position`).

#### D5. `record_medications`
- **Purpose:** Medications prescribed within the encounter (`RecordMedication`).
- **PK:** `id` · **FKs:** `record_id → medical_records` CASCADE, `prescription_id → prescriptions` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| record_id | uuid | no | — | FK | — | Record |
| name | varchar(120) | no | — | — | `Atorvastatin` | Drug |
| dosage | varchar(60) | no | — | — | `20 mg` | Dose |
| frequency | varchar(60) | no | — | — | `Once daily at night` | Frequency |
| instructions | text | yes | null | — | — | `instructions` |
| status | medication_status | no | 'active' | active / completed / discontinued | — | `RecordMedicationStatus` |
| prescription_id | uuid | yes | null | FK | — | Link to formal Rx |

#### D6. `record_allergies`
- **Purpose:** Allergies documented at the encounter (`RecordAllergy`). Physically a snapshot join onto `patient_allergies`; kept as its own table because the record is an immutable clinical document.
- **PK:** `id` · **FK:** `record_id` CASCADE. Columns: `allergen varchar(120)`, `severity allergy_severity`, `reaction varchar(200)`.

#### D7. `record_notes`
- **Purpose:** `RecordClinicalNote` (author, title, body, signed) — same columns as `patient_notes` (B9) plus `record_id → medical_records` CASCADE instead of/alongside `patient_id`.

#### D8. `record_attachments`
- **Purpose:** `RecordAttachment` — kind: lab-result / imaging / referral / consent / external-report.
- **PK:** `id` · **FKs:** `record_id` CASCADE, `file_id → files`, `uploaded_by → users` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| record_id | uuid | no | — | FK | — | Record |
| name | varchar(200) | no | — | — | `CBC panel.pdf` | Filename |
| kind | record_attachment_kind | no | — | 5 values | `lab-result` | `RecordAttachmentKind` |
| size_kb | int | no | — | >0 | 220 | Size |
| file_id | uuid | no | — | FK files | — | Binary |
| uploaded_by | uuid | yes | — | FK | — | Uploader |
| uploaded_at | timestamptz | no | now() | — | — | — |

#### D9. `record_timeline_events`
- **Purpose:** `RecordTimelineEvent` — created / vitals-recorded / diagnosis-added / medication-prescribed / note-added / attachment-added / status-changed.
- **PK:** `id` · **FKs:** `record_id` CASCADE, `actor_id → users` SET NULL. Columns: `kind record_timeline_kind NOT NULL`, `occurred_at timestamptz NOT NULL DEFAULT now()`, `actor_id`, `detail varchar(300)`.

---

### Domain E — Laboratory

#### E1. `lab_test_catalogue`
- **Purpose:** Orderable test definitions with LOINC-style codes (`TestSpec` in `labs/model/catalogue.ts`; "Replaced by the catalogue endpoint when the API lands").
- **PK:** `id` · **Unique:** `code`

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| name | varchar(120) | no | — | non-empty | `Complete Blood Count (CBC)` | Test name |
| code | varchar(20) | no | — | LOINC format | `58410-2` | LOINC code |
| category | lab_test_category | no | — | 8 categories | `Hematology` | `LabTestCategory` |
| specimen_type | lab_specimen_type | no | — | 9 types | `Whole blood` | Default specimen |
| container | varchar(60) | no | — | — | `EDTA (lavender top)` | Collection container |
| active | boolean | no | true | — | true | Orderable flag |

#### E2. `lab_analyte_specs`
- **Purpose:** Per-test analytes with reference ranges & critical thresholds (`AnalyteSpec`).
- **PK:** `id` · **Unique:** (`test_id`,`analyte`) · **FK:** `test_id → lab_test_catalogue` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| test_id | uuid | no | — | FK | — | Parent test |
| analyte | varchar(80) | no | — | non-empty | `Potassium` | Analyte name |
| unit | varchar(20) | no | — | — | `mmol/L` | Unit |
| ref_low | numeric(10,3) | yes | null | both null ⇒ qualitative | 3.5 | Reference low |
| ref_high | numeric(10,3) | yes | null | — | 5.1 | Reference high |
| decimals | smallint | yes | 0 | 0–3 | 1 | Display precision |
| critical_low | numeric(10,3) | yes | null | < ref_low | 2.5 | Critical threshold |
| critical_high | numeric(10,3) | yes | null | > ref_high | 6.0 | Critical threshold |
| qualitative_options | text[] | yes | null | index 0 = normal/expected | `{Negative,Positive}` | Qualitative results |

#### E3. `lab_orders`
- **Purpose:** A lab order/test instance (`LabTest`, IDs `LAB-100001…`).
- **PK:** `id` · **Unique:** `public_id` · **FKs:** `patient_id → patients` RESTRICT, `test_id → lab_test_catalogue` RESTRICT, `ordered_by → doctors` RESTRICT, `department_id → departments` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| public_id | varchar(20) | no | — | `LAB-` prefix | `LAB-100001` | Business id |
| patient_id | uuid | no | — | FK | — | Patient |
| test_id | uuid | no | — | FK | — | Catalogue test (`testName`/`testCode`/`category` denormalized in DTO) |
| department_id | uuid | yes | — | FK | — | Ordering department (`LAB_DEPARTMENTS`) |
| ordered_by | uuid | no | — | FK | — | Ordering doctor |
| clinical_indication | varchar(300) | no | — | non-empty | `Monitor renal function` | `clinicalIndication` |
| status | lab_status | no | 'ordered' | ordered / collected / processing / completed / cancelled | `processing` | `LabTestStatus` |
| priority | lab_priority | no | 'routine' | routine / urgent / stat | `stat` | `LabPriority` |
| requested_at | timestamptz | no | now() | — | — | `requestedDate` |
| collected_at | timestamptz | yes | null | set when status ≥ collected | — | `collectedDate` |
| completed_at | timestamptz | yes | null | set when completed | — | `completedDate` |
| interpretation | text | yes | null | present only when completed | — | `interpretation` |
| has_critical_result | boolean | no | false | derived: any result with critical flag (trigger-maintained) | false | `hasCriticalResult` |
| reviewed_at | timestamptz | yes | null | required workflow for critical results (UX 2.6 "Mark reviewed") | — | Review state |
| reviewed_by | uuid | yes | null | FK users | — | Reviewer |
| created_at / updated_at | timestamptz | no | now() | — | — | Audit |

#### E4. `lab_specimens`
- **Purpose:** 1:1 specimen document (`LabSpecimen`).
- **PK:** `lab_order_id` (1:1, CASCADE)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| lab_order_id | uuid | no | — | FK unique | — | PK/FK |
| type | lab_specimen_type | no | — | 9 values | `Serum` | `LabSpecimenType` |
| container | varchar(60) | no | — | — | `SST (gold top)` | Container |
| collection_site | varchar(80) | no | — | — | `Left antecubital` | Site |
| collected_by | varchar(120) | no | — | staff name/FK future | `Nurse Salma Ibrahim` | Collector |
| collected_at | timestamptz | no | — | — | — | Collection time |
| received_at | timestamptz | yes | null | ≥ collected_at | — | Lab receipt |
| condition | lab_specimen_condition | no | 'Acceptable' | Acceptable / Hemolyzed / Clotted / Insufficient volume | `Acceptable` | Condition |
| volume | varchar(20) | no | — | — | `5 mL` | Volume |

#### E5. `lab_results`
- **Purpose:** Result items (`LabResultItem`) — analyte, value, flag against reference range.
- **PK:** `id` · **Unique:** (`lab_order_id`,`analyte`) · **FKs:** `lab_order_id → lab_orders` CASCADE, `analyte_spec_id → lab_analyte_specs` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| lab_order_id | uuid | no | — | FK | — | Order |
| analyte_spec_id | uuid | yes | — | FK | — | Catalogue analyte |
| analyte | varchar(80) | no | — | — | `Hemoglobin` | Denormalized name |
| value_text | varchar(60) | no | — | numeric string or categorical | `13.2` / `Negative` | `value` |
| value_numeric | numeric(12,3) | yes | null | null for qualitative | 13.2 | `numericValue` |
| unit | varchar(20) | no | — | — | `g/dL` | Unit |
| ref_low | numeric(10,3) | yes | null | snapshot of range at result time | 12 | `referenceRange.low` |
| ref_high | numeric(10,3) | yes | null | — | 17 | `referenceRange.high` |
| ref_text | varchar(60) | no | — | — | `12–17` / `Negative` | `referenceRange.text` |
| flag | lab_result_flag | no | 'normal' | 6 values | `critical-high` | `LabResultFlag` |
| resulted_at | timestamptz | no | now() | — | — | Entry time |
| verified_by | uuid | yes | null | FK users | — | "Verified & released" timeline step |

#### E6. `lab_attachments`
Same structure as D8 with `lab_order_id` FK and `kind lab_attachment_kind` (report / addendum / external / raw-data) + `uploaded_by`, `uploaded_at`, `size_kb`, `file_id`.

#### E7. `lab_timeline_events`
- **Purpose:** `LabTimelineEvent` — ordered / collected / received / processing / resulted / verified / cancelled.
- **PK:** `id` · **FK:** `lab_order_id` CASCADE. Columns: `kind lab_timeline_kind NOT NULL`, `occurred_at timestamptz NOT NULL`, `actor varchar(120) NOT NULL` (future FK users), `detail varchar(300)`.

---

### Domain F — Pharmacy

#### F1. `medications` (formulary)
- **Purpose:** Medication master (`Medication` + `MedicationSpec` catalogue; "Replaced by the formulary endpoint when the API lands").
- **PK:** `id` · **Unique:** (`name`,`generic_name`)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| name | varchar(120) | no | — | non-empty | `Coumadin` | Brand name |
| generic_name | varchar(120) | no | — | non-empty | `Warfarin` | Generic |
| category | medication_category | no | — | 12 categories | `Anticoagulants` | `MedicationCategory` |
| form | medication_form | no | — | 8 forms | `Tablet` | `MedicationForm` |
| route | medication_route | no | — | 8 routes | `Oral` | Default route |
| manufacturer | varchar(80) | no | — | — | `BMS` | Manufacturer |
| is_controlled | boolean | no | false | — | false | Controlled substance flag |
| is_high_risk | boolean | no | false | — | true | High-alert med |
| interaction_note | text | yes | null | — | `Numerous interactions; INR monitoring required.` | Canned interaction note |
| allergy_class | varchar(60) | yes | null | matches `patient_allergies.allergen` class | `Penicillin` | Allergy screening class |
| frequencies | text[] | no | '{}' | — | `{Once daily}` | Allowed frequencies (catalogue) |
| durations_days | smallint[] | no | '{}' | — | `{30,60,90}` | Typical durations |
| active | boolean | no | true | — | true | Prescribable |

#### F2. `medication_strengths`
- **Purpose:** `strengths: readonly string[]` per catalogue entry.
- **PK:** `id` · **Unique:** (`medication_id`,`strength`) · **FK:** `medication_id → medications` CASCADE. Columns: `strength varchar(30) NOT NULL` (e.g. `500 mg`), `position smallint`.

#### F3. `prescriptions`
- **Purpose:** The prescription document (`Prescription`, IDs `RX-200001…`; UX §2.7 stepper + lifecycle).
- **PK:** `id` · **Unique:** `public_id` · **FKs:** `patient_id → patients` RESTRICT, `medication_id → medications` RESTRICT, `prescribing_doctor_id → doctors` RESTRICT, `department_id → departments` SET NULL, `record_id → medical_records` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| public_id | varchar(20) | no | — | `RX-` prefix | `RX-200001` | Business id |
| patient_id | uuid | no | — | FK | — | Patient (DTO denormalizes allergies for the safety strip) |
| medication_id | uuid | no | — | FK | — | Drug |
| strength | varchar(30) | no | — | ∈ medication_strengths | `5 mg` | Chosen strength |
| dosage | varchar(60) | no | — | non-empty | `1 tablet` | `dosage` |
| frequency | varchar(60) | no | — | — | `Once daily` | `frequency` |
| route | medication_route | no | — | 8 routes | `Oral` | `route` |
| duration_days | smallint | no | — | >0 | 30 | `durationDays` (`duration` label derived) |
| quantity | int | no | — | >0 | 30 | `quantity` |
| instructions | text | no | — | plain language (UX 2.7 step 3) | `Take with food` | Patient instructions |
| prescribing_doctor_id | uuid | no | — | FK | — | Prescriber |
| department_id | uuid | yes | — | FK | — | `PRESCRIBER_DEPARTMENTS` |
| status | prescription_status | no | 'pending-approval' | 5 values; lifecycle §5.3 | `active` | `PrescriptionStatus` |
| start_date | date | no | — | — | — | `startDate` |
| end_date | date | no | — | ≥ start_date; = start + duration | — | `endDate` |
| refills_allowed | smallint | no | 0 | ≥0 | 3 | `refillsAllowed` |
| refills_remaining | smallint | no | 0 | 0 ≤ x ≤ refills_allowed | 2 | `refillsRemaining` |
| refill_status | refill_status | no | 'none' | none / available / due / pending (derived but stored in DTO) | `available` | `RefillStatus` |
| signed_at | timestamptz | yes | null | required before send (UX 2.7 "Sign & send") | — | Signature |
| discontinued_reason | varchar(300) | yes | null | required when discontinued (P4) | — | Reason |
| created_at / updated_at | timestamptz | no | now() | — | — | Audit |

#### F4. `prescription_safety_warnings`
- **Purpose:** Safety-screen outcomes persisted with the Rx (`SafetyWarning`; UX 2.7: severe-interaction acknowledgment is audit-logged).
- **PK:** `id` · **FK:** `prescription_id` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| prescription_id | uuid | no | — | FK | — | Rx |
| kind | safety_warning_kind | no | — | interaction / allergy / duplicate / dosage | `interaction` | `SafetyWarningKind` |
| severity | safety_warning_severity | no | — | info / warning / critical | `critical` | `SafetyWarningSeverity` |
| title | varchar(200) | no | — | — | `Warfarin × NSAID` | Title |
| detail | text | no | — | — | — | Detail |
| acknowledged_by | uuid | yes | null | FK users; required to proceed past severe interaction | — | Explicit acknowledgment |
| acknowledged_reason | varchar(300) | yes | null | required with acknowledgment | — | Audit-logged reason |

#### F5. `prescription_notes`
- **PK:** `id` · **FK:** `prescription_id` CASCADE, `author_id → users`. Columns: `authored_at timestamptz`, `body text NOT NULL` (`PrescriptionNote`).

#### F6. `prescription_history_entries`
- **Purpose:** `MedicationHistoryEntry` (date, event, detail) — the patient's medication history shown on the detail page.
- **PK:** `id` · **FK:** `prescription_id` CASCADE. Columns: `occurred_on date`, `event varchar(120)`, `detail varchar(300)`.

#### F7. `prescription_timeline_events`
- **Purpose:** `PrescriptionTimelineEvent` — prescribed / dispensed / refill-requested / refill-approved / renewed / note-added / discontinued / expired.
- **PK:** `id` · **FK:** `prescription_id` CASCADE. Columns: `kind prescription_timeline_kind NOT NULL`, `occurred_at timestamptz`, `actor_id uuid FK users SET NULL`, `detail varchar(300)`.

---

### Domain G — Communication

#### G1. `conversations`
- **Purpose:** Messaging threads (`Conversation` in messaging model: direct or care-team group with topic).
- **PK:** `id`

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| kind | conversation_kind | no | 'direct' | direct / group / announcement / system (messaging + comm-center unions) | `direct` | Thread type |
| topic | varchar(200) | yes | null | required for group threads | `ICU handover` | `topic` |
| patient_id | uuid | yes | null | FK patients SET NULL | — | Bound patient context (UX 2.8 third pane) |
| read_only | boolean | no | false | true for announcement/system channels | false | `readOnly` |
| last_activity_at | timestamptz | no | now() | — | — | Sort key |
| created_at | timestamptz | no | now() | — | — | — |

#### G2. `conversation_participants`
- **Purpose:** M:N membership + all per-user thread state (unreadCount, pinned, starred, archived, muted, draft — these are per-viewer, not thread-global; see §16).
- **PK:** (`conversation_id`,`user_id`) · **FKs:** both CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| conversation_id | uuid | no | — | FK | — | Thread |
| user_id | uuid | no | — | FK | — | Member (`Contact` roster: doctor/nurse/pharmacist/patient roles) |
| unread_count | int | no | 0 | ≥0 | 2 | `unreadCount` |
| pinned | boolean | no | false | — | — | `pinned` |
| starred | boolean | no | false | — | — | `starred` |
| archived | boolean | no | false | — | — | `archived` |
| muted | boolean | no | false | — | — | `muted` |
| draft | text | no | '' | — | — | `draft` composer text |
| favorite | boolean | no | false | — | — | `Contact.favorite` |
| last_read_at | timestamptz | yes | null | — | — | Read receipts source |
| joined_at | timestamptz | no | now() | — | — | — |

#### G3. `messages`
- **Purpose:** `ChatMessage` (messaging): author, kind text|system, markdown-lite body, status.
- **PK:** `id` · **FKs:** `conversation_id → conversations` CASCADE, `author_id → users` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| conversation_id | uuid | no | — | FK | — | Thread |
| author_id | uuid | yes | — | FK | — | Sender (null for system) |
| kind | message_kind | no | 'text' | text / system | `text` | `MessageKind` |
| body | text | no | — | markdown-lite | — | Content (PHI-adjacent; edit window 5 min, no delete in patient threads — UX 2.8) |
| sent_at | timestamptz | no | now() | — | — | `sentAt` |
| status | message_status | no | 'sent' | sending / sent / delivered / read / failed | `read` | `MessageStatus` (client `sending`/`failed` transient) |
| edited_at | timestamptz | yes | null | within 5 min of sent_at (UX 2.8) | — | "edited" mark |

#### G4. `message_attachments`
- **PK:** `id` · **FKs:** `message_id → messages` CASCADE, `file_id → files`. Columns: `kind attachment_kind NOT NULL` (file/image), `name varchar(200)`, `size_bytes bigint` (`sizeLabel` derived), `scanned_at timestamptz NULL` ("attachments are scanned before download links activate" — UX 2.8).

#### G5. `conversation_shared_links`
- **Purpose:** `SharedLink` (label, url) surfaced in the conversation details drawer.
- **PK:** `id` · **FK:** `conversation_id` CASCADE. Columns: `label varchar(120)`, `url text`, `shared_by uuid`, `shared_at timestamptz`.

#### G6. `notifications`
- **Purpose:** `DoctorNotification` — the bell feed and Notifications center.
- **PK:** `id` · **FKs:** `recipient_id → users` CASCADE; related links (all SET NULL): `patient_id`, `record_id → medical_records`, `lab_order_id`, `prescription_id`, `appointment_id`

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK (`NTF-…` public id optional) |
| recipient_id | uuid | no | — | FK | — | Owner of the feed |
| title | varchar(200) | no | — | non-empty | `Critical lab result` | `title` |
| body | text | no | — | — | — | `body` |
| category | notification_category | no | — | 8 categories | `laboratory` | `NotificationCategory` |
| priority | notification_priority | no | 'normal' | normal / important / critical | `critical` | `NotificationPriority` |
| kind | notification_kind | no | — | alert / reminder / update | `alert` | `NotificationKind` |
| sender | varchar(120) | no | — | — | `Lab System` | `sender` display |
| read_at | timestamptz | yes | null | — | — | `read` flag |
| archived | boolean | no | false | — | — | `archived` |
| favorite | boolean | no | false | — | — | `favorite` |
| pinned | boolean | no | false | critical lab alerts pinned until acted on (UX 2.9) | — | `pinned` |
| patient_id / record_id / lab_order_id / prescription_id / appointment_id | uuid | yes | null | FKs | — | `NotificationRelated` deep links |
| created_at | timestamptz | no | now() | — | — | `createdAt` |

#### G7. `notification_preferences`
- **Purpose:** `NotificationPreferences` per user — channels, quiet hours, per-category opt-in ("security cannot be disabled — enforced in UI", must also be a DB CHECK).
- **PK:** `user_id` (1:1 CASCADE)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| user_id | uuid | no | — | FK unique | — | PK |
| channel_email | boolean | no | true | — | — | `channels.email` |
| channel_sms | boolean | no | false | — | — | `channels.sms` |
| channel_push | boolean | no | true | — | — | `channels.push` |
| channel_desktop | boolean | no | false | — | — | `channels.desktop` |
| channel_in_app | boolean | no | true | — | — | `channels.inApp` |
| quiet_hours_enabled | boolean | no | false | — | — | `quietHours.enabled` |
| quiet_from | time | no | '22:00' | HH:MM | — | `quietHours.from` |
| quiet_to | time | no | '07:00' | HH:MM | — | `quietHours.to` |
| cat_appointments … cat_security | boolean ×8 | no | true | CHECK (cat_security = true) | — | Per-category opt-in (security locked on) |

#### G8. `broadcast_channels`
- **Purpose:** Communication-center announcement/system channels (`Conversation` in notifications model: name, kind announcement|system, caption, readOnly). Physically representable as `conversations` rows with kind announcement/system; kept as a logical entity.

---

### Domain H — AI Assistant

#### H1. `ai_conversations`
- **Purpose:** `AiConversation` with explicit patient-context binding ("AI never has cross-patient context in a single thread" — UX 2.5).
- **PK:** `id` · **FKs:** `owner_id → users` CASCADE, `patient_id → patients` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| owner_id | uuid | no | — | FK | — | The doctor (retained per doctor) |
| title | varchar(200) | no | — | non-empty | `HbA1c trend question` | `title` |
| context_mode | ai_context_mode | no | 'general' | general / patient / record / labs / pharmacy | `labs` | `AiContextMode` |
| patient_id | uuid | yes | null | required when mode ≠ general (CHECK) | — | Bound patient |
| ref_public_id | varchar(20) | yes | null | e.g. `LAB-100429` for record/labs/pharmacy modes | `LAB-100429` | `refId` |
| favorite | boolean | no | false | — | — | `favorite` |
| created_at / updated_at | timestamptz | no | now() | — | — | Audit |

#### H2. `ai_messages`
- **PK:** `id` · **FK:** `conversation_id → ai_conversations` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| conversation_id | uuid | no | — | FK | — | Thread |
| role | ai_chat_role | no | — | user / assistant | `assistant` | `ChatRole` |
| content | text | no | — | markdown | — | `content` |
| status | ai_message_status | no | 'complete' | complete / stopped / error | `complete` | `ChatMessageStatus` |
| error | varchar(300) | yes | null | set only when status=error | — | `error` |
| created_at | timestamptz | no | now() | — | — | `createdAt` |
| feedback | smallint | yes | null | -1 / +1 (thumbs — UX 2.5 telemetry) | — | Response feedback |

#### H3. `ai_user_settings`
- **Purpose:** `AiSettings` per user.
- **PK:** `user_id` (1:1 CASCADE). Columns: `temperature numeric(2,1) NOT NULL DEFAULT 0.3 CHECK (temperature BETWEEN 0 AND 1)`, `response_length ai_response_length DEFAULT 'balanced'`, `language ai_language DEFAULT 'en'` (en/ar), `auto_context boolean DEFAULT true`, `streaming boolean DEFAULT true`, `favorite_prompt_ids uuid[] DEFAULT '{}'`.

#### H4. `ai_prompt_templates`
- **Purpose:** Capability/prompt cards (`model/prompts.ts`; ids like `summarize-patient`, `drug-interactions`).
- **PK:** `id` · **Unique:** `slug`. Columns: `slug varchar(60)`, `label varchar(120)`, `prompt_text text`, `context_mode ai_context_mode NULL`, `active boolean DEFAULT true`.

---

### Domain I — Reports & Analytics

#### I1. `saved_reports`
- **Purpose:** `SavedReport` — named filter snapshots per user.
- **PK:** `id` · **FK:** `owner_id → users` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| owner_id | uuid | no | — | FK | — | Owner |
| name | varchar(120) | no | — | non-empty | `Monthly revenue` | `name` |
| category | report_category | no | — | 9 categories | `revenue` | `ReportCategory` |
| date_range | date_range_key | no | 'month' | today/week/month/quarter/year/custom | `month` | `DateRangeKey` |
| favorite | boolean | no | false | — | — | `favorite` |
| filters | jsonb | no | '{}' | shape of `ReportFilters` | `{"department":"all",…}` | Filter snapshot |
| last_viewed_at | timestamptz | yes | null | — | — | `lastViewedAt` |
| created_at | timestamptz | no | now() | — | — | — |

#### I2. `scheduled_reports`
- **Purpose:** `ScheduledReport` — recurring emailed exports.
- **PK:** `id` · **FK:** `owner_id → users` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| owner_id | uuid | no | — | FK | — | Owner |
| name | varchar(120) | no | — | — | `Weekly practice digest` | `name` |
| category | report_category | no | — | — | `overview` | Category |
| frequency | schedule_frequency | no | — | daily / weekly / monthly | `weekly` | `ScheduleFrequency` |
| format | export_format | no | 'pdf' | csv / excel / pdf / print | `pdf` | `ExportFormat` |
| recipients | citext[] | no | — | ≥1 valid emails | `{doctor@medora.health}` | `recipients` |
| status | schedule_status | no | 'active' | active / paused | `active` | `ScheduleStatus` |
| next_run_at | timestamptz | no | — | future | — | `nextRunAt` |

#### I3. `scheduled_report_runs`
- **PK:** `id` · **FK:** `scheduled_report_id` CASCADE. Columns: `ran_at timestamptz NOT NULL`, `status run_status NOT NULL` (sent/failed), `error text NULL` (`ScheduleRun`).

---

### Domain J — User Settings

#### J1. `user_settings`
- **Purpose:** The per-user settings document minus what already normalized above (`SettingsDocument`: privacy + workflow slices; account fields live on `users`).
- **PK:** `user_id` (1:1 CASCADE)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| user_id | uuid | no | — | FK unique | — | PK |
| privacy_data_sharing | boolean | no | true | — | — | `PrivacySettings.dataSharing` |
| privacy_analytics | boolean | no | true | — | — | `analytics` |
| privacy_cookies | boolean | no | true | — | — | `cookies` |
| privacy_ai_data_usage | boolean | no | true | — | — | `aiDataUsage` |
| landing_page | landing_page | no | 'overview' | overview/patients/appointments/labs/messages | `overview` | `WorkflowPreferences.landingPage` |
| default_patient_tab | patient_tab | no | 'summary' | summary/records/labs/prescriptions | — | `defaultPatientTab` |
| default_records_tab | records_tab | no | 'all' | all/recent/critical | — | `defaultRecordsTab` |
| auto_save_drafts | boolean | no | true | — | — | `autoSaveDrafts` |
| date_format | varchar(10) | no | 'MM/DD/YYYY' | MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD | — | `DateFormat` |
| time_format | varchar(3) | no | '12h' | 12h / 24h | — | `TimeFormat` |
| timezone | varchar(60) | no | 'UTC' | IANA tz | `Africa/Cairo` | `timezone` |

#### J2. `user_interface_preferences`
- **Purpose:** `InterfaceSettings` + theme/locale/sidebar (`preferences.ts` schema).
- **PK:** `user_id` (1:1 CASCADE). Columns: `theme varchar(10) DEFAULT 'system'` (light/dark/system), `locale varchar(10) DEFAULT 'en'`, `sidebar_collapsed boolean DEFAULT false`, `density varchar(12) DEFAULT 'comfortable'` (comfortable/compact), `text_scale smallint DEFAULT 100 CHECK (90–130)`, `reduce_motion boolean DEFAULT false`, `high_contrast boolean DEFAULT false`, `focus_rings varchar(8) DEFAULT 'default'` (default/high), `keyboard_nav boolean DEFAULT false`.

#### J3. `user_integrations`
- **Purpose:** `IntegrationState` — google-calendar / outlook / zoom / teams connections per user.
- **PK:** (`user_id`,`integration`) · **FK:** `user_id` CASCADE

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| user_id | uuid | no | — | FK | — | Owner |
| integration | integration_id | no | — | google-calendar / outlook / zoom / teams | `zoom` | `IntegrationId` |
| connected | boolean | no | false | — | — | `connected` |
| connected_at | timestamptz | yes | null | — | — | `connectedAt` |
| account_label | varchar(120) | yes | null | — | `amelia@gmail.com` | `account` |
| oauth_tokens_enc | bytea | yes | null | encrypted | — | Provider tokens (write-only secret) |

---
### Domain K — Clinic Administration (Phase 17)

#### K1. `departments`
- **Purpose:** `Department` (administration types) — the normalization target for every free-text `department` string across modules.
- **PK:** `id` · **Unique:** `name` · **FK:** `head_staff_id → staff_members` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| name | varchar(80) | no | — | unique | `Cardiology` | Name |
| description | varchar(300) | no | '' | — | — | `description` |
| status | active_status | no | 'active' | active / inactive | `active` | `ActiveStatus` |
| head_staff_id | uuid | yes | null | FK | — | `headStaffId` |

Derived: `staff_count` (COUNT of staff_members) — stored in DTO, computed in DB.

#### K2. `staff_members`
- **Purpose:** `StaffMember` — clinic staff roster (doctor / nurse / receptionist / laboratory / pharmacy).
- **PK:** `id` · **Unique:** `email` · **FKs:** `department_id → departments` RESTRICT, `user_id → users` SET NULL (staff may or may not hold accounts)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| user_id | uuid | yes | null | FK | — | Optional platform account |
| name | varchar(120) | no | — | non-empty | `Nurse Salma Ibrahim` | Name |
| role | staff_role | no | — | 5 values | `nurse` | `StaffRole` |
| title | varchar(80) | no | — | — | `Head Nurse` | `title` |
| department_id | uuid | no | — | FK | — | `departmentId` |
| status | presence_status | no | 'off-duty' | on-duty / on-break / off-duty / on-leave | `on-duty` | `PresenceStatus` |
| phone | varchar(30) | no | — | phone | — | Contact |
| email | citext | no | — | email | — | Contact |
| working_hours | varchar(80) | no | — | — | `Mon–Fri 08:00–16:00` | `workingHours` |
| permissions | text[] | no | '{}' | — | `{queue.manage}` | `permissions` labels |
| avatar_url | text | yes | null | — | — | `avatarUrl` |

#### K3. `staff_shift_assignments`
- **Purpose:** `ShiftAssignment` — kind + 7-day boolean mask.
- **PK:** `id` · **Unique:** (`staff_id`,`kind`) · **FK:** `staff_id → staff_members` CASCADE. Columns: `kind shift_kind NOT NULL` (morning/evening/on-call/vacation/leave), `days boolean[7] NOT NULL` (index 0 = Monday).

#### K4. `rooms`
- **Purpose:** `Room` — consultation/lab/procedure/pharmacy/waiting spaces.
- **PK:** `id` · **Unique:** `name` · **FK:** `department_id → departments` RESTRICT. Columns: `kind room_kind`, `status room_status DEFAULT 'available'` (available/occupied/cleaning/maintenance), `capacity smallint CHECK (>0)`, `note varchar(300) NULL`.

#### K5. `resources`
- **Purpose:** `Resource` — inventory with reorder alerts.
- **PK:** `id`. Columns: `name varchar(120)`, `category varchar(80)`, `location varchar(120)`, `quantity int CHECK (≥0)`, `reorder_level int CHECK (≥0)`, `status resource_status` (in-stock/low/out — derivable from quantity vs reorder_level, stored for filter parity).

#### K6. `clinic_working_days`
- **Purpose:** `WorkingDay` — clinic weekly schedule.
- **PK:** `day` (`weekday` enum Mon…Sun, 7 rows). Columns: `open boolean NOT NULL`, `start_time time NOT NULL`, `end_time time NOT NULL CHECK (end_time > start_time)`, `break_label varchar(80) NULL`.

#### K7. `holidays`
- **Purpose:** `Holiday` — public/clinic holidays, optionally recurring.
- **PK:** `id` · **Unique:** (`name`,`date`). Columns: `name varchar(120)`, `date date NOT NULL`, `kind holiday_kind` (public/clinic), `recurring boolean DEFAULT false`.

#### K8. `queue_entries`
- **Purpose:** `QueueEntry` — live consultation queue with tickets.
- **PK:** `id` · **Unique:** `ticket` (per day) · **FKs:** `room_id → rooms` SET NULL, `patient_id → patients` SET NULL (mock stores only `patientName`)

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| ticket | varchar(10) | no | — | — | `A-014` | Ticket code |
| patient_id | uuid | yes | — | FK | — | Patient link |
| patient_name | varchar(120) | no | — | — | — | Display name |
| reason | varchar(200) | no | — | — | — | Visit reason |
| priority | queue_priority | no | 'routine' | routine / priority / urgent | — | `QueuePriority` |
| enqueued_at | timestamptz | no | now() | — | — | Basis of `waitingMinutes` (derived) |
| estimated_minutes | smallint | no | — | ≥0 | 15 | `estimatedMinutes` |
| room_id | uuid | yes | null | FK | — | Assigned room |
| delayed | boolean | no | false | — | — | `delayed` |

#### K9. `waiting_room_entries`
- **Purpose:** `WaitingPatient` — checked-in patients by area.
- **PK:** `id` · **FKs:** `patient_id → patients` SET NULL, `appointment_id → appointments` SET NULL. Columns: `patient_name varchar(120)`, `appointment_time timestamptz`, `checked_in_at timestamptz NOT NULL`, `area varchar(80)`, `status waiting_status` (waiting/called/in-room). `waitingMinutes` derived.

#### K10. `announcements`
- **Purpose:** `Announcement` — clinic announcements with priority/pin/expiry.
- **PK:** `id` · **FK:** `author_id → users` SET NULL

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| title | varchar(200) | no | — | non-empty | — | `title` |
| body | text | no | — | — | — | `body` |
| author_id | uuid | yes | — | FK | — | `author` |
| priority | announcement_priority | no | 'normal' | low / normal / high | — | `AnnouncementPriority` |
| pinned | boolean | no | false | — | — | `pinned` |
| archived | boolean | no | false | — | — | `archived` |
| created_at | timestamptz | no | now() | — | — | — |
| expires_at | timestamptz | yes | null | > created_at | — | `expiresAt` |

#### K11. `policies`
- **Purpose:** `Policy` — versioned clinic policies.
- **PK:** `id`. Columns: `title varchar(200)`, `category varchar(80)`, `summary text`, `version varchar(20)` (e.g. `v2.1`), `updated_at timestamptz`. Unique (`title`,`version`).

#### K12. `document_templates`
- **Purpose:** `DocumentTemplate` — prescription/certificate/referral/lab-request/radiology-request/discharge templates.
- **PK:** `id`. Columns: `name varchar(120)`, `kind template_kind NOT NULL` (6 values), `description varchar(300)`, `usage_count int DEFAULT 0`, `archived boolean DEFAULT false`, `updated_at timestamptz`.

---

### Domain L — Platform Administration (Phase 18)

#### L1. `platform_settings`
- **Purpose:** The 11 configuration slices of `AdminSettingsDocument` (general, organization, branding, localization, notifications, security, email, sms, backup, retention, privacy). Recommended physical shape: one keyed JSONB row per slice with schema validation at the API, because slices are read/written whole ("form panels edit a keyed slice of the document").
- **PK:** `key` · **Unique:** `key`

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| key | varchar(30) | no | — | one of the 11 slice keys | `security` | Slice name (`AdminSettingsFormKey`) |
| value | jsonb | no | — | slice-shape validated | `{"twoFactorRequired":true,"passwordExpiryDays":90,"sessionTimeoutMinutes":30,"loginAttemptLimit":5,"singleSessionPerUser":false}` | Slice content |
| updated_by | uuid | yes | — | FK users | — | Attribution (all admin-settings writes audit-logged) |
| updated_at | timestamptz | no | now() | — | — | — |

Slice fields (all confirmed in `admin-settings.types.ts`): **general** platformName, supportEmail, defaultSection, maintenanceMode, maintenanceMessage · **organization** name, legalName, taxId, phone, website, addressLine, city, country · **branding** productName, tagline, loginWelcome, showPoweredBy · **localization** language('en'), timezone, dateFormat(DMY|MDY|ISO), timeFormat(12h|24h), firstDayOfWeek(monday|sunday), currency(USD|EUR|GBP) · **notifications** emailEnabled, smsEnabled, inAppEnabled, dailyDigest, criticalOnly, quietFrom, quietTo · **security** twoFactorRequired, passwordExpiryDays, sessionTimeoutMinutes, loginAttemptLimit, singleSessionPerUser · **email** fromName, fromAddress, replyTo, smtpHost, smtpPort, signature · **sms** enabled, senderId, defaultCountryCode, deliveryReports · **backup** autoBackup, frequency(daily|weekly|monthly), retainCount · **retention** patientRecordYears, auditLogDays, messageDays, autoPurge · **privacy** productAnalytics, errorReporting, cookieBanner, dpaAccepted.

#### L2. `platform_integrations`
- **Purpose:** `IntegrationSetting` — platform-level connected services (email provider, SMS gateway, lab interface, AI service, storage — UX §3.9).
- **PK:** `id` · **Unique:** `name`. Columns: `name varchar(120)`, `description varchar(300)`, `connected boolean DEFAULT false`, `last_sync_at timestamptz NULL`, `config_enc bytea NULL` ("credentials as write-only secrets"), `updated_by`, `updated_at`.

#### L3. `api_keys`
- **Purpose:** `ApiKey` — programmatic access; "the full key is only shown once at creation."
- **PK:** `id` · **Unique:** `prefix`

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| label | varchar(120) | no | — | non-empty | `Reporting ETL` | `label` |
| prefix | varchar(16) | no | — | unique | `mk_live_9f2a` | Displayable prefix |
| key_hash | text | no | — | hashed; never stored plaintext | — | Verification hash |
| created_by | uuid | yes | — | FK users | — | Creator |
| created_at | timestamptz | no | now() | — | — | `createdAt` |
| last_used_at | timestamptz | yes | null | — | — | `lastUsedAt` |
| revoked_at | timestamptz | yes | null | — | — | `revoked` |

#### L4. `backups`
- **Purpose:** `BackupEntry` — backup catalog (automatic/manual).
- **PK:** `id`. Columns: `label varchar(120)`, `created_at timestamptz`, `size_mb numeric(10,1)`, `kind backup_kind` (automatic/manual), `created_by uuid NULL`, `storage_ref text` (location of the artifact).

---

### Domain M — Audit & Compliance

#### M1. `audit_events`
- **Purpose:** The immutable platform audit log. Evidence: `AuditEvent` (administration.types.ts) + the full UX §3.7 spec ("read-only for everyone including admins"; 100k+ rows; ms-precision timestamps; before/after diffs; correlation).
- **PK:** `id` — **INSERT-only; no UPDATE/DELETE grants; partition by month.**

| Column | PG Type | Null | Default | Validation | Example | Description |
|---|---|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | — | — | PK |
| occurred_at | timestamptz(3) | no | now() | ms precision (UX §3.7) | — | Timestamp |
| actor_id | uuid | yes | — | FK users SET NULL | — | Actor (null = system) |
| actor_role | varchar(20) | yes | — | Doctor / Admin / System | `Admin` | Role chip |
| category | audit_category | no | — | authentication / security / user_action / admin_activity / system (§3.7 taxonomy) | `security` | Event class |
| event_type | varchar(60) | no | — | e.g. login_failure, phi_reveal, permission_change, prescription_signed, export | `phi_reveal` | Typed event |
| severity | audit_severity | no | 'info' | info / warning / critical | `warning` | `AuditEvent.severity` |
| summary | varchar(300) | no | — | — | `Revealed patient identity PT-1004` | One-liner |
| target | varchar(120) | yes | — | — | `PT-1004` | `AuditEvent.target` |
| ip_address | inet | yes | — | — | — | Source IP |
| device | varchar(120) | yes | — | — | — | Device |
| session_id | uuid | yes | — | FK sessions SET NULL | — | Correlation ("same session") |
| payload | jsonb | yes | null | structured detail + before/after diff | `{"before":…,"after":…}` | Full payload |
| incident_ref | varchar(40) | yes | null | — | `INC-2026-014` | Bookmark/incident reference |

---

### SPEC entities from the Admin UX blueprint (§3.2–3.6, 2.11) — confirmed scope, not yet coded

#### S1. `doctor_verification_documents` (UX §3.3 Documents tab)
`id uuid PK` · `doctor_id → doctors CASCADE` · `kind varchar(40)` (medical_license / degree_certificate / national_id / other) · `file_id → files` · `uploaded_at` · `expires_on date NULL` (expiring docs flagged) · `check_authentic boolean` · `check_current boolean` · `check_identity_match boolean` · `decision varchar(20)` (pending/approved/rejected) · `decided_by uuid` · `decided_at` · `reject_reason varchar(300) NULL`. Overall verification completes only when all required docs approved.

#### S2. `doctor_availability` (UX 2.11 Availability + 2.4 grids)
`id uuid PK` · `doctor_id → doctors CASCADE` · `weekday weekday NOT NULL` · `start_time time` · `end_time time` · `is_break boolean DEFAULT false` · unique (`doctor_id`,`weekday`,`start_time`). Plus `doctor_time_off`: `id`, `doctor_id`, `starts_at`, `ends_at`, `kind` (vacation/emergency-block), `auto_behavior varchar(30)` (block-new/reschedule-existing), `created_at` — drives the Emergency unavailability flow. Doctor defaults: `default_duration_min smallint` (15/20/30/45/60), `buffer_min smallint` on `doctors`.

#### S3. `appointment_reschedule_proposals` (UX 2.4 "Propose another time" — up to 3 slots, status "Awaiting patient")
`id uuid PK` · `appointment_id → appointments CASCADE` · `proposed_by uuid` · `slot_1 timestamptz NOT NULL` · `slot_2 timestamptz NULL` · `slot_3 timestamptz NULL` · `status varchar(20)` (pending/accepted/declined/expired) · `chosen_slot smallint NULL` · `created_at`.

#### S4. `communication_access_requests` (UX §3.6 content-access gate)
`id uuid PK` · `conversation_id → conversations` · `requested_by uuid → users` · `justification_category varchar(40)` (patient_complaint / safety_flag / legal_request / quality_audit) · `reason text NOT NULL` · `status varchar(20)` (pending/approved/denied/expired/terminated) · `approved_by uuid NULL` (second-admin approval mode) · `granted_at` · `expires_at` · `access_ref varchar(40) UNIQUE` (the "ref #" in the watermark banner). Every grant/view lands in `audit_events`.

#### S5. `message_flags` (UX §3.6 Safety flags)
`id uuid PK` · `message_id → messages` · `category varchar(40)` (emergency_language / harassment_abuse / phi_wrong_channel / prescription_solicitation) · `source varchar(10)` (auto/user) · `flagged_by uuid NULL` · `excerpt varchar(300)` (minimum-necessary context) · `status varchar(20)` (open / under_review / resolved) · `resolution varchar(30) NULL` (dismissed / warned / escalated) · `resolution_note text` · `resolved_by` · `resolved_at`.

#### S6. `record_issue_reports` (UX 2.3 "Report an issue with this record" → admin queue 3.1)
`id uuid PK` · `record_id → medical_records` · `reported_by uuid` · `description text` · `status varchar(20)` (open/investigating/resolved) · `resolved_by` · `resolved_at` · `created_at`.

#### S7. `satisfaction_surveys` (UX 2.1 Satisfaction widget "sourced from post-visit surveys"; dashboard `SatisfactionWidget`)
`id uuid PK` · `appointment_id → appointments UNIQUE` · `patient_id → patients` · `doctor_id → doctors` · `rating smallint CHECK (1–5)` · `comment text NULL` · `submitted_at timestamptz`.

---
## 3. Relationships

### One-to-One
| Relationship | Explanation |
|---|---|
| `users` ↔ `user_credentials` | Secrets isolated from the readable account row |
| `users` ↔ `doctors` | Professional profile extension for doctor-role accounts |
| `users` ↔ `admin_profiles` | Admin profile extension |
| `users` ↔ `user_settings` / `user_interface_preferences` / `notification_preferences` / `ai_user_settings` | One settings document each per user (mock: one localStorage doc per user) |
| `lab_orders` ↔ `lab_specimens` | One specimen document per order (`specimen: LabSpecimen \| null`) |
| `appointments` ↔ `satisfaction_surveys` | One post-visit survey per appointment |
| `medical_records` ↔ `record_vital_signs` | One vitals block per record (`vitals: RecordVitalSigns`) |

### One-to-Many
| Parent | Children | Explanation |
|---|---|---|
| `users` | sessions, trusted_devices, login_events, verification_tokens, otp_codes, user_activity_log, user_integrations, saved_reports, scheduled_reports, ai_conversations, notifications | Account-scoped collections |
| `roles` | users | Coarse role assignment |
| `doctors` | appointments, medical_records, lab_orders (ordered_by), prescriptions, doctor_availability, doctor_time_off, doctor_verification_documents | The doctor's clinical output |
| `patients` | patient_allergies, patient_chronic_conditions, emergency_contacts, insurance, documents, notes, medical_history, vital_signs, clinical_alerts, medications, studies, appointments, medical_records, lab_orders, prescriptions, ai_conversations (bound context) | The clinical universe of one patient |
| `appointments` | appointment_events, reschedule_proposals | Transition history |
| `medical_records` | record_diagnoses, treatment_plan_items, record_medications, record_allergies, record_notes, record_attachments, record_timeline_events, record_issue_reports | Encounter sub-documents |
| `lab_test_catalogue` | lab_analyte_specs, lab_orders | Catalogue → instances |
| `lab_orders` | lab_results, lab_attachments, lab_timeline_events | Order sub-documents |
| `medications` | medication_strengths, prescriptions | Formulary → instances |
| `prescriptions` | safety_warnings, notes, history_entries, timeline_events, patient_medications (materialized) | Rx sub-documents |
| `conversations` | messages, shared_links, communication_access_requests | Thread content |
| `messages` | message_attachments, message_flags | Message satellites |
| `ai_conversations` | ai_messages | Chat history |
| `scheduled_reports` | scheduled_report_runs | Run history |
| `departments` | staff_members, rooms, appointments, medical_records, lab_orders, prescriptions | Organizational axis |
| `staff_members` | staff_shift_assignments | Rostering |
| `sessions` | audit_events (correlation) | Investigation pivot |

### Many-to-Many
| Relationship | Join table | Explanation |
|---|---|---|
| roles ↔ permissions | `role_permissions` | Permission matrix (UX §3.9 switch grid) |
| users ↔ permissions | `user_permissions` | Per-user overrides (mock users carry explicit arrays) |
| patients ↔ chronic_conditions | `patient_chronic_conditions` | Condition tags from the canonical vocabulary |
| users ↔ conversations | `conversation_participants` | Thread membership + per-viewer state |
| patients ↔ doctors | `appointments` / (inferred `patient_doctor_assignments`, §13) | Care relationships; today only `patients.assigned_doctor` (1:N) is coded, UX 3.4 shows "assigned doctors count" ⇒ M:N is the production shape |
| ai_prompt_templates ↔ users | `ai_user_settings.favorite_prompt_ids[]` | Favorite prompts (array today; join table acceptable) |

---

## 4. Business Rules (extracted, with sources)

### 4.1 Appointment lifecycle (`availableActions()`, UX §2.4)
- Statuses: `scheduled, confirmed, pending, completed, cancelled, rescheduled, no-show`.
- **Transitions:** `pending → approve → confirmed` | `pending → reject → cancelled(reason)` ; `scheduled/confirmed/rescheduled → reschedule → rescheduled` or `→ cancel → cancelled(reason)`; **only when slot date ≤ today**: `→ complete → completed` or `→ no-show → no-show`. `completed / cancelled / no-show` are terminal — no actions render.
- Reject/cancel/no-show are destructive ⇒ P4 confirm-with-reason modal; reason is stored and audit-logged; patient is notified.
- "Propose another time": up to 3 alternative slots → status *Awaiting patient* (UX; not yet in the coded enum — see §16).
- Reschedule of a confirmed appointment requires reason; patient must re-confirm unless within the doctor's auto-accept window.
- Emergency time-off: system lists all impacted appointments; per-appointment or bulk choice (reschedule proposal / colleague handover if enabled / cancel with apology); a blast-radius summary must be confirmed before any notification fires.
- Admin powers: nudge (templated, logged), reassign to same-specialty doctor with live availability (both parties notified, P4 reason), administrative cancel (reason category "administrative"); destructive bulk actions deliberately unsupported.
- Failed transitions must roll back optimistically-updated UI; notifications fire only on confirmed server success.

### 4.2 Medical records
- Statuses `draft → active → completed → archived`; open = draft+active. Priority low/normal/high/critical.
- Records are **never hard-deleted** (UX 1.5.3): soft delete + versioning mandatory.
- Exactly one primary diagnosis per record (`isPrimary`; fallback = first). Diagnoses are ICD-10 coded.
- Notes must be signed; unsigned notes surface in the Overview action queue. AI-drafted notes arrive as labeled drafts requiring review + signature; saved artifacts keep permanent AI-assisted provenance.
- Every mutation is attributed and timestamped (`record_timeline_events` kinds).

### 4.3 Prescription lifecycle & safety (`Prescription`, UX §2.7)
- Statuses: `pending-approval, active, completed, discontinued, expired`. Refill state: `none, available, due, pending`; `0 ≤ refills_remaining ≤ refills_allowed`.
- The safety screen is **fail-closed**: allergy conflict = blocking (no override in v1); severe drug–drug interaction requires explicit acknowledgment checkbox + reason (audit-logged); duplicate-therapy notice; if the interaction service is down the prescription can only be saved as draft, never sent.
- A prescription must be signed ("Sign & send") before leaving draft; renew pre-fills a new Rx from a previous one; cancel/discontinue requires a reason.
- Controlled (`is_controlled`) and high-risk (`is_high_risk`) medications drive extra warnings/filters.
- Timeline events: prescribed, dispensed, refill-requested, refill-approved, renewed, note-added, discontinued, expired.

### 4.4 Laboratory workflow (`LabTestStatus`, timeline kinds, UX §2.6)
- Order pipeline: `ordered → collected → processing → completed` (+ `cancelled` anywhere before completion). Timeline adds `received`, `resulted`, `verified` between processing and completion.
- Pending = ordered+collected; In-progress = processing (summary cards).
- Result flags: normal, low, high, critical-low, critical-high, abnormal; `has_critical_result` = any critical flag; critical rows pin to top and tint error.
- **Critical results must be individually marked reviewed** — bulk review allowed only for Normal; a failed review write must roll back visibly (never *appear* reviewed).
- Specimen conditions (Hemolyzed, Clotted, Insufficient volume) gate processing; reference ranges snapshot onto results at result time.
- Priorities: routine / urgent / STAT.

### 4.5 Patients
- Statuses: active, under-treatment, critical, follow-up, discharged; risk: low/medium/high/critical.
- Severe allergy ⇒ fixed non-dismissible allergy strip on the patient header and inside the prescription flow (UX 1.5.4).
- Doctors see only patients under their care (`patients.view` scope); admins see demographics/operational metadata only, with masked identifiers; reveal is per-row and audit-logged (`patients.revealIdentity`, UX 1.5.6).

### 4.6 Authentication & session
- Password policy: ≥8 chars with lower + upper + digit + symbol; strength score 0–4; new password must differ from current; change requires current password.
- Login: unknown email/wrong password → `invalid_credentials`; unverified email → blocked (`email_unverified`) with resend; 2FA-enabled → OTP step (`otp_required`), 6-digit numeric, resend with countdown, `rate_limited` on abuse.
- Forgot password never reveals whether an account exists (anti-enumeration). Reset/verification tokens expire (`token_invalid`) and are single-use.
- Session: remember-me = 30 days, otherwise 12 h; silent refresh slides expiry; login clears any stale session in the other storage medium. Idle lock after 10 min (60 s warning) — admin-configurable (`sessionTimeoutMinutes`); locked state requires re-auth, unsaved work preserved.
- Platform policies (Phase 18 security slice): optional org-wide 2FA requirement, password expiry days, login attempt limit, single-session-per-user.
- Signup requires acceptance of Terms & Privacy; role ∈ {doctor, admin}; optional license number (doctors).

### 4.7 Permissions (UX §3.9 + `Permission` union)
- Declarative capabilities; UI hides what the role cannot do, server enforces regardless. 22 coded capabilities across Clinical data / Scheduling / Communication / Administration / Audit / AI.
- Doctor bundle: patients.view, patients.revealIdentity, records.view/edit, prescriptions.create, labs.review, appointments.manageOwn, messages.send, communications.viewMetadata, ai.use.
- Admin bundle: patients.view/manageAccounts, appointments.reassign/cancelAdministratively, messages.send, communications.viewMetadata/viewContent/resolveFlags, doctors.manage/verify, roles.manage, settings.manageSystem, integrations.manage, logs.view/export.
- AI entry point exists **only** in the Doctor shell; admin has no AI assistant.
- Role-matrix changes preview affected-user count and require confirmation; concurrent edits trigger a merge dialog.

### 4.8 Communication rules (UX §2.8/§3.6)
- Patient threads: permanent "not for emergencies" banner; messages cannot be deleted; edit window 5 minutes with visible "edited" mark; full history retained for audit.
- Attachments scanned before download links activate.
- Admin content access is gated: justification category + reason → optional second-admin approval → read-only watermarked view with logged access ref; every access audit-logged; errors mid-view terminate and log as incomplete.
- Safety flags workflow: Open → Under review → Resolved (dismiss with note / warn user / escalate to suspension), each with P4 reason.
- Announcement/system channels are read-only for doctors.

### 4.9 Notifications
- Channels: email, sms, push, desktop, in-app; per-category opt-in; **security category cannot be disabled**; quiet hours with critical-lab-alert exemption; SMS = critical alerts only.
- Critical notifications pin until acted on and never appear only as toasts.
- Badge counts (messages, notifications) cap display at "99+".

### 4.10 Clinic operations (Phase 17)
- Presence: on-duty / on-break / off-duty / on-leave; shifts: morning / evening / on-call / vacation / leave as 7-day masks.
- Rooms: available / occupied / cleaning / maintenance; queue priorities routine/priority/urgent with delay flags; waiting-room states waiting → called → in-room.
- Resources reorder when `quantity ≤ reorder_level` (status low/out).
- Working days per weekday with open flag and optional break; holidays public/clinic, optionally recurring.

### 4.11 Platform administration (Phase 18)
- Maintenance mode with message; API keys shown once, revocable; backups automatic (daily/weekly/monthly, retain N) or manual.
- Data retention: patient records in **years**, audit logs in **days**, messages in **days**, optional auto-purge — retention policy must be displayed on the logs page.
- Audit log read-only for everyone including admins; log exports are themselves logged.

### 4.12 Payments / billing
- Billing is **feature-flagged off** (`featureFlags.billing = false`); revenue KPIs/charts exist in Reports and PlatformStatus (`revenueMonth`, `Revenue (k)` trend) and render only "when the clinic enables per-doctor billing". No invoice/payment entity exists anywhere in code ⇒ billing tables are Inferred Recommendations (§13).

### 4.13 Emergency rules
- Emergency department exists in lab vocabularies; visit type "Emergency" in records; AI assistant declines emergency-triage questions; messaging banner directs emergencies away; emergency unavailability flow per 4.1.

---

## 5. Lookup Tables

| Lookup | Seed values (confirmed) | Source |
|---|---|---|
| `roles` | admin, doctor, reception, laboratory, pharmacy (+ nurse, receptionist, patient from staff/contact unions; Receptionist*/Patient* starred in UX §3.9) | auth/admin types |
| `permissions` | 22 codes | `types/auth` |
| `departments` | General Medicine, Cardiology, Endocrinology, Pulmonology, Orthopedics, Nephrology, Oncology, Emergency, Psychiatry (union of module lists) | appointments/labs/pharmacy vocab + admin Department |
| `visit_types` | Consultation, Follow-up, Annual check-up, Lab review, Medication review, Procedure, Emergency, Telemedicine | `VISIT_TYPES` ∪ `RECORD_VISIT_TYPES` |
| `chronic_conditions` | 10 canonical conditions (Type 2 diabetes … Osteoarthritis) | `CHRONIC_CONDITIONS` |
| `icd_codes` | 14 seed ICD-10 concepts (E11.9, I10, J45.909, N18.3, I25.10, E03.9, J44.9, I48.91, K21.9, M54.5, J06.9, D64.9, R51.9, M17.9) — full ICD-10 import recommended | `DIAGNOSES` |
| `lab_test_catalogue` | CBC 58410-2, HbA1c 4548-4, BMP 51990-0, Lipid 57698-3, Thyroid 55204-3 (5 seed tests, LOINC) | labs catalogue |
| `medications` | Amoxil/Amoxicillin, Glucophage/Metformin, Lipitor/Atorvastatin, Coumadin/Warfarin, Eltroxin/Levothyroxine (5 seed) | pharmacy catalogue |
| `insurance_providers` | none seeded (free-text `insurance` today) — table required | Patient.insurance, InsuranceInfo.provider |
| `blood_groups` | 8 values (enum, no table needed) | `BLOOD_TYPES` |
| `genders` | female, male (enum) | `Gender` |
| `languages` | English, Mandarin seeded in profile; UI locales en/ar | DoctorProfile, AiLanguage, LanguageSelector |
| `countries` / `cities` | Organization slice has country/city fields; no seed list — table recommended (see §13) | admin-settings |
| `notification_categories` | 8 (enum) | notifications |
| `document_template_kinds` | 6 incl. radiology-request (enum) | administration |
| `specialties` | Internal Medicine seeded; "taxonomy select" required by UX 2.11 — table required | DoctorProfile / UX |
| `holidays` | domain table (K7) | administration |
| `ai_prompt_templates` | summarize-patient, drug-interactions, … | ai/model/prompts |

## 6. Reference Data — complete enum inventory

Format: `enum_name` — values *(source)*.

**Identity/auth:** `role_code` — admin, doctor, reception, laboratory, pharmacy *(PlatformRole)* · `user_status` — active, inactive, locked, suspended *(UX 3.2/3.4)* · `login_result` — success, failed · `token_kind` — email_verification, password_reset · `activity_kind` — profile, password, login, settings, security, integration, privacy · `device_platform` — windows, mac, ios, android, desktop, mobile, tablet · auth error codes (API, not DB): invalid_credentials, email_unverified, otp_required, otp_invalid, email_taken, token_invalid, weak_password, rate_limited · `AuthStatus` (client state): booting, authenticated, unauthenticated, locked.

**Patient:** `gender` — female, male · `blood_type` — A+, A-, B+, B-, AB+, AB-, O+, O- · `patient_status` — active, under-treatment, critical, follow-up, discharged · `risk_level` — low, medium, high, critical · `allergy_severity` — mild, moderate, severe · `medication_status` — active, completed, discontinued · `history_event_kind` — diagnosis, surgery, procedure, hospitalization, vaccination · `study_status` — completed, pending, critical · `study_modality` — lab, imaging · `document_category` — referral, consent, external-record, insurance, report · `alert_severity` — critical, warning.

**Appointments:** `appointment_status` — scheduled, confirmed, pending, completed, cancelled, rescheduled, no-show · `appointment_priority` — low, normal, high, urgent · `appointment_action` — approve, reject, cancel, reschedule, complete, no-show.

**Records:** `record_status` — draft, active, completed, archived · `record_priority` — low, normal, high, critical · `record_attachment_kind` — lab-result, imaging, referral, consent, external-report · `record_timeline_kind` — created, vitals-recorded, diagnosis-added, medication-prescribed, note-added, attachment-added, status-changed.

**Laboratory:** `lab_status` — ordered, collected, processing, completed, cancelled · `lab_priority` — routine, urgent, stat · `lab_test_category` — Hematology, Chemistry, Microbiology, Immunology, Pathology, Urinalysis, Hormones, Blood Bank · `lab_result_flag` — normal, low, high, critical-low, critical-high, abnormal · `lab_specimen_type` — Serum, Plasma, Whole blood, Urine, Swab, Tissue biopsy, Stool, Sputum, CSF · `lab_specimen_condition` — Acceptable, Hemolyzed, Clotted, Insufficient volume · `lab_attachment_kind` — report, addendum, external, raw-data · `lab_timeline_kind` — ordered, collected, received, processing, resulted, verified, cancelled.

**Pharmacy:** `prescription_status` — active, completed, discontinued, pending-approval, expired · `refill_status` — none, available, due, pending · `medication_category` — Antibiotics, Analgesics, Antihypertensives, Antidiabetics, Lipid-lowering, Anticoagulants, Corticosteroids, Bronchodilators, Psychiatric, Gastrointestinal, Opioids, Thyroid · `medication_form` — Tablet, Capsule, Syrup, Injection, Inhaler, Cream, Drops, Patch · `medication_route` — Oral, Intravenous, Intramuscular, Subcutaneous, Topical, Inhalation, Ophthalmic, Transdermal · `safety_warning_kind` — interaction, allergy, duplicate, dosage · `safety_warning_severity` — info, warning, critical · `prescription_timeline_kind` — prescribed, dispensed, refill-requested, refill-approved, renewed, note-added, discontinued, expired.

**Communication:** `contact_role` — doctor, nurse, pharmacist, patient · `presence` — online, away, offline · `attachment_kind` — file, image · `message_status` — sending, sent, delivered, read, failed · `message_kind` — text, system · `messaging_folder` (view, not column) — inbox, unread, starred, sent, drafts, archived · `conversation_kind` — direct, group, announcement, system · `notification_category` — appointments, medical-records, laboratory, pharmacy, patients, ai, system, security · `notification_priority` — normal, important, critical · `notification_kind` — alert, reminder, update · `notification_channel` — email, sms, push, desktop, inApp.

**AI:** `ai_context_mode` — general, patient, record, labs, pharmacy · `ai_chat_role` — user, assistant · `ai_message_status` — complete, stopped, error · `ai_response_length` — concise, balanced, detailed · `ai_language` — en, ar.

**Reports:** `report_category` — overview, revenue, patients, appointments, laboratory, records, pharmacy, messages, ai · `date_range_key` — today, week, month, quarter, year, custom · `age_band` — 0-17, 18-39, 40-64, 65+ · `schedule_frequency` — daily, weekly, monthly · `schedule_status` — active, paused · `export_format` — csv, excel, pdf, print · `run_status` — sent, failed · `insight_kind` — workload, busiest, critical, pharmacy, lab, revenue, ai.

**Settings:** `landing_page` — overview, patients, appointments, labs, messages · `patient_tab` — summary, records, labs, prescriptions · `records_tab` — all, recent, critical · date/time formats · `integration_id` — google-calendar, outlook, zoom, teams · theme — light, dark, system · density — comfortable, compact · focus_rings — default, high · settings sections (11) and admin panels (16) — navigation vocabularies, not DB columns.

**Administration:** `staff_role` — doctor, nurse, receptionist, laboratory, pharmacy · `presence_status` — on-duty, on-break, off-duty, on-leave · `room_kind` — consultation, lab, procedure, pharmacy, waiting · `room_status` — available, occupied, cleaning, maintenance · `active_status` — active, inactive · `shift_kind` — morning, evening, on-call, vacation, leave · `queue_priority` — routine, priority, urgent · `waiting_status` — waiting, called, in-room · `announcement_priority` — low, normal, high · `template_kind` — prescription, certificate, referral, lab-request, radiology-request, discharge · `holiday_kind` — public, clinic · `resource_status` — in-stock, low, out · `weekday` — Mon…Sun · `doctor_verification_status` — pending, verified, rejected, docs_requested · `doctor_practice_status` — active, suspended, vacation.

**Platform:** `backup_kind` — automatic, manual · backup frequency — daily, weekly, monthly · localization dateFormat — DMY, MDY, ISO · firstDayOfWeek — monday, sunday · currency — USD, EUR, GBP · `audit_category` — authentication, security, user_action, admin_activity, system · `audit_severity` — info, warning, critical · system health status — operational, degraded, down (runtime, not stored).

---

## 7. Audit Requirements

| Table group | created_at | updated_at | created_by | updated_by | Soft delete (deleted_at/by) | Versioning/History |
|---|---|---|---|---|---|---|
| patients + all patient_* satellites | ✔ | ✔ | ✔ | ✔ | ✔ (PHI never hard-deleted) | history via audit_events |
| medical_records + record_* | ✔ | ✔ | ✔ | ✔ | ✔ **mandatory** (UX 1.5.3) | ✔ **row versioning + before/after diffs** |
| appointments | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ full transition history (`appointment_events`) |
| lab_orders + children | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (`lab_timeline_events`) |
| prescriptions + children | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (`prescription_timeline_events`) |
| conversations/messages | ✔ | ✔ (edited_at) | ✔ (author) | — | ✖ delete forbidden in patient threads; archive only | edit history retained |
| notifications | ✔ | — | — | — | archive flag | — |
| users/doctors/admin_profiles | ✔ | ✔ | ✔ | ✔ | ✔ (deactivate, not delete) | license edits → re-verification trail |
| roles/permissions/role_permissions | ✔ | ✔ | ✔ | ✔ | ✖ (system rows) | every change audit-logged |
| platform_settings / integrations / api_keys / backups | ✔ | ✔ | ✔ | ✔ | revoked_at pattern | audit-logged |
| clinic admin tables (staff, rooms, …) | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| audit_events | ✔ | ✖ | — | — | ✖ **immutable, INSERT-only** | retention per `auditLogDays` |
| saved/scheduled reports, ai_*, settings | ✔ | ✔ | owner | owner | hard delete allowed (user-owned, no PHI except AI content — AI convs soft-delete) | — |

## 8. Indexes

**Primary:** every table PK (uuid). **Unique:** users.email, users.username, users.public_id; patients.mrn, patients.public_id; appointments/medical_records/lab_orders/prescriptions public_id; doctors.user_id, doctors.license_number; lab_test_catalogue.code; api_keys.prefix; sessions.refresh_token_hash; verification_tokens.token_hash; (role_id,permission_id); (conversation_id,user_id); (record_id,icd_code_id); (lab_order_id,analyte); partial unique: one primary diagnosis per record `WHERE is_primary`, one primary emergency contact `WHERE is_primary`, one current insurance `WHERE is_active`.

**Composite / search (hot paths from list pages & filters):**
- `appointments (doctor_id, starts_at)`, `(patient_id, starts_at DESC)`, `(status, starts_at)` — list/calendar/status tabs; partial `WHERE status='pending'` for the action queue.
- `medical_records (patient_id, visit_date DESC)`, `(doctor_id, status)`, `(status, priority)`.
- `lab_orders (patient_id, requested_at DESC)`, `(status, priority)`, partial `WHERE has_critical_result AND reviewed_at IS NULL` — "Critical unreviewed: N" chip.
- `lab_results (lab_order_id)`, `(analyte, resulted_at)` — trend charts per analyte/patient (join through orders).
- `prescriptions (patient_id, status)`, `(prescribing_doctor_id, created_at DESC)`, `(status, end_date)` — expiry sweeps.
- `messages (conversation_id, sent_at DESC)`; `conversation_participants (user_id, archived, last_activity)`; `notifications (recipient_id, created_at DESC)` + partial `WHERE read_at IS NULL AND NOT archived` — badge counts.
- `audit_events (occurred_at DESC)`, `(actor_id, occurred_at)`, `(category, severity, occurred_at)`, `(ip_address)`, `(session_id)`; monthly partitions; BRIN on occurred_at.
- `login_events (user_id, occurred_at DESC)`, `(result, occurred_at)` — failed-login bursts.
- Full-text/trigram: GIN `pg_trgm` on patients.full_name, mrn, phone (identifier auto-detect search); doctors.full_name; messages.body (own-thread full-text); audit_events.summary; medications name/generic_name (typeahead); lab_test_catalogue.name.
- `sessions (user_id) WHERE revoked_at IS NULL`; `otp_codes (user_id, expires_at)`.

## 9. Constraints

**CHECK:** password/OTP handled at API; DB enforces: `appointments.duration_min > 0` · `refills_remaining BETWEEN 0 AND refills_allowed` · `end_date >= start_date` (prescriptions) · vitals ranges (B11) · `text_scale BETWEEN 90 AND 130` · `ai temperature BETWEEN 0 AND 1` · `rating BETWEEN 1 AND 5` · `quantity > 0` · `capacity > 0` · `notification_preferences.cat_security = true` · `ai_conversations`: `context_mode='general' OR patient_id IS NOT NULL` · lab specs: `critical_low < ref_low`, `critical_high > ref_high` (where non-null) · working days `end_time > start_time` · status-transition enforcement via trigger implementing §4.1 legal-transition matrix (illegal transition ⇒ exception).

**Foreign keys / cascade policy:**
- CASCADE: user-owned satellites (sessions, tokens, prefs, settings, AI, reports); document children (record_*, lab_*, prescription_* sub-tables, message attachments); membership rows.
- RESTRICT: clinical anchors — `patient_id`/`doctor_id` on appointments, records, lab_orders, prescriptions; lookup FKs (icd_codes, visit_types, catalogue, medications, insurance_providers, departments on staff). Patients/doctors with clinical data are deactivated (soft), never deleted.
- SET NULL: optional links (department on clinical rows, related ids on notifications, actor on audit/history rows, uploaded_by) — history must survive account removal.
- Records/messages/audit: deletion is forbidden at the privilege level (no DELETE grant to app role on medical_records, messages in patient threads, audit_events).

## 10. Security Classification

| Class | Fields / tables | Handling |
|---|---|---|
| **Credentials/secrets** | user_credentials.password_hash, totp_secret_enc, recovery_codes_enc; sessions.refresh_token_hash; verification_tokens.token_hash; otp_codes.code_hash; api_keys.key_hash; user_integrations.oauth_tokens_enc; platform_integrations.config_enc; SMTP/SMS config | Hash (Argon2id) or app-layer envelope encryption; never in API responses; write-only in UI |
| **PII** | patients: full_name, dob, phone, email, address, mrn, photo; emergency contacts; insurance policy numbers; users/doctors names, emails, phones; login/audit IPs | Encrypt at rest (TDE/pgcrypto columns for policy numbers), masked display for admins (name masking + MRN last-4), reveal audit-logged |
| **PHI (HIPAA-sensitive)** | patient_allergies, chronic conditions, medical_history, vital_signs, clinical_alerts, medications; medical_records + all children (chief complaint, HPI, exam, diagnoses, notes); lab_orders/results/interpretation; prescriptions + warnings/notes; patient_documents & record/lab attachments; messages in patient threads; ai_conversations/ai_messages bound to patients; notification bodies referencing patients | Least-privilege row-level access (doctor sees own patients — RLS on care relationship); admin access requires grant + justification + audit; retention `patientRecordYears`; soft delete only |
| **Audit-sensitive** | audit_events, login_events, communication_access_requests, message_flags | Immutable, read-only, export logged, retention `auditLogDays` |
| **Session** | sessions table; idle-lock state | httpOnly cookie/refresh rotation (code comment in session-store: "a real API swaps this for httpOnly-cookie / silent-refresh semantics") |

## 11. Files & Attachments

Central **`files`** table (required by B8, D8, E6, G4, S1; "Null until the files service exists" comments):

| Column | PG Type | Null | Default | Description |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| storage_key | text | no | — | Object-store key (S3-style), never a public URL |
| original_name | varchar(255) | no | — | Upload filename |
| mime_type | varchar(120) | no | — | Content type |
| size_bytes | bigint | no | — | Size |
| checksum_sha256 | char(64) | no | — | Integrity |
| kind | varchar(30) | no | — | profile_photo / patient_document / record_attachment / lab_attachment / message_attachment / verification_document / branding_asset / backup_artifact |
| uploaded_by | uuid | yes | — | FK users SET NULL |
| scanned_at / scan_result | timestamptz / varchar(20) | yes | — | Malware scan gate (UX 2.8) |
| created_at | timestamptz | no | now() | — |
| deleted_at | timestamptz | yes | — | Soft delete |

File-consuming entities: profile photos (users/doctors/admin, patients), patient documents (5 categories), record attachments (5 kinds incl. imaging), lab report attachments (4 kinds), message attachments (file/image), doctor verification documents, branding assets, report export artifacts, backup artifacts. Radiology images: only `patient_studies` + record `imaging` attachments exist today — full DICOM/radiology entities are §13 recommendations.

---

## 12. (Consolidated above — §2 is the full data dictionary.)

## 13. Missing Tables — **Inferred Recommendation** (never mix with confirmed)

Standard enterprise-healthcare entities with no direct code evidence; each is justified by a gap the UX/product docs imply:

1. **`patient_doctor_assignments`** — M:N care team ("assigned doctors count" UX 3.4; today a single free-text `assignedDoctor`). Columns: patient_id, doctor_id, role (primary/consulting), assigned_at, revoked_at, granted_by. This is also the natural RLS anchor for `patients.view`.
2. **`patient_access_grants`** — UX 3.4 Permissions tab shows a grid of grants/revocations; recommend an explicit table (patient_id, grantee_role/doctor, scope, granted_by, revoked_by, timestamps).
3. **`countries`** / **`cities`** — organization address + patient addresses currently free text.
4. **`specialties`** (+ `doctor_specialties` M:N with primary flag) — UX 2.11 demands a taxonomy select with subspecialties.
5. **`insurance_providers`** — referenced by B7; no provider master exists.
6. **`invoices`, `invoice_lines`, `payments`** — billing is flagged off but revenue KPIs/currency settings exist; required the day `billing=true`.
7. **`notification_deliveries`** — per-channel delivery attempts/status (UX 3.5 drawer shows "notification delivery status per party"; scheduled-report runs already model this pattern).
8. **`drug_interactions`** — pair-wise interaction reference powering the safety screen (today one canned `interaction_note` string per drug — insufficient for the specified severity-graded screen).
9. **`medication_monographs`** — UX 2.7 database tab: indications, contraindications, standard dosing, pregnancy category.
10. **`radiology_orders` / `radiology_reports` / `dicom_studies`** — imaging tab and radiology-request template exist without a backing module.
11. **`immunizations`** — UX 2.3 History lists immunizations distinct from history events.
12. **`consents`** — consent documents exist as files; a structured consent register (type, granted_at, revoked_at, document FK) is standard.
13. **`saved_views`** — P7 saved table views per user (name, page, filter/sort/column state JSONB).
14. **`incident_bookmarks`** — UX 3.7 "named saved selection of events for a case" (name, creator, event id list).
15. **`report_exports`** — generated export artifacts (format, file_id, requested_by, watermark ref for content exports).
16. **`clinics` / `facilities`** — multi-clinic hints ("geographic distribution (if multi-clinic)", clinic assignment on doctor profile) — single-clinic today; add when multi-tenancy lands.
17. **`message_templates` / `snippets`** — composer "template snippets" (UX 2.8) and admin notification templates (UX 3.9).

## 14. Final Outputs

### 14.1 ERD description (textual)
Core spine: **users** —1:1→ doctors/admin_profiles; **patients** at the center of a star of 11 satellites; four clinical fact families (**appointments**, **medical_records**, **lab_orders**, **prescriptions**) each referencing patients (N:1), doctors (N:1), departments (N:1) and carrying their own child constellations (events/results/notes/attachments/timelines). **Catalogues** (icd_codes, lab_test_catalogue+analytes, medications+strengths, visit_types, chronic_conditions, insurance_providers) feed the fact families. **Communication** is users↔conversations (M:N via participants) with messages→attachments/flags; **notifications** fan out per recipient with optional FKs into all four fact families. **AI** threads belong to a doctor and optionally bind one patient. **Clinic admin** hangs off departments/staff/rooms. **Platform admin** is configuration keyed by slice. **audit_events** references users/sessions and is the append-only ledger everything writes to.

### 14.2 Dependency order (creation order — 12 phases)
1. Extensions (`pgcrypto`, `citext`, `pg_trgm`) + all ENUM types (§6)
2. Lookups: roles, permissions, role_permissions, departments*, visit_types, chronic_conditions, icd_codes, insurance_providers, specialties†, countries/cities†
3. files
4. users, user_credentials, user_permissions, sessions, trusted_devices, login_events, verification_tokens, otp_codes, user_activity_log
5. doctors, admin_profiles, staff_members (+ resolve departments.head_staff_id FK via ALTER), staff_shift_assignments, rooms, resources, clinic_working_days, holidays
6. patients + 11 patient satellites; doctor_availability, doctor_time_off, doctor_verification_documents
7. lab_test_catalogue, lab_analyte_specs, medications, medication_strengths, ai_prompt_templates
8. appointments, appointment_events, appointment_reschedule_proposals, satisfaction_surveys; queue_entries, waiting_room_entries
9. medical_records + 7 children, record_issue_reports (then ALTER patient_vital_signs/patient_medications to add record/prescription FKs)
10. lab_orders, lab_specimens, lab_results, lab_attachments, lab_timeline_events; prescriptions + 4 children (+ cross-FKs)
11. conversations, conversation_participants, messages, message_attachments, conversation_shared_links, message_flags, communication_access_requests; notifications, notification_preferences; ai_conversations, ai_messages, ai_user_settings; saved_reports, scheduled_reports, scheduled_report_runs; user_settings, user_interface_preferences, user_integrations; announcements, policies, document_templates
12. platform_settings, platform_integrations, api_keys, backups; audit_events (partitioned) + triggers (updated_at, status machines, has_critical_result, audit hooks) + RLS policies
(† = inferred recommendation; * departments created before staff with deferred head FK)

### 14.3 Suggested PostgreSQL type palette
`uuid` PKs (gen_random_uuid) · `citext` emails · `timestamptz` (ms precision for audit) · `date` for civil dates · `time` for clinic hours · `numeric` for vitals/lab values/money (`numeric(12,2)` if billing lands) · `text[]` for bounded string lists (languages, education) · `jsonb` for filter snapshots, audit payloads, settings slices · native `ENUM` types for closed vocabularies · `inet` for IPs · `bytea` for encrypted blobs · `boolean[7]` for shift masks · BRIN + monthly partitions on audit_events.

### 14.4 Estimated table count
- Confirmed + spec\'d physical tables: **~88** (93 logical entities; D3/G8 share physical tables, platform_settings collapses 11 slices into 1)
- Inferred recommendations: **~22** physical (17 groups)
- **Production estimate: ~105–110 tables.**

### 14.5 Inconsistencies found in the current project
1. **Two appointment-status vocabularies:** module enum (7 values) vs patient-profile `ProfileAppointmentStatus` (5 values, missing scheduled/rescheduled) vs UX §2.4 which additionally specifies *Awaiting patient* and §7 note `requested → pending → …`. Unify before schema freeze; recommend adding `awaiting-patient`.
2. **Prescription status mismatch:** UX §2.7 badges (Draft, Sent, Dispensed, Expired, Cancelled) vs coded enum (active, completed, discontinued, pending-approval, expired). The coded enum has no *draft* or *dispensed* even though "Save as draft" and dispensed timeline events exist.
3. **Doctor references are free-text names** (`assignedDoctor`, `doctor`, `orderedBy`, `prescribingDoctor`, `collectedBy`, timeline `actor`) — must become FKs; mock names ("Dr. Amelia Chen") double as the auth user display name.
4. **Departments are three diverging string lists** (appointments 5, labs 7 incl. Nephrology/Oncology/Emergency, pharmacy 6 incl. Psychiatry) *and* an id-bearing `Department` entity in administration — normalize to one table.
5. **Duplicated shapes:** `VitalSigns` ≡ `RecordVitalSigns`; `MedicationStatus` ≡ `RecordMedicationStatus`; `AllergySeverity` ≡ `RecordAllergySeverity`; `ClinicalNote` ≡ `RecordClinicalNote`; three unrelated `ChatMessage`/`Conversation` types (messaging, comm-center, AI) — intentional feature-locality in front-end, but one canonical table each in DB.
6. **Derived values stored on DTOs:** `patient.age` (alongside DOB), `hasSevereAllergy`, `nextAppointment`, `hasCriticalResult`, `refillStatus`, `Department.staffCount`, queue `waitingMinutes` — compute in DB (views/triggers), don't double-store (except trigger-maintained `has_critical_result` for index use).
7. **Role vocabularies disagree:** auth `Role` = doctor|admin; `PlatformRole` adds reception/laboratory/pharmacy; `StaffRole` says *receptionist* (not *reception*) and adds nurse; `ContactRole` adds patient. One `roles` table with aliases resolves this.
8. **Two admin-settings section lists:** `routes.ts` `AdminSettingsSection` (6 sections, pre-Phase-18) vs `AdminSettingsPanelId` (16 panels) — the route union is stale.
9. **Route contract drift:** UX §1.3 uses `/doctor/pharmacy/prescriptions/:rxId` and `/doctor/settings/availability`; code uses `/doctor/pharmacy/:prescriptionId` and has no availability section (it lives in UX only). Medical-records module exists in code but not in UX §1.3 route map.
10. **`featureFlags.aiAssistant = false`** while the AI module is fully built and routed (flag comment says "Phase 7" — stale).
11. **Two notification-preference surfaces** (notifications feature drawer and Settings→Notifications) persisting the same concept — must converge on one `notification_preferences` row.
12. **MRN examples inconsistent** between UX (4482-19 for Amira Saleh) and roster (4468-12 for Amira Saleh) — cosmetic, but confirms MRN needs a single generator.
13. **Session policy split:** mock session TTL 12 h/30 d + 10-min idle lock in `configs/session.ts`, while Phase 18 `sessionTimeoutMinutes` default differs — make the platform_settings security slice the single source, as the session.ts comment already intends.
14. **`bloodPressure` stored as one string** ("128/82") — split into systolic/diastolic for range checks and analytics.
15. **Demo password (`Medora123!`) and OTP (`123456`) are hardcoded** in the mock layer — must never seed production.

---

*End of specification. Every confirmed entity above traces to at least one type definition, mock service, or UX blueprint section; every inferred entity is explicitly labeled as a recommendation in §13.*
