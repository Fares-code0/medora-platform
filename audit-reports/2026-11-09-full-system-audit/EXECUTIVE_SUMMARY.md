# Medora — Executive Summary

Full-system engineering audit, 2026-11-09. Audit only: no source, configuration, schema
or Git state was changed, and nothing was deployed.

**Audited:** the working tree of `claude/emr-visual-redesign` at `ad4c6a8d` (web client,
API, database schema and patient app), with the other remote branches read for
comparison. **Method:** code reading with file-and-line evidence, the project's own
typecheck, lint, unit-test and build commands, and `npm audit`. **Not available:** a
database, Redis or object store, so the API was never run and the backend's 104
end-to-end specs were not executed.

---

## 1. Overall assessment

Medora is a **well-engineered foundation that is not a releasable product**.

The engineering quality of what exists is high, and in places unusually so for a project
at this stage. The API denies by default, scopes every patient read and write to a care
relationship, refuses to fake any external service it has not been given, and keeps
PHI out of logs and error bodies. Both clients refuse to show fixture data in a
production build and say plainly when a capability is unavailable. The audit looked for an
authorization bypass or a cross-patient data path in the code it read and did not find
one.

What is missing is larger than what is wrong:

- **The defining capability is absent.** No AI model is integrated anywhere. The API's AI
  gateway always answers 503, the web assistant returns labelled canned text, and the
  patient assistant is switched off by a constant. Symptom analysis, diagnostic
  suggestions, emergency detection, voice and image input do not exist.
- **The patient app cannot do its main job.** Patients can sign in, edit a profile,
  browse doctors and read appointments. They cannot book or cancel one, read a health
  record or message the clinic, because the API has no such routes.
- **There is no single version of the product.** The newest backend, the newest patient
  app and the newest web client live on branches that have diverged by 255 and 431
  commits and have never been built or tested together.
- **Nothing exists to run it safely.** No backups, no backend deployment definition, no
  monitoring or incident procedure.

**Readiness: NO-GO** for any use with real patient data. This is a judgement from the
evidence in the nine reports, not a score; no numerical quality rating is offered,
because none would be defensible. Clinical readiness was not assessed and cannot be
inferred from anything here.

---

## 2. Findings at a glance

49 findings, each counted once.

| Severity | Count | Meaning here |
| --- | ---: | --- |
| P0 Critical | 0 | Nothing found exposes patient data to an unauthenticated caller, and no production deployment handling real data is defined |
| P1 High | 7 | Each blocks a release |
| P2 Medium | 21 | Most block a release or need a decision |
| P3 Low | 16 | |
| P4 Informational | 5 | |

Of the 49, **8 were confirmed by executing something**, **38 by reading the cited
code**, 1 is a heuristic result rated probable, and **2 are unverified** for lack of
evidence in the repository. The two
highest-impact technical defects (MED-SEC-001, MED-DB-001) are in the second group: the
code is unambiguous, but neither was reproduced against a running system.

---

## 3. The seven release blockers

| ID | Finding | Why it matters |
| --- | --- | --- |
| **MED-SEC-001** | *[withheld: security-sensitive]* | *[withheld: security-sensitive]* |
| **MED-DB-001** | Appointment booking checks for conflicts and then inserts, with no lock and no database constraint (`appointment.service.ts:177-184`) | Two simultaneous requests can double-book a clinician. Rare with staff booking; routine once patients book for themselves. |
| **MED-ARCH-001** | Integration branches have diverged from `main` by hundreds of commits | Security and correctness work sits unmerged; every fix has to be made more than once; no tested whole exists. |
| **MED-BE-001** | No malware scanner is bound on `main`, and the download gate opens only for scanned files | Every document and attachment download is refused permanently. Already fixed on the `backend` branch, never promoted. |
| **MED-OPS-001** | No backup or restore capability of any kind | Clinical records would exist in one place and be unrecoverable after a failure. |
| **MED-AI-001** | No AI integration exists | The product as named and described cannot be delivered; any demonstration or marketing must not imply otherwise. |
| **MED-MOB-001** | Patient booking, records, messaging, clinic information and emergency dialling have no backend | The patient app is not a usable product. |

## 4. Highest-risk security and healthcare concerns

- **Credential containment** (MED-SEC-001), above.
- **Fail-open configuration** (MED-SEC-002). *[Withheld from the published copy: security-sensitive content.]*
- **Abuse resistance** (MED-SEC-003). *[Withheld from the published copy: security-sensitive content.]*
- **Controls that do not exist** (MED-SEC-004). *[Withheld from the published copy: security-sensitive content.]*
- **Unevidenced data protection** (MED-SEC-005, MED-SEC-006). Encryption at rest and in
  transit cannot be confirmed because no infrastructure is defined. There is no data
  export, erasure or clinical-retention mechanism.
- **Dependencies** (MED-CI-002). *[Withheld from the published copy: security-sensitive content.]*
- **AI, when it arrives** (MED-AI-002, MED-AI-003). The generation path has no
  output-safety layer or evaluation set, and by design sends the patient's name to a
  third-party provider with no recorded data-processing decision. Both are latent today.
- **Emergency access.** The patient app's Emergency screen is guidance text only. That
  is safe as built; it must not be described as emergency access.

None of this is a statement about legal compliance, which needs legal review.

## 5. Major architectural weaknesses

1. **Branch topology** (MED-ARCH-001). Long-lived per-domain branches without scheduled
   promotion.
2. **Unmatched halves** (MED-ARCH-002). The server has routes the web client never calls
   (clinic administration, audit log, messaging, AI). The clients need routes the server
   lacks (the whole patient surface).
3. **Tenancy** (MED-ARCH-003). The schema is single-clinic: none of 111 models has a
   tenant key. A twelve-phase multi-hospital redesign is planned, has not started, and
   several features are being deferred against it.
4. **No operational architecture** (MED-OPS-001 to -003). Hosting, migrations in
   release, backups, monitoring and incident response are undefined.

## 6. Functional completeness

From `FEATURE_TRACEABILITY_MATRIX.md` (80 features traced; **none verified end to end**):

| Area | State |
| --- | --- |
| Clinician web workspace + API — patients, chart, appointments, records, labs, prescribing | Both halves built and contract-tested; never observed working together in this audit. Downloads, staff messaging, push and SMS do not function. |
| Administrator web workspace | Doctors, users/roles, appointment oversight and settings are connected. Nine of thirteen areas are demo-only or unimplemented, including the audit-log viewer. |
| Patient app | 4 of 12 user-facing areas function against the API. Booking, records, messaging and emergency do not. |
| AI | 0 of 10 stated capabilities function. |
| Staff roles other than doctor and admin | Reception, laboratory, pharmacy and nurse can sign in and do little or nothing. |

## 7. Testing and CI reliability

Executed on Windows with Node 24, against the uncommitted working tree:

| Package | Typecheck | Lint | Tests | Build |
| --- | --- | --- | --- | --- |
| Backend | Pass | Pass | Unit subset: 941 passed, 1 failed, 17 skipped. **E2E suite not run.** | Not run |
| Web | Pass | Pass (0 errors, 20 accepted warnings) | 3,142 passed, 10 failed in the full run; 9 of those pass in isolation, 1 fails on Node 24 | Pass |
| Patient app | Pass | Pass | 2,049 passed, 55 failed in 4 suites. One of the four passes when run alone; another does not finish on this machine even alone. Cause undetermined. | Not run |

The test estate is large and thoughtful: 104 server e2e specs, 3,155 web tests, 2,104
app tests, and a generated authorization table reviewed as a diff. Its gaps are specific.
No test drives a client against the real API. *[Withheld from the published copy: security-sensitive content.]*
No Node version is pinned and three majors
are in use. Several suites are sensitive to timing. *[Withheld from the published copy: security-sensitive content.]*

## 8. Technical debt and maintainability

Low in code, high in process. The code is consistently typed (6 `any`, no
`@ts-ignore` in the web source), has one `TODO` across three trees, and is densely
commented with reasoning. The debt is elsewhere: 150 Markdown documents, two ADR
systems, a root README that says "Milestone 6 of 43" and "all data is mock data" while
also advertising features that do not exist, and a working tree holding 106 uncommitted
paths across four areas on one task branch.

## 9. Decisions needed now

These cost no engineering time and gate most of the work.

| # | Decision | Owner |
| --- | --- | --- |
| D-1 | How branches are reconciled and kept together afterwards | Engineering lead |
| D-3 | First-release scope: which roles, patient messaging or not, **AI or not** | Product owner |
| D-2 | The patient booking model (ADR-033 is still a proposal) | Product and clinical |
| D-6 | Release single-clinic first, or build multi-hospital before any release | Product and architecture |
| D-7 | Where the API, database and object store are hosted | Engineering lead |
| D-4, D-5, D-8 | Session policy; retention and erasure; third-party processors | Security, legal |
| — | A named clinical owner | Organisation |

## 10. Recommended strategy

1. **Phase 0 — one trunk.** Commit the working tree, reconcile the branches, correct
   the README. Four to eight engineer-days. Nothing else is safe to build until this is done.
2. **Phase 1 — close the security and data-protection blockers.** Refresh-token
   delivery, fail-closed configuration, rate limiting, dependency gate, backups with a
   rehearsed restore.
3. **Phase 2 — integrity.** Database-enforced booking exclusivity; the scanner bound and
   a download proven; readiness probe.
4. **Phase 3 — make the halves meet.** The patient API surface and app integration; the
   administrator workspace; an end-to-end smoke suite.
5. **Phase 4 — AI, only if in scope**, and only after a data-processing decision, a
   safety layer, an evaluation method and a clinical owner exist. Patient-facing triage
   is a separate programme that needs clinical validation and regulatory advice.

Seven tasks (reconcile, refresh-token fix, fail-closed environment, booking constraint,
backups, CI gate, dependency gate) remove most of the acute risk for roughly 10–20
engineer-days. The whole roadmap is sized at 140–265 engineer-days excluding the
multi-hospital programme and all clinical, legal and procurement time. Those figures are
pre-investigation estimates with wide ranges, set out task by task in
`REMEDIATION_ROADMAP.md`.

## 11. Limitations

- **The API was never run.** No finding was reproduced dynamically. The backend e2e
  suite, migrations, `db:check` and seed were not executed.
- **Not everything was read.** The three trees hold about 377,000 lines of tracked
  source and tests. Authentication, authorization, configuration, AI, files,
  appointments, patient scoping and both clients' transport and service seams were read
  closely. The laboratory, pharmacy, medical-record, messaging, notification, reporting
  and administration modules, and most UI components, were inspected by route table,
  targeted search and sampling. Defects in those areas would not have been found.
- **Results describe an uncommitted working tree** on a non-CI Node version.
- **Not observable:** GitHub branch protection and CI results, any deployed
  environment, hosting configuration, and the live database.
- **Out of scope:** penetration testing, load testing, device testing, clinical
  validation and legal compliance.

`AUDIT_COVERAGE_AND_EVIDENCE.md` states exactly what was and was not inspected.

## 12. The nine reports

| Report | Purpose |
| --- | --- |
| `EXECUTIVE_SUMMARY.md` | This document |
| `FULL_TECHNICAL_AUDIT.md` | Finding register and detail by subsystem |
| `SECURITY_AND_PRIVACY_AUDIT.md` | Security findings, isolation analysis, release gates |
| `FEATURE_TRACEABILITY_MATRIX.md` | 80 features traced across web, mobile, API, database and AI |
| `TESTING_AND_QUALITY_REPORT.md` | Commands run, results, what was not run |
| `REMEDIATION_ROADMAP.md` | Phased, dependency-aware plan with tasks and decisions |
| `DEPENDENCY_AND_BLOCKER_REGISTER.md` | What blocks what; what can start now |
| `AUDIT_COVERAGE_AND_EVIDENCE.md` | Scope, methods, commands, repository state before and after |
| `RELEASE_READINESS_CHECKLIST.md` | 111-item go/no-go checklist with current status |
