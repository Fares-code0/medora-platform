# Multi-Hospital — Implementation Order

**No implementation is performed by this documentation.** This file fixes the order future work
follows. All owner decisions are **FINAL**, including OD-04 = A (Break-Glass) and OQ-01 = A. Only
**OQ-02** (record-claim identity proofing, RA-030.1) is open. It is deferred to implementation and
blocks only the record-claim sub-feature.

| # | Step | Work phase | Primary team | Decisions it implements | Exit gate |
|---|---|---|---|---|---|
| 1 | **Owner decisions — FINAL** | — | Owner | DR-01…DR-13, OD-01…OD-14, OQ-01 | Done 2026-10-07 |
| 2 | Replacement / supersession **ADR-042** (draft: `ADR-042-DRAFT.md`) | 20 | Architecture | All | Owner approves the draft; appended to the register after a fresh number sweep; ADR-018 §1, ADR-010 clause, ADR-022 anchor marked superseded |
| 3 | Data model | 21 (stage 1) | Database | DR-01…04, 06, 07, 10, 11; OD-03, 06, 07, 08, 09, 13, 14 | Schema reviewed; `db:check` green |
| 4 | Migration | 21 (stage 2) | Database + Backend | OD-07 (admin mapping), OD-09 | Default-hospital backfill rehearsed with rollback; admin mapping list approved; **G-1** |
| 5 | Hospital authorization / context | 22 | Backend + Security | DR-05, 07, 08; OD-07, OD-12 | Shadow-mode diff reviewed; **G-2** (partial), **G-4** |
| 6 | Cross-hospital access: grants, Break-Glass, consultations, doctor-approved documentation | 22A | Backend + Frontend | DR-06; OD-01…OD-04, OD-13; OQ-01 | **G-3** |
| 7 | Authenticated discovery | 23 | Backend | DR-09; OD-10, OD-14 | Discovery authenticated (G-7, discovery half) |
| 8 | Published slots / booking | 24 | Backend + Database | DR-10, DR-11; OD-08, OD-09, OD-14 | **G-6** |
| 9 | Frontend + Patient App integration | 25, 26, 27, 29 | Frontend, Patient App, Backend | DR-02, 08, 09; OD-07, 10, 13, 14 | Clients reflect active hospital, no switcher, authenticated discovery, booking; **G-4**, **G-7** |
| 10 | AI authorization / context / retention (C1/C2/C3) | 28 | AI + Backend | DR-12 (OD-05), DR-13 (OD-11), OD-04, OQ-01 | **G-5** before any real provider |
| 11 | Cross-hospital security tests | 30 | Security + Testing | All | **G-1…G-8** green |
| 12 | Full-system QA | 31 | All | — | Live sweep per role on a two-hospital staging DB |
| 13 | **Second-hospital readiness gate** | 31 | Owner + Security | — | Owner sign-off; all gates green; migration rehearsed |

## Parallelism

- Steps 6 and 7 run in parallel after step 5.
- Step 9 starts per screen once its API exists.
- Step 10's AI capabilities are developed **in parallel** (OD-11). Each is individually validated, and
  **no real provider** is enabled before G-5. High-risk capabilities have stronger release gates.

## Where the one open item bites

| Item | Affects | Safe default until defined (TECHNICAL RECOMMENDATION) |
|---|---|---|
| OQ-02 — record-claim identity proofing (RA-030.1) | Phase 27 (claim) | Claim not offered until the method is defined; new records are created on the first real interaction (OD-09). The isolation architecture does not change |

## How existing tracks feed this order

| Existing track | Feeds step |
|---|---|
| Frontend Phases 00–19, FE-A…FE-F | Historical base for 9 |
| FE-10.1–10.10 (27 connected, 22 mock, 10 blocked) | Base for 9; open rows close in 22 (F33), 26, 28, 29 |
| M7 authorization | Redesigned in 5 |
| M10, M12, M13, M14 | 3–5 |
| M11 appointments | 8 |
| M16 AI | 10 |
| M19, M20, M25, M26, M27 | 9 (Phase 29) |
| M23, M24, M28 | 9 (Phase 26) |
| M37 | 11 |
| M38, M41–M43 | 12–13 |
| Patient-app E, G, H, I, J, O, P | 9 (Phase 27) |
| Patient-app K, L | 10 |
| Patient-app M | 9 (Phase 29) |
| Patient-app T, U | 11 |
| Patient-app V, W | 12–13 |
| Patient mobile enablement 1–4 (ADR-030) | Done; global identity matches OD-09 |
