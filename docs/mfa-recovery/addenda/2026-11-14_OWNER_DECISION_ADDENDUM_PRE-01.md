# MFA Recovery: Owner-Decision Addendum of 2026-11-14 (PRE-01 implementation authorization)

| Field | Value |
|---|---|
| Date | 2026-11-14 |
| Status | **G4 APPROVED** by the owner for PRE-01 only; PRE-01 behaviour and the logout exception **APPROVED** (owner decisions of 2026-11-14, §6). **IMPLEMENTED** on branch `claude/backend-four-phase-hardening` (base `1d08b3c1` = `origin/main`); commit, push and one pull request to `main` authorized (G7); **merge (G8) and deployment (G9) not authorized** |
| Nature | Records an implementation authorization and the implementation's verified status. It takes **no new policy decision**: the policy is I4 and O-13 (FINAL, `../v1.2.1/MFA_RECOVERY_OWNER_DECISIONS_v1.2.1.md`) |
| Originals | `../v1.2.1/*` and `../v1.2-review/00_OWNER_DECISION_LOG.md`, unchanged and byte-identical to `claude/mfa-recovery-v1.2.1-originals` (hashes in §7) |
| Companions | `CHANGELOG.md` (this addendum's change record); `2026-11-14_OWNER_DECISION_ADDENDUM_D1_D2.md` (§5 below records where PRE-01 changes a statement made there) |

This addendum allocates no MRD, FD, ADR or IMP number.

---

## 1. The authorization

v1.2.1 recorded PRE-01 as **APPROVED as policy (I4, O-13); implementation BLOCKED on G4**
(`MFA_RECOVERY_IMPLEMENTATION_DEPENDENCIES_v1.2.1.md` §1) and the spec as "Implementation **not authorized**"
(`MFA_RECOVERY_SECURITY_SPEC_v1.2.1.md` §5.1). The D1/D2 addendum (§5.3) restated "PRE-01 not authorized".

The owner's four-phase backend instruction of 2026-11-14 ("Medora Backend — Four-Phase Engineering Execution Plan")
directed, as Phase 1, "PRE-01 Session Validation … Complete the existing PRE-01 Session Validation work safely", with
"Do not invent a new session policy". The owner's follow-up of 2026-11-14 ("Medora Backend — Final Security Review and
Scope Correction") states:

> The owner explicitly authorized Phase 1 execution through the four-phase implementation instruction.

That is recorded here as the **G4 implementation authorization for PRE-01**, and for PRE-01 alone. It does not
authorize any other v1.2.1 item (IMP-01 … IMP-30, DB-*, PRE-03, PRE-05), and no v1.2.1 gate other than G4 for PRE-01
changes. G6–G9 (security review and CI, push or PR, merge, deploy) remain separate and **not given**.

## 2. What PRE-01 required, and what was built

The requirement is spec §5.1's RECOMMENDED design under I4 / O-13 / I2: "every protected request resolves `sid` and
refuses it when the session is revoked, expired, of the wrong kind, or the user is not `ACTIVE`. PostgreSQL is
authoritative; any cache is bounded by C-12 (OPEN)." O-13's owner note: "Immediate" means rejecting new requests once
the revocation is committed and visible to the authorization path; it does not cancel a request already executing.

| Requirement | Status | Where |
|---|---|---|
| Every protected request resolves `sid` | **IMPLEMENTED.** The global `AccessTokenGuard` (`APP_GUARD`) calls `SessionService.isActive(sid, sub)` after the signature check on every route not marked `@Public()` | `backend/src/modules/auth/guards/access-token.guard.ts`; `services/session.service.ts` |
| Refuse a revoked session | **IMPLEMENTED.** `revoked_at IS NULL` is a condition of the read. Every revocation path (logout, revoke one / others, password reset and change, 2FA disable and lockout, refresh reuse, single-session sign-in, administrative deactivation) sets `revoked_at`, so each reaches the next request | same |
| Refuse an expired session | **IMPLEMENTED.** `expires_at > now()` | same |
| Session belongs to the token's subject | **IMPLEMENTED.** `user_id = sub` is a condition of the read; a token whose `sid` and `sub` disagree is refused | same |
| Refuse when the user is not `ACTIVE` | **IMPLEMENTED**, including soft-deleted accounts: the join requires `users.status = active` and `users.deleted_at IS NULL` | same |
| Refuse a session "of the wrong kind" | **NOT IMPLEMENTED — and not claimed.** Recovery sessions (`mfa_recovery`, spec §5.2) do not exist; no session kind is stored or issued. This clause becomes implementable with IMP-02/IMP-03, which remain BLOCKED on their own dependencies | — |
| PostgreSQL authoritative; no cache unless bounded by C-12 | **IMPLEMENTED with no cache.** One uncached read per protected request. C-12 stays OPEN and is not exercised; introducing any cache needs that decision first | `docs/CACHING.md` ("Sessions") |
| Malformed identifiers | `sid` or `sub` that is not a uuid → **401**, never a uuid cast that would answer 500 | `session.service.ts` |
| Fail closed on a database error | **VERIFIED.** A failed session read propagates; no principal is attached and the request answers 5xx, never the protected response | `access-token.guard.spec.ts`; `session-validation.e2e-spec.ts` ("a failed session read fails closed") |
| Signature verification unchanged | **VERIFIED.** `AccessTokenService.verify` (HS256 pin, claim narrowing) is untouched and runs first; a token that does not verify is refused before any database read | `access-token-forgery.e2e-spec.ts` (15, unchanged, green); `access-token.guard.spec.ts` |
| Public routes and special flows | **VERIFIED unchanged.** `@Public()` routes return before any token or session read (login, OTP verify / resend / recovery, refresh, register, verification, password reset, invitation accept / activate, health, metrics). Refresh keeps its own checks (`RefreshService`) | `session-validation.e2e-spec.ts` ("public routes are untouched") |

The refusal is **401 `unauthorized`**, message "Session expired" — the shape `/auth/refresh` already uses for a dead
session — so a client's handling is unchanged (ADR-013: refresh once, then sign out) and a token holder cannot tell
revoked from expired from suspended.

### 2.1 The logout exception (`@AllowEndedSession()`)

`POST /auth/logout` (API §1.6: "session revoked, cookie cleared, 204") must stay idempotent for a client whose session
was ended elsewhere. It is the **only** handler marked `@AllowEndedSession()`. On that route the guard:

- still requires a token this service signed (unchanged signature check);
- still requires that the token's `sid` names a session row **belonging to its `sub`** (`SessionService.belongsTo`) —
  any state: revoked, expired, or an account that is no longer `ACTIVE`;
- waives only *liveness*. The handler then revokes that same session (a no-op if already revoked) and clears the
  cookie.

The marker is read from the **handler only**, never the controller, so it cannot exempt a whole controller. A test
walks every registered controller and handler and asserts `AuthController.logout` is the only carrier.

Found and closed during the review: the first version of the exception skipped the session read entirely, so a
validly signed token whose `sid` named **another account's** session would have logged that session out, and a signed
token with a malformed `sid` would have reached the revocation as a uuid cast. Both require the signing key, so
neither was reachable by a client; both are now 401 and pinned by tests that fail without the identity check.

This exception is an implementation detail of an existing contract (API §1.6), not a new policy. It is listed in §6
for the owner's explicit confirmation all the same.

### 2.2 Cost

One statement per protected request, measured with the statement-level wrapper `query-count.e2e-spec.ts` uses:

```sql
SELECT sessions.id FROM sessions LEFT JOIN users j0 ON j0.id = sessions.user_id
WHERE sessions.id = $1 AND sessions.user_id = $2 AND sessions.revoked_at IS NULL
  AND sessions.expires_at > $3 AND j0.status = $4 AND j0.deleted_at IS NULL AND j0.id IS NOT NULL
LIMIT 1
```

With sequential scans disabled (the plan a production-sized table gets): index scan on `sessions_user_id_live_idx`
(partial, `revoked_at IS NULL`), nested loop into `users_pkey`. Execution 0.04 ms on the test cluster. The logout
check is a single `sessions` lookup by id and user. Pool impact: one short extra round trip per protected request on
the application's existing `pg` pool; no new connection, no transaction, no lock. `query-count.e2e-spec.ts` (N+1
assertions) stays green because the cost is constant per request.

### 2.3 Load validation (owner request of 2026-11-14)

The compiled API (`node dist/main.js`, one process) against a disposable PostgreSQL 16 (`pg_stat_statements`
enabled) and Redis 7, both local. **Baseline** = `HEAD` `1d08b3c1` built from a temporary detached worktree (no
PRE-01); **PRE-01** = the working tree. Two rounds each, alternated. 20 signed-in doctors; a keep-alive Node client
cycling `GET /me/sessions`, `/auth/session`, `/notifications/badge-counts` and `/patients?pageSize=20`; 30 s per
level. Full method and raw numbers: `backend/docs/PERFORMANCE.md` §"PRE-01 session check under load".

| Concurrency | Build | req/s | p50 ms | p95 ms | p99 ms | non-200 |
|---|---|---:|---:|---:|---:|---:|
| 16 | baseline | 617 / 526 | 22.2 / 26.1 | 48.1 / 57.0 | 60.8 / 66.2 | 0 |
| 16 | PRE-01 | 483 / 476 | 29.2 / 29.7 | 57.1 / 56.8 | 72.6 / 69.0 | 0 |
| 64 | baseline | 537 / 519 | 99.4 / 109.1 | 248.1 / 248.7 | 323.6 / 296.8 | 0 |
| 64 | PRE-01 | 429 / 494 | 135.5 / 114.0 | 271.1 / 238.4 | 291.1 / 274.9 | 0 |

- **One lookup per protected request**: the PRE-01 statement's `calls` equalled the request count exactly in every
  run (for example 14,501 requests, 14,501 calls).
- **Lookup latency in PostgreSQL**: mean 0.021–0.028 ms; maximum 0.5–4.5 ms; no lookup failed (0 non-200 answers).
- **Connection pool**: never above the `pg` pool's 10 connections in either build; at most 2–3 active at any 250 ms
  sample. The pool is not the constraint; the single Node process is.
- **Cost**: about 13–16 % fewer requests per second on this cheap-endpoint mix, and about +4–7 ms at p50 under
  concurrency 16. p95 and p99 at concurrency 64 are within run-to-run noise. The database time is negligible; the
  cost is the per-request Prisma call in the API process. Endpoints that do more work pay proportionally less.
  Not judged a serious issue, so nothing was changed; no cache was introduced.

**PostgreSQL unavailable** (stopped for 10 s in the middle of a 40 s load, 2 × 8 concurrent clients):

| Route during the outage | Baseline | PRE-01 |
|---|---|---|
| `GET /notifications/badge-counts` (answerable from Redis) | **200 throughout** — about 2,900 requests authorized with no session check | **500 throughout** — fail closed; no 200 between t=10 s and t=19 s |
| `GET /me/sessions` | 500 | 500 |
| After PostgreSQL restarts | 200 within the first second | 200 within the first second |

The process survived both outages. The refusal is the global `500 internal_error`, the same answer any route gives
for a database failure today; mapping it to 503 would be a separate, application-wide change.

## 3. Verification

Against a disposable local PostgreSQL 16 and Redis 7 (migrated and seeded with the repository's own `db:deploy` and
`db:seed`; removed afterwards).

| Suite | Result |
|---|---|
| `test/session-validation.e2e-spec.ts` (new) | 30/30. 18 of its original 23 cases fail with the session check disabled; the two logout-identity cases fail with `belongsTo` stubbed to accept |
| `src/modules/auth/guards/access-token.guard.spec.ts` (new) | 12/12 |
| `test/auth-two-factor.e2e-spec.ts` (adjusted, see §5) | green |
| Authentication and authorization suites (`auth-*`, `access-token-forgery`, `account-security`, `users-account`, `authz-*`, `patient-identity-from-session`) | green; counts in the final validation report |

## 4. Risk register status (supplements v1.2.1 `MFA_RECOVERY_OPEN_SECURITY_RISKS_v1.2.1.md`)

| Risk | v1.2.1 status (unchanged in the original) | Status recorded by this addendum |
|---|---|---|
| MRR-01 — a revoked session's access token stays valid up to 900 s | VERIFIED; mitigation "PRE-01 per-request validation" | **MITIGATED IN THE WORKING TREE, NOT YET IN ANY BRANCH.** Verified by the suites in §3. It becomes the platform's behaviour only when the change is committed, reviewed and merged (G6–G8), and in production only when deployed (G9). Residual, by O-13's own definition: a request already executing when the revocation commits is not cancelled. **No risk is accepted** (ACC-01 stays NOT ACCEPTED) |
| MRR-15 | as in v1.2.1 | **Unchanged.** Not assessed by this work |

## 5. What PRE-01 changes elsewhere

| Statement | Where | After PRE-01 |
|---|---|---|
| "the access token already issued stays valid for up to `JWT_ACCESS_TTL` (900 s). While locked, every password-checking route answers 429" | D1/D2 addendum §5.3, first row | The session the lockout ends is refused **401 `unauthorized`** from its next request, at the guard, before any password-checking handler. A **different** session that is still live gets 429 on a password-checking route while the account is locked, and that session ends too. The D1/D2 addendum is left as written; this row supersedes its first sentence once PRE-01 merges. `auth-two-factor.e2e-spec.ts` (D2 case) asserts both |
| A token whose session was deleted kept working until expiry | the 2FA spec's own fixture | The fixture now keeps the token's session (`enrol(..., { keepSession: true })`) where a test goes on to use it |
| Client impact | web and patient app | After any revoke-all flow (2FA disable, password reset, lockout, administrative deactivation), the client's next call answers 401; its refresh then fails and it signs out, which the clients already do. Before PRE-01 this happened up to 15 minutes later |

## 6. Owner decisions recorded (2026-11-14)

From the owner's message "I approve the following owner decisions for the current Medora backend implementation",
2026-11-14, verbatim for the items this addendum concerns:

> 1. G4 — PRE-01: Approved. The explicit instruction to implement Phase 1 authorizes PRE-01 implementation. Record
>    this authorization in the new addendum. Do not modify the original eight v1.2.1 documents.
> 2. PRE-01 behavior: Approved. Revoked or expired sessions must be rejected on the next protected request rather
>    than remaining usable for the access-token lifetime.
> 3. Logout exception: Approved with the implemented safeguards:
>    * Token signature verification remains mandatory.
>    * Session ownership must match the token subject.
>    * The exception applies only to the logout handler.
>    * It must never authorize ordinary protected requests or another user's session.
> 4. Wrong session kind: Keep this unresolved until recovery-session types exist. Do not invent or implement a
>    speculative policy.

| Item | Recorded status |
|---|---|
| G4 for PRE-01 | **APPROVED.** Applies to PRE-01 only; no other v1.2.1 item gains G4 |
| PRE-01 behaviour (§2) | **APPROVED** |
| Logout exception (§2.1) | **APPROVED** with the four safeguards above, each implemented and pinned by a test: signature (`access-token.guard.spec.ts`, "does not relax the signature check"); ownership (`session-validation.e2e-spec.ts`, "refuses logout when the token's sid is another account's session"); logout handler only (same spec, "is carried by exactly one handler"; the guard reads the handler only); never ordinary requests (same spec, "an ended session is refused by every other route") |
| Wrong session kind | **UNRESOLVED**, by owner instruction, until recovery-session types exist. Nothing speculative is implemented |
| G6 | Security review recorded in this addendum; CI runs on the pull request |
| G7 (push, pull request) | **AUTHORIZED** — one consolidated pull request to `main` |
| G8 (merge), G9 (deploy) | **NOT AUTHORIZED**; separate owner approval required |

The same message's other decisions are not MFA-recovery items and are recorded where they belong:
the push-delivery worker fix (not approved), the M41.2 deprecation window (open) and the
`communications.viewMetadata` question (open) in `backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md`; no schema,
migration or seed change is authorized.

## 7. Originals unchanged

SHA-256 (first 16 hex digits), identical in the working tree, at `HEAD` and on
`claude/mfa-recovery-v1.2.1-originals`:

| File | SHA-256 |
|---|---|
| `v1.2-review/00_OWNER_DECISION_LOG.md` | `a57670e717e161b7` |
| `v1.2.1/IMP-30_INTERIM_HARDENING_SCOPE_RECORD.md` | `abac03ed44cb3386` |
| `v1.2.1/MFA_RECOVERY_COMPATIBILITY_MATRIX_v1.2.1.md` | `6cb7cdc067001562` |
| `v1.2.1/MFA_RECOVERY_IMPLEMENTATION_DEPENDENCIES_v1.2.1.md` | `47bdfa646b40a4be` |
| `v1.2.1/MFA_RECOVERY_OPEN_SECURITY_RISKS_v1.2.1.md` | `269b33e601018708` |
| `v1.2.1/MFA_RECOVERY_OWNER_DECISIONS_v1.2.1.md` | `d03c972cef26ebc7` |
| `v1.2.1/MFA_RECOVERY_SECURITY_SPEC_v1.2.1.md` | `8e33ab3138783267` |
| `v1.2.1/MFA_RECOVERY_V1.2.1_CHANGELOG.md` | `9f517253f6744333` |
