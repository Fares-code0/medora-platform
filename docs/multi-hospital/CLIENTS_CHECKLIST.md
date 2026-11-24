# Multi-Hospital — Frontend and Patient App Checklist

**Owner teams:** Frontend (`frontend/`, doctor/admin web) and Patient App (`patient-app/`).
**Work phases:**
- 25 — doctor workspace
- 26 — Hospital Admin and Platform Admin
- 27 — patient app
- 22A — grant, Break-Glass, consultation and documentation UI
- 28 — AI entry points
- 29 — integration closure

**Decisions:** all FINAL (`OWNER_DECISIONS.md`).
**Status:** IN PROGRESS (2026-11-01) — WEB-2, WEB-8 and PA-1 done; WEB-4, WEB-5 and PA-10 partial;
every other row waits on a backend phase ([Status — 2026-10-26](#status--2026-10-26)). Client
checks are display rules; the server is the boundary (`SECURITY_AND_DATA_ISOLATION.md` §2).
**Register (2026-10-26):** this file is the **only** status register for the WEB-* and PA-* tasks.
A task is done when its box is ticked here. Rows in `frontend/FRONTEND_CHECKLIST.md` and
`patient-app/PATIENT_FRONTEND_CHECKLIST.md` that track the same work name the row below and keep
no status of their own ([Cross-references](#cross-references)). A requirement that has no row here
is reported to the owner, not added in either app checklist.

---

## Frontend (doctor and admin web)

### Doctor workspace (Phase 25)
- [ ] **WEB-1** Show the doctor's **active hospital** (and clinic/location where relevant) from the session — DR-02 · *PARTIAL 2026-11-23: hospital name shown read-only for doctors from `GET /auth/session` (issue #31); clinic/location and the admin scope (#16) open*
- [x] **WEB-2** **No hospital switcher** of any kind — DR-08 (the 2026-10-06 ORG-01 plan is superseded) · *2026-10-26: verified absent and pinned by `frontend/src/app/no-hospital-switcher.test.ts`*
- [ ] **WEB-3** Hospital-scoped data on every doctor screen, with provenance labels — DR-04, DR-05
- [ ] **WEB-4** Hospital id in every hospital-scoped query key. Caches cleared when the session's hospital changes or employment ends — OD-12 · *PARTIAL 2026-10-26: the whole query cache now ends with the session (logout, refused refresh, lock); the hospital key waits on Phase 22*
- [ ] **WEB-5** Retire the mock-only `clinicId` and the fail-open `useClinicScope` (AF-17). Do **not** reuse it as hospital isolation. A doctor with no active employment sees an explicit empty state · *PARTIAL 2026-10-26: no longer fail-open — a doctor with no clinic gets an explicit empty state and no fetch; retiring it waits on the server's active hospital (Phase 22)*
- [ ] **WEB-6** Settings: read-only employment (hospital, clinic, department, since) and history; replaces the free-text hospital field — DR-02
- [ ] **WEB-7** Publish and withdraw online slots (capacity 1), separate from working hours — DR-10, OD-08
- [x] **WEB-8** Safety and summary screens state that they show **this hospital's** record — DR-03, DR-04 · *2026-10-26: safety screen and patient Overview; the hospital's **name** arrives with WEB-1*
- [ ] **WEB-9** "Ask AI" passes no hospital; the server binds it. When a grant or Break-Glass is in use, the UI labels cross-hospital content and shows when the authorization ends — DR-12

### Cross-hospital access, documentation and consultations (Phases 22A, 29)
- [ ] **WEB-10** Doctor: request access with **purpose and data categories**; see status
- [ ] **WEB-11** Doctor: authorized record view (grant or Break-Glass) that is distinct, read-only, labelled with the source hospital, and shows only authorized categories and the end time. It disappears **immediately** on expiry, revocation, closure or window end
- [ ] **WEB-12** Hospital Admin: incoming queue; approve with categories and end, or reject; revoke at any time; access-event log
- [ ] **WEB-13** Doctor: cross-hospital **consultation** workspace (OD-13). Record data appears only through a valid grant or Break-Glass
- [ ] **WEB-13a** Doctor: **Break-Glass** start (emergency reason required, scope and time window shown before confirming), banner with countdown during the session, early end — OD-04
- [ ] **WEB-13b** Hospital Admin: Break-Glass notifications, revoke, post-event review — OD-04
- [ ] **WEB-13c** Doctor: **"Document into this hospital's record"**: select specific authorized items, edit, review any AI draft, explicit approve/save. Shows provenance on the saved entry. **No "import all"** — OQ-01

### Administration (Phase 26) — OD-07
- [ ] **WEB-14** **Hospital Admin** console: own hospital's clinics, locations, staff, doctor employment (hire/end), operations, booking policy, insurance acceptance, oversight, logs, reports, cross-hospital approvals
- [ ] **WEB-15** **Platform Admin** console: hospital lifecycle and configuration, Hospital Admin management, platform settings. **No automatic clinical data**
- [ ] **WEB-16** Role guards and navigation for Platform Admin, Hospital Admin and doctor (replaces Phase 19's two-role model)

## Patient App (Phase 27)

- [x] **PA-1** **Sign-in before discovery.** Signed out: only sign-in, registration and Emergency (N-12). No signed-out Discover (the 2026-10-06 G-11/E-01/H-06 plan is superseded) — DR-09 · *2026-10-26: verified already true, no code change; evidence below*
- [ ] **PA-2** Hospital search and profile with clinics and **multiple locations** — DR-09, OD-06
- [ ] **PA-3** Doctor search with specialty/department filters; each doctor shows one active hospital — DR-02
- [ ] **PA-4** **Compare** hospitals and doctors: specialty, location, **distance** (location permission requested in context, position not stored), next published slot, **ratings/reviews** — OD-10
- [ ] **PA-5** **Insurance:** insured patients see insurance-aware results and coverage messages; **uninsured patients see everything, unrestricted** — OD-14
- [ ] **PA-6** Show only doctor-published slots — DR-10
- [ ] **PA-7** Booking: `slotId` + `Idempotency-Key`; 409 slot-taken recovery; 422 coverage message for insured patients; hospital, clinic and location on every appointment — DR-11, OD-08, OD-14
- [ ] **PA-8** "My records": one Medical Record per hospital; every clinical screen names the hospital; never a merged view — DR-03, OD-09
- [ ] **PA-9** Patient AI uses the same hospital isolation and retention model (DR-12); the assistant is UI-only today (AF-30)
- [ ] **PA-10** Caches per account and hospital record; discovery caches separate from PHI caches · *PARTIAL 2026-11-01: the account half already holds (the cache ends with every session); the hospital-record key waits on Phases 23/24*
- [ ] **PA-11** Record claim: only once the method is decided (OQ-02 / RA-030.1)

## Status — 2026-10-26

Audited against `frontend` @ `38d2e52`, whose tree differs from `main` (`f9acc74`) only in
`frontend/DEPLOYMENT.md`. No multi-hospital API exists on any branch: `git grep -i 'hospital\|employment\|break.glass'`
over `backend/src` on `main` and `backend` finds only the `hospitalization` history kind and auth
copy. So every row that renders hospital data waits on a backend phase, and none of them is faked
with mock data here.

**Re-checked later on 2026-10-26** against `backend` `c93c233` and `main` `f9acc74`, with a
`git grep` for `activeHospital`, `employment` and `hospitalId` over `backend/src`. The only hits are
three auth comments that use "employment" in prose; there is no model, session field or route. No
row below changed. In particular, the open halves of WEB-4 and WEB-5 still have no session hospital
or employment to build on.

**Re-checked 2026-10-31** against `frontend` `220fc44` and `backend` `46e8753`, before choosing
frontend work.
- **Backend.** The same `git grep` (`activeHospital`, `hospitalId`, `employment`, `break.glass`)
  over `backend/src` and `backend/prisma` on `main` and `backend` still finds only the three auth
  comments. `GET /auth/session` names no hospital, clinic or location. Every open WEB row stays
  blocked, and none was faked.
- **Evidence for the rows marked done or partial still holds:**
  - WEB-2: `no-hospital-switcher.test.ts` is present.
  - WEB-5: `useClinicScope` returns `null` with no `clinicId`, and My Clinic shows its empty state.
  - WEB-6: the free-text field is not in `SERVER_PROFILE_FIELDS`.
  - WEB-8: both the safety screen's and the Overview's wording is pinned by tests.
  - WEB-16: the client's roles are still the five listed.
- **PRs #135–#141 moved no row here.** Their work is tracked on `frontend/FRONTEND_CHECKLIST.md`
  rows this file does not own: A-01…A-07, D-10…D-14, D-17/D-19, D-21/D-29 and §3.4.
- **One is adjacent to WEB-4.** Since PR #140, a session ended by a refused refresh, which is the
  path OD-12 says an ended employment takes, is named on the sign-in page ("Your session has
  ended") instead of the user being dropped there unexplained. WEB-4's open half, the hospital id
  in query keys, is unchanged.

**Re-checked 2026-11-01** against `frontend` `8a0b510` (after the 2026-10-31 integration of 160 `backend` commits, PR #159), `backend` `4d65dc0` and `main`:
- **Backend.** The same `git grep` (`activeHospital`, `hospitalId`, `employment`, `break.glass`, `breakGlass`) over `backend/src` and `backend/prisma` on all three still finds only the three auth comments. No hospital, employment, grant or Break-Glass model, session field or route exists. Every open WEB row and PA-2…PA-9 stays blocked, and none was faked.
- **PA-10 moved: Not started → Partial.** The account half was already true in `patient-app/`; verified rather than built, evidence in the table.
- **Adjacent work, tracked elsewhere and moving no row here:**
  - PR #162 connects the doctor Documents tab (`frontend/FRONTEND_CHECKLIST.md` D-04/D-04b).
  - PR #163 connects patient notification preferences (`patient-app/PATIENT_FRONTEND_CHECKLIST.md` O-06).
  - Neither is hospital-scoped.

| ID | Status | Evidence / blocker |
| --- | --- | --- |
| WEB-1 | **Partial** (2026-11-23) | Was "Blocked — Phase 22: the session names no hospital"; stale since PR #14, after which `GET /auth/session` returns `activeHospital: {id,name} \| null` and `adminScope` (`backend/src/modules/auth/services/session-user.service.ts`). Done: a doctor's sidebar account card shows the active hospital's name, read-only, live mode only, keyed by user id; null, malformed and failed answers show nothing (`frontend/src/layouts/Sidebar/ActiveHospital.tsx`, `ActiveHospital.test.tsx`; issue #31). Open: clinic/location (no field), the admin scope (#16), a reason for a null hospital (none in the API). Phase 22 shadow mode: display only, not a boundary |
| WEB-2 | **Done** | No switcher, route or session action exists. `frontend/src/app/no-hospital-switcher.test.ts` fails on any route for choosing a hospital/organization/clinic/workspace and on any source file (comments stripped) offering a control worded as one; a third case proves the pattern catches `Switch hospital`, `<HospitalSwitcher />`, `setActiveHospital` |
| WEB-3 | Blocked — Phases 21, 22 | No hospital-scoped responses or provenance fields |
| WEB-4 | **Partial** | Done: `AuthProvider` clears the TanStack Query cache on logout, on a refresh the server refuses (the path an ended employment takes, OD-12) and on lock — `FRONTEND_ARCHITECTURE.md` §6.3/§12.5 required it and nothing did it (`FRONTEND_CHECKLIST.md` NEW-31, its own register row because the logout/lock rule predates WEB-4). Open: the hospital id in each query key, and clearing on a hospital change — there is no hospital in the session to key on |
| WEB-5 | **Partial** | Done: `useClinicScope` fails closed — a doctor whose session has no `clinicId` (every live session) gets `null`, and My Clinic shows "Your session does not name a clinic" without fetching, instead of every clinic's board. `MyClinicPage.test.tsx` +2, failing on the old hook. Open: retiring `clinicId`/`useClinicScope` for the server's active hospital (Phase 22); the empty state's wording moves to employment then |
| WEB-6 | Blocked — Phase 22 (API-W03) | No employment data. The free-text hospital field is already not offered in live builds (`SERVER_PROFILE_FIELDS` omits it); it remains editable over the mock profile only |
| WEB-7 | Blocked — Phase 24 | No slot-publishing API |
| WEB-8 | **Done** | The safety screen's subtitle and its "No safety warnings" result say they screened *this hospital's record of the patient*; the patient Overview opens with "This hospital's record of the patient: what this hospital has recorded, not their history at other providers." `SafetyScreen.test.tsx` (2, new), `OverviewTab.test.tsx` +1. True today (one hospital) and under DR-04. The hospital's name is WEB-1's |
| WEB-9 | Blocked — Phase 28 (and D-09) | `/ai/*` routes exist on `main` (`backend/src/modules/ai`), but no AI provider/gateway is bound and the server binds no hospital, so the web client runs the disclosed mock assistant and sends no request to keep a hospital out of *(corrected 2026-11-22; was "The assistant has no backend")* |
| WEB-10…WEB-13c | Blocked — Phase 22A | No grant, Break-Glass, consultation or documentation API |
| WEB-14, WEB-15 | Blocked — Phase 26 | No Hospital Admin or Platform Admin API |
| WEB-16 | Blocked — Phase 22 | The client's roles are `doctor`, `admin`, `reception`, `laboratory` and `pharmacy` (`frontend/src/types/auth/index.ts`); the session carries no platform-admin or hospital-admin role to guard on |
| PA-1 | **Done** (verified, no change) | `patient-app/src/navigation/RootNavigator.tsx` mounts only `AuthStack` while signed out; `AuthStack` registers Onboarding, Welcome, Login, Otp, Register, VerifyEmail, ForgotPassword, ResetPassword, Consent and Emergency — no Discover, and `AuthStackParamList` has no route that could reach one. The server half is AF-18: `/patient/doctors*` and `/patient/specialties` are `@Authenticated()`. `navigation.test.tsx` covers the signed-out landing and Emergency. Not added: a test asserting Discover's absence — that is `patient-app/` work, which branches from `patient-app` (CLAUDE.md) |
| PA-2…PA-8 | Blocked — Phases 23, 24 | No hospital discovery, slot or per-hospital record API |
| PA-9 | Blocked — Phase 28 | The assistant is UI-only (AF-30) |
| PA-10 | **Partial** (2026-11-01, verified, no code change) | Done, in `patient-app/`: every session end — logout, a refused refresh, the background-timeout lock — calls `clearPhiCache` (`SessionProvider.tsx` `endSession`), which removes each PHI domain and then clears the whole cache. So no account ever reads another's cached data. `security.test.ts` *PHI cache clearing* proves the sweep is total, and that every clinical domain is listed in `PHI_QUERY_DOMAINS`, apart from discovery's `doctors`. Open: the hospital-record key in each PHI query, which needs the per-hospital record API (`GET /me/medical-records`, Phases 23/24). Keeping discovery cached across a sign-out is not done and not required: the sweep is total by design. *Corrected 2026-11-23 (issue #45):* the claim above had one exception: an optimistic mutation (notification read state, notification preferences) that failed **after** the sweep rolled back by key, re-creating the previous account's feed or overwriting the next account's query under the same key (TanStack runs `onError` after `clear()`). Fixed in `patient-app/src/api/optimistic.ts`: the rollback writes only into the query instance it snapshotted. `optimistic.test.ts` +3 and `features/auth/account-switch.test.tsx` (new, A → sign-out → B: cache, recent doctors and held link empty) fail without it |
| PA-11 | Blocked — OQ-02 | Deferred by the owner |

## Cross-references

Rows elsewhere that track the same work as a row above. They keep their IDs, notes and evidence,
and they take their status from here (added 2026-10-26).

| Here | `frontend/FRONTEND_CHECKLIST.md` (§13.6 maps them) | `patient-app/PATIENT_FRONTEND_CHECKLIST.md` |
|---|---|---|
| WEB-1, WEB-2 | ORG-01; API-W01; the §3.4 ⚠ note (hospital and location shown) | — |
| WEB-3, WEB-4 | API-W02, API-W14, API-W09 (doctor messaging); the §3.1, §3.2, §3.3, §3.4, §3.6, §3.8, §3.9, §3.11 ⚠ notes; D-26's hospital scope | — |
| WEB-5 | ORG-01 (retiring the mock `clinicId`); API-W01 (no-employment state) | — |
| WEB-6 | API-W03; the §3.12 ⚠ note (employment replaces the free-text hospital field) | — |
| WEB-8, WEB-10, WEB-11 | API-W04 (withdrawn, DR-03); the §3.3, §3.6, §3.7 ⚠ notes | — |
| WEB-14 | ORG-02; API-W05…W12 (hospital half) | — |
| WEB-15 | ORG-03; API-W10 (platform half), API-W13 | — |
| WEB-16 | A-08's hospital-admin / platform-admin split; API-W01 | — |
| PA-1 | — | G-11 (withdrawn, superseded by PA-1; keeps its own ➖) |
| PA-2 | — | H-06 |
| PA-4 | — | H-07, H-08, Q-05 |
| PA-8 | — | P-11 |
| PA-11 | — | P-12 |

**Named by no row above (reported 2026-10-26, not added):** per-location availability, and the
location picker on create with location-timezone display (`FRONTEND_CHECKLIST.md` §3.4 and §3.12
⚠ notes, API-W03). They stay open there until the owner adds a row here or drops them. The WEB-14
mapping for API-W07 (patient directory) and API-W09's admin half is by reading "oversight" and
should be confirmed.

## Quality gates

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend run test && npm --prefix frontend run build
npm --prefix patient-app run typecheck && npm --prefix patient-app run lint && npm --prefix patient-app run test && npm --prefix patient-app run build
```
`frontend/src/types/auth/` changes also run the backend suite (CLAUDE.md).
