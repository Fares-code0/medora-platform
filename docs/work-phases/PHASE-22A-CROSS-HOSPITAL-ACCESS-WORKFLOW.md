# Phase 22A — Cross-Hospital Access: Grants, Break-Glass, Documentation & Consultations

**Origin:** NEW on 2026-10-07 (owner decision DR-06). Numbered `22A` so Phases 23–31 keep their numbers.
Reconciled with the FINAL owner decisions, including **OD-04 = A** and **OQ-01 = A**.
**Primary Area:** Backend + Security (+ Frontend UI, + Database)
**Status:** NOT STARTED
**Valid after the final decisions:** yes, extended with Break-Glass (OD-04), doctor-approved documentation
(OQ-01) and consultations (OD-13)
**Depends On:** 21, 22
**Enables:** 25, 26, 28, 29, 30

**Related documentation:** `docs/multi-hospital/OWNER_DECISIONS.md` DR-06, OD-01…OD-04, OD-13, OQ-01;
`API_CONTRACT_CHANGES.md` §3, §3a, §3b, §4; `SECURITY_AND_DATA_ISOLATION.md` §3–§5

> **Correction history.**
> - *First version:* left duration, consent, scope and break-glass as OD-01…OD-04, and required AI to
>   ignore grants.
> - *Second version (rev. 3):* documented "no break-glass", "no consent step (inferred)" and an open
>   OQ-01. **Superseded** by the final decisions:
>   - purpose-bound grants with no fixed default duration, revocable at any time (OD-01);
>   - patient consent not required (OD-02);
>   - admin-selected categories (OD-03);
>   - **Break-Glass exists** (OD-04);
>   - AI may use data authorized by either path, with no raw retention (OD-05);
>   - consultations allowed (OD-13);
>   - **selective doctor-approved documentation** into the requesting hospital's record allowed
>     (OQ-01 = A).

---

## Objective

Build the two legitimate cross-hospital access paths, the documentation flow and the consultation
workflow, all audited and none permanent.

```text
PATH 1 — normal grant                         PATH 2 — emergency Break-Glass
Doctor @ A → request {purpose, categories}     Doctor @ A (active employment + permission)
 → Hospital B Admin approves {categories, end}  → emergency reason
 → category-scoped grant, purpose lifetime      → minimum-necessary scope, one patient, time-limited
 → audit → revoke / expire / end purpose        → full audit, B notified → automatic end / revocation

Either path → doctor reviews B data → selects relevant items (AI may draft)
            → explicit approve/save → Hospital A record content with provenance (OQ-01)
```

## Owner decisions it implements

DR-06, DR-07, OD-01, OD-02, OD-03, OD-04, OD-07, OD-12, OD-13, OQ-01, all FINAL. DR-12 / OD-05 govern
AI use (Phase 28).

## Deliverables

**Path 1 — grants**
- [ ] [BACKEND] Request (purpose + categories); approve (categories ⊆ requested, explicit end) or
  reject; revoke; close; automatic expiry; invalidation on requester employment end
- [ ] [BACKEND] Grant-based reads on a separate endpoint family, category-filtered, **validity
  re-checked on every call**
- [ ] [BACKEND] No patient-consent step (OD-02); no fixed default duration (OD-01)

**Path 2 — Break-Glass**
- [ ] [BACKEND] Start session:
  - authorized doctor with an active employment;
  - required emergency reason;
  - one patient;
  - minimum-necessary emergency category set;
  - bounded window.
- [ ] [BACKEND] Every read validity-checked and audited (doctor, target hospital, patient, categories,
  resources)
- [ ] [BACKEND] Target Hospital Admin notification, revocation and post-event review; automatic end;
  afterwards 404
- [ ] [BACKEND] Never widens ordinary routes, never bypasses employment, never permanent

**Documentation into the requesting hospital's record (OQ-01)**
- [ ] [BACKEND] Doctor-only save, while authorization is valid:
  - per-item selection within the authorized scope;
  - **no whole-record import**;
  - creates Hospital A content plus a provenance row.
- [ ] [BACKEND] Provenance refs never resolve to B data without valid authorization; no access by side
  effect

**Consultations (OD-13)**
- [ ] [BACKEND] Request, messages, close. Record data only through a valid grant or Break-Glass; audited

**Common**
- [ ] [BACKEND] Audit every event:
  - request, approval, rejection, start, access, revocation, expiry, end, closure;
  - invalidation, AI use, documentation save.
- [ ] [BACKEND] Enumeration resistance before approval
- [ ] [FRONTEND] Grant request and status; authorized-record view (WEB-10, WEB-11); Break-Glass start,
  banner and end (WEB-13a); Hospital Admin queue, revoke and Break-Glass review (WEB-12, WEB-13b);
  documentation flow (WEB-13c); consultation workspace (WEB-13)
- [ ] [TESTING] N-2…N-5, N-15, N-24…N-30

## Blocking conditions

Phases 21 and 22. The Break-Glass emergency category set and maximum window are implementation
specifications that need clinical sign-off before release.

## Security requirements

- Gate **G-3**.
- Neither path widens ordinary routes (N-4).
- Documentation never grants access to the source (N-30).

## Downstream phases

25, 26, 28, 29, 30

## Source / evidence

- Owner decisions DR-06, OD-01…OD-04, OD-13, OQ-01 (2026-10-07)
- `backend/prisma/schema/12-adr010.prisma` `PatientAccessGrant` (AF-38)
