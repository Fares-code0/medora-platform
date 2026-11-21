# IMP-30: Interim Hardening, Scope Record (BLOCKED / NOT IMPLEMENTED)

| Field | Value |
|---|---|
| Recorded | 2026-11-13 (decision log entries L-004 and L-005) |
| Authorization | **FD-18 Option (b)**: IMP-30 carved out of G2 and authorized as a separate, stand-alone hardening task, strictly isolated from unrelated G2 work. **ACC-09 stays OPEN and NOT ACCEPTED** |
| Status | **BLOCKED / NOT IMPLEMENTED**. **Owner scope correction (2026-11-13, decision log L-005): do NOT implement IMP-30 or IMP-01.** The FD-18 carve-out from G2 stays recorded as a decision, but implementation does not proceed. The fact that no database change is needed removes neither blocker, and authorizes nothing. No code has been written; no branch has been created |
| Evidence baseline | `origin/backend` `452dd006` (read-only, `git show`) |

---

## 1. Scope, taken from the source documents only

| Source | What it says |
|---|---|
| Spec v1.2 §3, option (b) | "On the **last** code, staff classes only: still an ordinary session, **plus**: revoke every *other* session; an audit row at severity `WARNING`; a notification to administrators; a message to the user that no recovery codes remain and that the authenticator must not be lost before recovery exists. No new self-service path is added … The `WARNING` audit row is the review record; no new column is needed" |
| Dependencies v1.2, IMP-30 | "Interim hardened last-code behaviour (MRD-20(b)); retired by IMP-04", type BE, base `backend`, **Depends on: IMP-01, MRD-20**, before PRE-03: Yes |
| Dependencies v1.2 §3 | "No column for the hardened interim: the audit row is the record" |
| Matrix v1.2, row 8.33 | Evidence `step-up.service.ts:189`; `revokeAllFor`; fit EXTEND |
| Owner decision R-1 | Notifications are generic; the remaining count is shown only in 2FA settings |
| Owner decision FD-21 / spec §3 | "Staff classes" cannot be evaluated before Phase 21; read as **every non-patient role** |

**Resulting scope (no control added beyond the sources).** When a **non-patient** account redeems its **last**
recovery code:

1. It still receives an ordinary session. The response is unchanged, with **no API change**.
2. **Every other session** of the account is revoked.
3. An audit row at severity `WARNING` exists.
4. Administrators are notified.
5. The user receives a **generic** message, with no count (R-1 overrides the v1.2 wording "no recovery codes
   remain").

**Unchanged:** patients, every non-last code, the R3 email, and every other route.

## 2. Out of scope (explicitly)

- **Recovery features:** P2, R-A, patient recovery, patient or staff MFA enforcement, account-wide throttling
  (FD-23), external alerting (FD-27), emergency identities (FD-25).
- **BG-B:** BG-B, PRE-05, DB-11, the BG-B part of IMP-15.
- **Other recovery-flow work:** every other IMP task, and IMP-01 itself unless the owner authorizes it (§5, B-1).
- **No schema change, no migration, no new column.** None is needed (§3).
- **No API, DTO or client change.** Changing `backend/src/modules/auth/dto/` would also trigger the patient-app
  suite, and is not required.

## 3. Affected code (identified read-only; nothing changed)

| Concern | Location at `452dd006` | Finding |
|---|---|---|
| Last-code detection | `backend/src/modules/auth/services/step-up.service.ts:159` (`remaining`), `:176` (`metadata: { remaining }`) | `remaining.length === 0` identifies the last code inside the existing transaction |
| Session creation | `step-up.service.ts:189` (`establishSession`) | The new session is created **after** the redemption transaction commits |
| Revocation | `backend/src/modules/auth/services/session.service.ts:167` (`revokeAllFor`); the `revokeOtherSessions` pattern in `password-recovery.service.ts:157-160` | No existing method revokes "all but this session" **on a caller's transaction**. That capability is **IMP-01** |
| Audit severity | `backend/src/shared/audit/audit-taxonomy.ts:117`: `'auth.recovery_code_used': 'warning'`; enum `AuditSeverity.WARNING` (`prisma/schema/01-enums.prisma:818-823`) | **Every** recovery-code redemption already writes a `WARNING` row, with `remaining` in its metadata. Whether the last code needs a distinct action is not stated in the sources |
| Administrator notification | `backend/src/modules/notifications/services/notification-rules.ts` (every rule must name its source); `notification-recipient.repository.ts:112` (`administrators()`); categories include `SECURITY` (`01-enums.prisma:486-497`) | A code-only rule with source "MRD-20 (b)" is possible; **no enum or schema change**. Title, body, priority and audience wording are not specified in the sources |
| User message | `auth-mail.service.ts:118-132` (existing generic R3 email, sent on every redemption); activity row "Signed in with a recovery code" (`step-up.service.ts:191-195`) | The sources do not say whether the existing generic email suffices, or whether a distinct generic message is required |

## 4. Acceptance criteria

**No acceptance criteria for IMP-30 exist in the source documents.** Spec §17 lists none, and v1.0 §12 and v1.1 §15
predate MRD-20.

The set below is **PROPOSED, derived one-to-one from §1. It is not approved.**

| # | Proposed criterion |
|---|---|
| AC-1 | A non-patient account redeeming its last code receives exactly today's response (`200`, authenticated payload) |
| AC-2 | After AC-1, every other session of that account is revoked; the new session remains valid |
| AC-3 | A `WARNING` audit row records the event (existing `auth.recovery_code_used`, `remaining: 0`, **or** a distinct action, to be decided) |
| AC-4 | Active administrators receive a security notification through the outbox (content to be decided; no codes, secrets or counts) |
| AC-5 | The user receives a generic message with no count (R-1); the count remains only in `GET /me/2fa` |
| AC-6 | Patients: unchanged (no extra revocation, no administrator notification) |
| AC-7 | Non-last codes, for every role: unchanged |
| AC-8 | Failure behaviour defined (whether a revocation or notification failure may leave the redemption committed) |
| AC-9 | Tests: backend unit tests for the above; existing recovery-code tests still pass; the backend quality gate (`typecheck`, `lint`, `test`, `build`) is green; no DTO change, so the patient-app suite is unaffected |

## 5. Blockers (why no code was changed; confirmed by the owner's scope correction, L-005)

| ID | Blocker | Why it stops implementation | Minimum owner input needed |
|---|---|---|---|
| **B-1** | IMP-30 **depends on IMP-01** (transaction-aware `SessionService`), which is **not authorized** | Revoking the other sessions atomically with the redemption, which is the documented design, needs IMP-01. Doing it after the transaction would deviate from the documented dependency: a failure could leave other sessions alive. Either path is a decision this record must not make | Choose one: **(i)** authorize the minimal part of IMP-01 that IMP-30 needs ("revoke all other sessions on a caller's transaction"); or **(ii)** approve non-transactional revocation after session creation, with defined failure handling (AC-8) |
| **B-2** | **IMP-30 has no defined acceptance criteria in spec §17** (nor in any other source document) | Without approved criteria, "done" cannot be verified | Confirm AC-1 to AC-9, and decide: the AC-3 distinct action or not; AC-4 content; AC-5 existing email or a new message; AC-8 failure handling |
| B-3 (note only) | Branch | CLAUDE.md requires a task branch cut from `backend`. The local `backend` is 33 commits behind `origin/backend` (`03182bef` vs `452dd006`) | None now. **No branch was created.** Any future work needs a new explicit owner authorization after B-1 and B-2 are resolved |

## 6. Retirement

IMP-30 is retired by IMP-04, the full last-code transition after Phase 21. Until IMP-30 ships, MRR-16 stays
**High**; after, Medium. **ACC-09 stays OPEN and NOT ACCEPTED** either way, until its individual review at design
approval (FD-20).
