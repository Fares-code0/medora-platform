# Incident response — backend runbook (draft)

**Scope.** What to do, with the controls this backend actually has, when a security incident
is suspected: a compromised account, a leaked secret, an attack on sign-in, or a suspected
disclosure of patient data. RM **M37.4**.

> **Status: DRAFT, not reviewed.** Written 2026-10-30 from the code on `backend`. Each control
> below names the route, setting or command that implements it and the test that exercises
> it. **No step has been rehearsed against a production deployment**, because none exists.
> The roadmap's verify step is "runbook reviewed + committed". This commits it; the review
> is the owner's, together with the decisions in §7.

---

## 1. First hour

| # | Do this | Why |
|---|---|---|
| 1 | Name one incident lead. Open a written timeline (UTC) and log every action in it, with who did it | Section 5 depends on knowing what was changed and when |
| 2 | Collect the **`ref`** from any error the reporter saw. Every 5xx body carries it. It is the request's correlation id (`X-Correlation-Id`), and every log line for that request carries it as `req.id` | It joins the report, the logs and the audit ledger (§4) |
| 3 | Classify, using §2 | Decides which playbook in §3 applies |
| 4 | **Preserve before you change anything** (§4.3). Restarting the API does not lose the audit ledger, but stdout logs are only as durable as the platform keeping them | Rotation and redeploys are the usual next step, and both restart processes |
| 5 | Contain (§3) | — |
| 6 | Tell the owner. Any suspected disclosure of patient data goes to the owner the same hour, whatever its size | Notification duties are a legal question this runbook does not answer (§7) |

## 2. Severity

A proposal for the owner to confirm or replace (§7).

| Level | Meaning | Examples |
|---|---|---|
| **SEV-1** | Patient data disclosed or very likely disclosed, or a platform-wide credential compromised | Database dump leaked; `JWT_SECRET` or `DATA_ENCRYPTION_KEY` leaked; an administrator account taken over |
| **SEV-2** | One account compromised, or an active attack with no confirmed disclosure | A doctor's password phished; credential stuffing against `/auth/login` |
| **SEV-3** | A weakness found, not exploited | A finding from review or a scanner |

## 3. Containment playbooks

### 3.1 One account is compromised

1. **Deactivate the account:** `PATCH /api/v1/admin/users/{userId}` with `{ "active": false }`
   (capability `roles.manage`). The route takes any account's public id. Deactivation
   **revokes every open session** of that account in the same call, and the audit row
   (`user.administer`) records how many as `sessionsRevoked`. Refresh is refused from then on,
   and sign-in answers 403 `account_inactive`. (`platform-user.service.ts`;
   `users-account.e2e-spec.ts`, "deactivates softly: login refused, row intact, sessions
   ended".) An administrator cannot change their own status, so a second administrator must
   do this for an administrator account.
2. **No residual window (PRE-01):** the access-token guard reads the session row on every
   protected request (`access-token.guard.ts`, `SessionService.isActive`), so an access token
   already issued for a revoked session — or for an account that is no longer `ACTIVE` — is
   refused with 401 from the next request on. A request already executing when the
   revocation commits is not cancelled (O-13). Setting `users.status` directly at the
   database (§3.1 step 3) takes effect the same way, even before the sessions are revoked.
3. **If the account is an administrator**, also review what it changed. Filter the audit
   ledger by actor (`GET /api/v1/audit-events?actorId=…&from=…`, capability `logs.view`),
   looking especially for permission-matrix edits, role changes, new invitations and API
   keys. **If it is the only active administrator**, the API cannot contain it: the last
   active administrator cannot be deactivated or demoted (409), nobody may change their own
   status, and `npm run admin:bootstrap` refuses while any administrator exists. Contain it
   at the database (set its `users.status` to `inactive` and revoke its sessions, §3.2 step
   1), then bootstrap a new administrator. See §7.
4. **Patient accounts:** the same route reaches them. The dedicated patient-governance
   surface (M10.7: unlock, reset credentials) is not built, so deactivation is the only
   containment control for a patient account today.

### 3.2 Platform-wide: `JWT_SECRET` leaked, or "sign everyone out"

Rotating the signing key **alone does not sign anyone out**. Refresh tokens are opaque
random values stored hashed, not JWTs, so the next refresh mints an access token under the
new key (`PRODUCTION_SETUP.md` §2). Both steps are needed, in this order:

1. Revoke every live session, as the database operator:
   ```sql
   UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;
   ```
   Refresh is refused for a revoked session (`session.service.ts`, the `revokedAt: null`
   predicate on rotation; `account-security.e2e-spec.ts`, "revoked session's refresh → 401").
   There is **no API route** for this.
2. Generate a new secret (`openssl rand -base64 48`), set `JWT_SECRET` on **every** instance,
   and restart them together. Every access token signed with the old value is refused at
   once.
3. Everyone signs in again. Administrators need their second factor, which is unaffected.

### 3.3 `DATA_ENCRYPTION_KEY` leaked

The key encrypts TOTP secrets, recovery codes and integration credentials (AES-256-GCM,
`shared/crypto/envelope.service.ts`). **Containment is a key rotation**
(`PRODUCTION_SETUP.md` §2.1). Pre-stage the new key as `DATA_ENCRYPTION_KEY_PREVIOUS`, swap
it into `DATA_ENCRYPTION_KEY` with the leaked one as previous, then run
`npm run crypto:reencrypt -- --confirm` until it exits 0. Exit 0 needs a clean verification
pass, no stale writer and both audit rows. It is a point-in-time result, so remove the leaked
key only when the retirement preconditions in `PRODUCTION_SETUP.md` §2.1 hold: every
envelope-writing process was upgraded and drained **before** that run started. Keep the
leaked key offline afterwards; it still opens anything a stale writer sealed with it. Each step is a
rolling change in which every instance can read every other instance's writes, so no account
is locked out.

That contains a leak of **the key alone**. The key and a copy of the database together expose
every second factor in plaintext, and re-sealing them under a new key does not undo that.
Treat the combination as SEV-1. Rotate the key, then have every two-factor account
re-enrol and receive new recovery codes. No bulk route exists for that (§7). Escalate to the
owner.

### 3.4 The database, or a dump of it, is exposed

What an attacker holds, by column:

| Data | Stored as | Exposure |
|---|---|---|
| Passwords | Argon2id hashes | Offline guessing only. Force a reset of every account (no bulk route exists; §7) |
| Refresh tokens, invitation and reset tokens | SHA-256 of a random value | Not usable from the hash. Revoke sessions anyway (§3.2 step 1) |
| TOTP secrets, recovery codes | AES-256-GCM under `DATA_ENCRYPTION_KEY` | Safe only while the key is not also exposed (§3.3) |
| Patient records, messages, audit ledger | Plaintext columns | **Disclosed.** SEV-1; notify the owner now |

### 3.5 An attack on sign-in (credential stuffing, OTP cycling, registration spam)

- Per-account lockout is always on (`SECURITY_LOGIN_ATTEMPT_LIMIT`,
  `SECURITY_LOCKOUT_MINUTES`, editable live under the platform's security settings). It stops
  one account being guessed. It does not stop one client trying many accounts.
- The per-client limit on the ten public credential routes ships **off**
  (`RATE_LIMIT_ENABLED=false`). Turn it on only if `TRUST_PROXY` has been verified for the
  deployment's proxy chain. Behind an unverified load balancer every user shares one
  allowance, and the limit locks everyone out together (`RATE_LIMITING.md`). If the proxy is
  unverified, block at the edge (WAF or load balancer) instead.
- Watch `login_events` for the pattern: many `failed` rows across many `attempted_email`
  values from one `ip_address`.

### 3.6 Stop all non-administrator traffic

Turn on maintenance mode: `PATCH /api/v1/platform-settings/general` with
`maintenanceMode: true` and a `maintenanceMessage`. It takes effect on every instance on the
next request, with no restart, because it is read from the database. Non-administrators get
**503** with the message; administrators and the public routes (sign-in, refresh, health)
still work, so an administrator can still act (`maintenance-mode.guard.ts`;
`maintenance-mode.e2e-spec.ts`). The `MAINTENANCE_MODE` environment variable is the fallback
when the database has no value.

### 3.7 A platform API key leaked

Revoke it: `POST /api/v1/platform-settings/api-keys/{id}/revoke`. **Today no route accepts
an API key** (RA-M24.1), so a leaked key grants nothing. Revoke it anyway, so it grants
nothing on the day keys start authenticating.

### 3.8 Suspected misuse of patient data by a signed-in user

1. Contain the account if the misuse is ongoing (§3.1).
2. Reads of a patient's chart write audit rows: `patient_identity.reveal` for unmasking an
   identity (`audit-coverage.e2e-spec.ts`) and `patient.profile_view` for the profile bundle
   (`patient.service.ts`). Query
   by actor and window: `GET /api/v1/audit-events?actorId=…&from=…&to=…`. Narrow it further
   with `category`, `severity`, `ip` or `q`.
3. Message content is readable by an administrator only through a justified, expiring grant,
   and every read writes an audit row in the same transaction (ADR-006;
   `messaging-oversight.e2e-spec.ts`). A content view with no audit row should not exist; if
   you find one, it is itself an incident.

## 4. Investigation

### 4.1 From a report to the logs

The `ref` in a 5xx body is the correlation id. Search the log store for `req.id = <ref>`. A
5xx log line carries the error's `type`, its `errorCode` and its stack, but never the
driver's message for a database error, which can quote the row (`error-description.ts`).
Log lines carry no request or response bodies and no query strings (`logger.config.ts`).

### 4.2 The audit ledger

`audit_events` is the record of who did what. It is append-only from the application, and
the database-level grant that would enforce that is open (RA-M28.1). Read it through
`GET /api/v1/audit-events` (keyset pagination, up to 200 a page), one event at
`/audit-events/{eventId}`, and save a selection as an incident bookmark
so the evidence stays together under one reference. Bookmarks are per administrator
(`/me/incident-bookmarks`). Sign-in attempts, successful and failed,
are in `login_events` with address, device and IP.

### 4.3 Preserving evidence

- **Export the relevant audit window** before changing anything:
  `POST /api/v1/audit-events/export` (capability `logs.export`, CSV or JSON, at most 10,000
  rows per export; split a longer window by `from`/`to`). The export itself is audited
  (`admin.audit_export`).
- **Copy the logs** for the window out of the platform's log store. No retention policy is
  configured in this repository (M38.1 open), so how long they survive is the platform's
  default.
- Record the deployed commit and image of every instance.

## 5. Recovery and close-out

1. Undo containment deliberately: reactivate accounts (`{ "active": true }`), turn off
   maintenance mode, and leave rotated secrets rotated.
2. Re-read the audit ledger 48 hours after recovery, for the same actors and for new
   activity from the same IPs (the same check M43.2 asks of a release).
3. Write a post-incident review: timeline, root cause, what the controls did and did not
   do, and the follow-ups. Fixes go through the normal task-branch workflow (`CLAUDE.md`).

## 6. Quick reference

| Need | Control | Who |
|---|---|---|
| Lock one account out | `PATCH /admin/users/{id}` `{active:false}` | Administrator (`roles.manage`) |
| Sign everyone out | `UPDATE sessions …` **and** rotate `JWT_SECRET` | Database operator + deployer |
| Stop non-admin traffic | `PATCH /platform-settings/general` `maintenanceMode: true` | Administrator |
| Throttle sign-in by client | `RATE_LIMIT_ENABLED=true`, after `TRUST_PROXY` is verified | Deployer |
| Find what an account did | `GET /audit-events?actorId=…` | Administrator (`logs.view`) |
| Keep the evidence | `POST /audit-events/export`, incident bookmark | Administrator (`logs.export`) |
| Revoke an API key | `POST /platform-settings/api-keys/{id}/revoke` | Administrator |

## 7. Gaps and decisions this runbook cannot make

| Gap | Effect during an incident | Where it is tracked |
|---|---|---|
| No monitoring, alerting or log retention | An incident is found by a person, not an alert; logs last as long as the platform keeps them | M38.1 |
| No backup automation or restore drill | No tested way to restore data that an incident destroyed or altered | M38.2, RA-M24.2 |
| No bulk second-factor re-enrolment | After the key **and** the database leak, each two-factor account must re-enrol individually (§3.3). Rotating the key alone is supported since 2026-11-06 (`PRODUCTION_SETUP.md` §2.1) | — (not on the roadmap) |
| No route to revoke every session | Platform-wide sign-out needs direct database access (§3.2) | — (not on the roadmap) |
| No bulk forced password reset | After a password-hash leak, each account must be reset individually | — (not on the roadmap) |
| Access tokens are not checked against the database | Up to `JWT_ACCESS_TTL` (≤ 900 s) of access after revocation (§3.1) | Accepted design (`AccessTokenService`) |
| A sole administrator cannot be contained through the API | A compromised sole administrator must be deactivated by direct database access before `admin:bootstrap` will issue a new one (§3.1) | `platform-user.service.ts`, `PRODUCTION_SETUP.md` |
| The ledger's database-level append-only grant | An operator with the application's database role can alter audit rows | RA-M28.1, M37.3 |
| **Owner decisions:** severity levels (§2), who is on call and how they are reached, breach-notification duties and deadlines for the jurisdictions the clinic serves, and who may run the database steps | — | Owner |
