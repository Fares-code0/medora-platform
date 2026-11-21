# Phase 30 — Cross-Hospital Security & Data Isolation Verification (Critical Gate)

**Origin:** audit-derived; reconciled with the FINAL owner decisions on 2026-10-07
**Primary Area:** Security + Testing (+ Database, Backend, AI)
**Status:** NOT STARTED. No cross-hospital tests exist today (AF-23).
**Valid after the final decisions:** yes. It is the critical gate before any second hospital.
**Depends On:** 21, 22, 22A, 23, 24, 25, 26, 27, 28, 29
**Enables:** 31

**Related documentation:** `docs/multi-hospital/SECURITY_AND_DATA_ISOLATION.md` §9 (N-1…N-30),
§10 (G-1…G-8)

> **Correction history.**
> - *First version:* tested organization isolation, public payloads and a switcher leak.
> - *Second version:* required AI to exclude grant-covered data (old N-6 / G-5). **Superseded:**
>   G-5 now requires AI to use cross-hospital data **only** under a valid grant, within its categories,
>   to stop immediately when it ends, and to **retain nothing**.
> - Platform-admin clinical access (OD-07), consultations (OD-13) and insurance behaviour (OD-14) are now
>   tested.
> - *Third version:* grant-only. **Superseded:** Break-Glass (OD-04) and doctor-approved documentation
>   (OQ-01) are tested too (N-24…N-30).

---

## Objective

Prove in CI that no hospital can read or change another's data through:
- ids, lists, search, filters, exports or aggregates;
- admin paths, assignments or messages;
- AI context or caches.

The only exceptions are a valid, category-limited, audited **grant** and valid, minimum-necessary,
time-limited, audited **Break-Glass** access. The AI retains no raw cross-hospital data after either ends.
Doctor-approved content saved into the requesting hospital's record is that hospital's data, with
provenance.

## Owner decisions it verifies

DR-01…DR-12, OD-01…OD-14, OQ-01 (all FINAL).

## Deliverables

- [ ] [TESTING] Negative and lifecycle matrix N-1…N-30
- [ ] [TESTING] Headline tests:
  - **Hospital A doctor ✗ Hospital B Medical Record** unless explicitly authorized by a valid grant or
    valid Break-Glass;
  - **AI for Hospital A ✗ Hospital B data** by default;
  - **AI with a valid grant or Break-Glass**: only authorized categories/scope, only while valid, **no raw
    data retained** after
    expiry, revocation, purpose end, emergency-window end or employment end;
  - **Break-Glass**: emergency reason required, minimum necessary, time-limited, attributable, ends
    automatically, no widening;
  - **doctor-approved documentation**: selective only, stays Hospital A data after the grant ends, no
    access to the B source;
  - **Platform Admin ✗ clinical data** without explicit permission;
  - **uninsured patient sees everything** in discovery.
- [ ] [DATABASE] RLS on patient/clinical tables (production gate); AI DB role with no clinical writes
- [ ] [BACKEND] Verify PHI withholding and reveal audit
- [ ] [SECURITY] Threat review: grants, Break-Glass abuse, documentation-as-exfiltration, consultations,
  employment transitions, booking abuse, discovery
  scraping, review content, AI retention
- [ ] [FRONTEND] [PATIENT-APP] Cache and session leak tests

## Blocking conditions

All feature phases.

## Security requirements

Gates **G-1…G-8** are mandatory. No second real hospital before they pass.

## Downstream phases

31

## Source / evidence

- ADR-018 §Testing, ADR-022
- `origin/frontend:docs/handoff/clinic-isolation.md` §4 rule 8
- `docs/multi-hospital/AUDIT_FINDINGS.md`
