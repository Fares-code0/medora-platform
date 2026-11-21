# Repository Audit — Backend Roadmap Reconciliation

**Audited:** `Fares-code0/smart-healthcare-assistant-system` @ `887fe29` (main), 2026-08-11
**Method:** static read of the tracked tree (569 files), `git ls-remote`, per-feature greps
**Purpose:** the three backend specs were written against a described frontend. This is what the repository actually contains, and what that changes in `BACKEND_IMPLEMENTATION_ROADMAP.md`.

Every roadmap edit marked **[R2]** traces to a numbered finding here.

---

## 1. What the repository actually is

A **monorepo**, not the two-repo arrangement the specs imply.

| Path | Contents |
|---|---|
| `frontend/` | The Medora SPA — 569 tracked files, ~52,000 LOC in `src/`, 13 feature modules |
| `frontend/*.md` | 24 documents including **`DATABASE_SCHEMA_EXTRACTION.md`** (130 KB) |
| `backend/` | Created by this commit — specs only, no code |
| `.github/workflows/ci.yml` | One job, `working-directory: frontend` |

Branches on origin: `main`, `develop`, `frontend`, `backend`, plus four `claude/*` feature branches. **`develop`, `frontend` and `backend` all point at the same commit (`37fe5b0`) and contain only `.gitignore` + `README.md`** — they are empty placeholders, not parallel lines of work. `main` (`e4e6d1a`) is the only branch with the project on it.

### 1.1 Correction to an earlier claim

`DATABASE_SCHEMA_EXTRACTION.md` was reported missing. **It is present** at `frontend/DATABASE_SCHEMA_EXTRACTION.md` — complete, with the full data dictionary (§2), business rules (§4), enum inventory (§6), the 17 inferred-table recommendations (§13), and the 12-phase creation order (§14.2) that Milestone 5 is written against. No schema reconstruction is needed.

It is a database document living in the frontend folder. Four frontend docs link to it, so **M0.3** decides whether it moves rather than moving it unilaterally.

---

## 2. Finding 1 — Five API-contract modules had no implementation milestone

The most consequential gap. `M2.1` creates module skeletons for `ai`, `settings`, `administration`, `platform-settings` and `dashboard`; `M5.5`/`M5.9`/`M5.10` create their tables. **No milestone then built any of their endpoints.**

| Contract module | Endpoints | Skeleton (M2.1) | Tables | Implementation milestone (rev 1) |
|---|---|---|---|---|
| §11 AI Assistant | 8 | ✅ | DB §H1–H4 | **none** |
| §13 Doctor Settings Center | 5 | ✅ | DB §J1–J3 | **none** |
| §18 Administration Center | 16 resource groups | ✅ | DB §K1–K12 | **none** |
| §19 Platform Settings | 7 | ✅ | DB §L1–L4 | **none** |
| §16.2–16.3 Dashboard | 3 (+ per-widget) | ✅ | — | **none** (M15.4 covered the action queue only) |

Rev 1 even referenced a platform-settings milestone that did not exist: **M3.3 says "once M19 exists"**, but M19 was Messaging. That dangling reference is the fingerprint of the omission.

**Resolution:** six new milestones — M16 (AI), M22 (Settings), M23 (Administration), M24 (Platform Settings), M27 (Dashboard), and M39 (see finding 3). Everything downstream renumbered; M0–M37 became M0–M43. M3.3 now points at M24.

---

## 3. Finding 2 — The frontend is not "19 phases complete"

The master guide §2.1 describes a finished frontend with production-grade gates. `frontend/FRONTEND_CHECKLIST.md` — audited 2026-08-09 by the frontend team — describes something else, and the code agrees with the checklist.

**Verified by direct grep** (files containing `useMutation` per feature):

```
ai: 1   appointments: 1   dashboard: 0   labs: 0   medical-records: 0
messaging: 1   notifications: 1   patients: 1   pharmacy: 0   reports: 1
settings: 1    admin: 4
```

`labs`, `pharmacy`, `medical-records` and `dashboard` have **no write paths at all**. A doctor cannot order a lab, mark a critical result reviewed, write a prescription, or create a record. `src/api/endpoints/` contains only `.gitkeep`.

On the admin side, five of nine UX §3 screens do not exist (ADM-02/03 doctors, ADM-04 patients governance, ADM-06 communications, ADM-08 reports) and ADM-07 (system logs) is a five-row feed inside a settings panel. Three have landed recently — ADM-05 appointment oversight, ADM-09 the permission matrix, ADM-10 PHI masking — and are live consumers the backend must serve.

**Impact on exit gates.** Three gates as written could never pass:

- **M13** — "the frontend stepper's 4 steps complete against the API". There is no stepper.
- **M14** — lab ordering and critical review have no UI.
- **M12** — record create/update/sign have no UI.

**Resolution:** those gates now verify by contract test at their own milestone and re-verify against the UI at **M40.6**. Each affected milestone carries a ⚠️ note naming the missing consumer. M9.5, M10.7, M20.7 and M28.3 are likewise marked "no frontend consumer — verify by contract test".

---

## 4. Finding 3 — Four transport-contract mismatches

Read from `frontend/src/api/client.ts`, `errors.ts`, `types/api/index.ts`, `configs/env.ts`, `.env.example`.

**3.1 Base path.** `.env.example` and the `configs/env.ts` default are `http://localhost:3000/api`. The contract specifies base `/api/v1` and refresh cookie `Path=/api/v1/auth`. As written the cookie's path never matches the request path, so **the browser never sends it** and silent refresh cannot work.

**3.2 The error `code` is dropped.** Contract §0.3 and master guide §10.4 both require a machine `code`, and the auth pages branch on it:

```ts
// LoginPage.tsx:46
if (isMockAuthError(error)) {
  if (error.code === 'email_unverified') { … }
  if (error.code === 'otp_required') { … }
```

But `isMockAuthError` narrows to `MockAuthError` — a class that only the **mock** throws. `normalizeHttpError` never reads `code`, `ErrorBody` has no such field, and the `ApiError` union has no member carrying one. Turn the mocks off and every login failure normalizes to `{ kind: 'auth' }`, which the client interprets as *token expired* → refresh → logout. **A wrong password would log the user out instead of showing an error.**

**3.3 401 is overloaded.** `ApiClient.request` retries *every* 401 through the refresh handler. The contract returns 401 `invalid_credentials` for a bad password (§1.2). Login failures therefore trigger a spurious refresh round-trip. Master guide §10.3 already says 401 is for token problems **only** — the two halves of the spec disagree with each other, and the client implements the permissive half.

**3.4 Missing headers.** The client sends `X-Correlation-Id` and `Authorization` but never `Idempotency-Key` (contract §0.5 requires POSTs to accept it) or `X-Client-Type` (the mobile variant M41.1 depends on it).

**Resolution:** **M0.6** decides each on paper before code exists; **M39.1–M39.4** carries the frontend fixes. M1.2 and M6.2 now verify that `code` is populated on every auth error.

---

## 5. Finding 4 — The API contract's seam map is stale

Appendix A lists fifteen swap points. Thirteen resolve. Two do not:

| Appendix A path | Reality |
|---|---|
| `features/doctor/administration/administration.queries.ts` | moved → `features/admin/administration.queries.ts` |
| `features/doctor/administration/admin-settings.queries.ts` | moved → `features/admin/admin-settings.queries.ts` |

The rename is frontend checklist item D-28, done as part of moving the admin area to `/admin/*`. **M0.4** re-verifies all fifteen and patches the contract.

---

## 6. Finding 5 — The 17 inferred tables were never scoped

DB §13 lists 17 recommended-but-unconfirmed table groups, explicitly flagged "never mix with confirmed". Rev 1's M5 silently included some (`patient_doctor_assignments`, `drug_interactions`, `medication_monographs`) and never mentioned the rest — yet six are hard prerequisites of milestones in this roadmap:

| Table | Required by |
|---|---|
| `patient_doctor_assignments` | M7.2 — the care-scoping anchor, and the RLS anchor at M37.3 |
| `drug_interactions` | M13.2 — severity-graded interaction screen |
| `medication_monographs` | M13.1 — monograph endpoint |
| `notification_deliveries` | M19.5 — per-channel delivery tracking |
| `incident_bookmarks` | M28.4 — saved event selections |
| `report_exports` | M21.5 — export artifacts |

**Resolution:** **M0.5** requires an in/out decision for all 17; **M5.11** builds the ones marked in that no other step creates.

---

## 7. Finding 6 — CI is frontend-only

`.github/workflows/ci.yml` sets `defaults.run.working-directory: frontend` and runs one job. A backend commit would run the frontend suite and report green having tested nothing of the change. **M1.7** adds a path-filtered backend job.

---

## 8. Finding 7 — Two smaller contradictions

**8.1 Billing flag-off behavior.** Contract §12.1 says revenue returns "404/flag-off alternate"; roadmap M16.2 (now M17.2) requires the alternate payload "not 500". Two documents, three behaviors. The frontend renders alternates and has no 404 branch here, so **M17.2 now fixes the alternate payload** and says so explicitly.

**8.2 Demo credentials are published.** The root README prints `Medora123!` alongside the seeded accounts. Harmless while everything is a mock fixture, and the README says so — but M38.4's grep gate must cover it. Noted there.

---

## 9. What did not change

- The stack (Node 20 · NestJS 10 · Prisma · Postgres 16 · Redis · BullMQ · Zod · Argon2id).
- The safety architecture — fail-closed prescribing, individual critical-lab review, the single audit choke point, masked-by-default PHI. This is the strongest part of the spec set and none of it was affected.
- Milestone content for M1–M15 beyond cross-reference renumbering and the notes described above.
- Relative execution order. The six new milestones were inserted at their correct dependency positions; nothing was reordered.

---

## 10. Milestone renumbering map

| Rev 1 | Rev 2 | | Rev 1 | Rev 2 |
|---|---|---|---|---|
| M0–M15 | unchanged | | M25 Jobs | **M30** |
| — | **M16 AI** *(new)* | | M26 Caching | **M31** |
| M16 Billing | **M17** | | M27 Performance | **M32** |
| M17 Payments | **M18** | | M28 API Docs | **M33** |
| M18 Notifications | **M19** | | M29 Testing | **M34** |
| M19 Messaging | **M20** | | M30 Docker | **M35** |
| M20 Reports | **M21** | | M31 CI/CD | **M36** |
| — | **M22 Settings** *(new)* | | M32 Security | **M37** |
| — | **M23 Administration** *(new)* | | M33 Prod Readiness | **M38** |
| — | **M24 Platform Settings** *(new)* | | — | **M39 FE Alignment** *(new)* |
| M21 Files | **M25** | | M34 FE Integration | **M40** |
| M22 Search | **M26** | | M35 Mobile | **M41** |
| — | **M27 Dashboard** *(new)* | | M36 Final QA | **M42** |
| M23 Audit | **M28** | | M37 Release | **M43** |
| M24 Activity | **M29** | | | |

Cross-references updated throughout: M3.3 → M24 · M4.4 → M37 · M9.2 → M25 · working rule 5 → M28 · M28.2 scope → M6–M27 · M38.1 → M23.6 · M37.2 → M24.4.
