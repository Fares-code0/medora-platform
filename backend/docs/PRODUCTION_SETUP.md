# Production setup — database, first administrator, credential rotation

**Scope.** What a new production deployment of the backend needs, in order, before anyone
can sign in, and which credentials must be rotated and how. RM **M38.4**.

> **Nothing in this file has been run against a production environment.** Every command
> below was verified against a freshly created, empty PostgreSQL 16 database on
> 2026-10-30 (`test/admin-bootstrap.e2e-spec.ts`, plus the compiled command run by
> hand — see *Evidence*). Running it in production needs the owner's authorization and a
> production environment, neither of which this repository has.

---

## 1. Order of operations

| # | Step | Command | Where it runs |
|---|---|---|---|
| 1 | Apply migrations | `npm run db:deploy` | A checkout with dev dependencies (the CI job or an operator machine), `DATABASE_URL` → production |
| 2 | Reference data | `npm run db:seed:production` | Same, with the deployment's `REDIS_URL` too: the seed invalidates the API's reference-data caches on exit and **exits 1 if it cannot** (RM M31.1, `docs/CACHING.md`) |
| 3 | Start the API | `node dist/main.js` (the image's `CMD`) | The production image. Boot refuses `APP_ENV=production` without `CLAMAV_HOST`: a clamd the API can reach on `CLAMAV_PORT` (3310), whose `StreamMaxLength` is at least 25 MB (the largest upload limit). Without one no upload could ever be downloaded (M25.3, `docs/EXTERNAL_INTEGRATIONS.md`) |
| 4 | First administrator | `npm run admin:bootstrap -- --email <address> --confirm` | Anywhere with the deployment's full environment and the build — inside the production image is the intended place |
| 5 | The invitee completes it | Opens the link, sets a password, enrols an authenticator app, signs in | Their browser |

Steps 1 and 2 need `prisma/`, which the production image does not contain (`Dockerfile`
copies `dist/`, `node_modules/` and `package.json` only). That is the existing arrangement
for migrations, not something this file introduces.

### Step 2 — `db:seed:production`

Creates the permissions, roles and role bundles, the departments and other vocabularies,
the lab, medication and AI-prompt catalogues, and the eleven platform-settings slices.

- **No account and no credential of any kind.** The demo layer (`prisma/seed/demo.ts`) is
  not imported by `prisma/seed/production.ts`, so no demo patient, doctor or administrator
  can reach the database through it, whatever `APP_ENV` says.
- **Create-only.** A row that exists is left exactly as it is (`prisma/seed/seed-mode.ts`):
  a role an administrator renamed, a catalogue entry they corrected and a settings slice
  they edited all survive a rerun. A grant an administrator revoked stays revoked
  (`prisma/seed/reference-data.ts`). Rerun it after a release that adds a role, a
  capability or a catalogue entry; it adds those and changes nothing else.
- `npm run db:seed` still **refuses** `APP_ENV=production`, because it carries the demo
  layer. The two are separate entry points on purpose.

### Step 4 — `admin:bootstrap`

ADR-035 closed public administrator registration and recorded the consequence: *"The first
administrator of a deployment must be seeded, because every route that creates one requires
one … a bootstrap endpoint would be the hole this ADR closes, reopened under another name."*
This command is that seeding. It is **not an HTTP route**; it needs a shell with the
deployment's environment.

What it does: issues **one ordinary administrator invitation** with no sender
(`admin_invitations.invited_by` NULL), valid once for seven days (ADR-035 §5), and mails it
to `--email`. The invitee then goes through the same two phases every invited administrator
does — set a password (phase 1, account INACTIVE), prove a TOTP code (phase 2, account
ACTIVE). The command never writes a password, a credential or an ACTIVE status, so
ADR-035's invariant — *the only code path that makes an administrator ACTIVE is the one that
just verified a second factor* — is unchanged.

| Situation | Result | Exit |
|---|---|---|
| No `--confirm` | Explains itself, does nothing | 2 |
| Bad or missing `--email`, unknown flag | Usage, does nothing | 2 |
| Roles not seeded (step 2 skipped) | `Refused (roles_not_seeded)` | 1 |
| **Any** administrator account exists, in any status | `Refused (administrator_exists)` — later administrators are invited from the Administration Center (ADR-017 §3) | 1 |
| The address already has an account | `Refused (email_taken)` | 1 |
| None of the above | One invitation issued, earlier unaccepted ones for that address revoked, one audit row (`admin.invitation_created`, system actor, `bootstrap: true`) | 0 |

Options:

- `--print-link` — print the acceptance link instead of mailing it, for a deployment whose
  mail is not working yet. **The link is a credential**: whoever opens it first can set the
  password and enrol their own authenticator. Do not use it where output is captured (CI
  logs, shared terminals, shell history of a shared account). Prefer the default, which also
  proves the invitee controls the address.
- `--reissue` — first removes an earlier bootstrap that was **accepted but never completed**:
  an INACTIVE administrator account, created by a sender-less invitation, that never proved
  a second factor and so never signed in. Without it, an invitee who set a password and
  abandoned the TOTP step would leave the deployment with no administrator and no way to
  make one. It removes nothing else: an administrator of any other shape still refuses.

It runs from the **build**: `npm run admin:bootstrap` is `node dist/cli/bootstrap-admin.js`.
Nest's dependency injection needs the decorator metadata `tsc` emits; running the source
with `tsx` fails at boot.

### If a bootstrap link leaks

There is no API route that revokes an invitation. Before it is accepted, either:

- rerun `admin:bootstrap` for the **same address** — issuing supersedes every unaccepted
  invitation for it; or
- `UPDATE admin_invitations SET revoked_at = now() WHERE invited_by IS NULL AND accepted_at IS NULL;`

If it was accepted by someone else, the account is INACTIVE until a TOTP code is proved;
`--reissue` removes it. If it was **completed** by someone else, that is an administrator
account in the wrong hands: deactivate it from the database
(`UPDATE users SET status = 'inactive' WHERE email = '<address>';`), revoke its sessions
(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = '<address>');`),
treat it as an incident (M37.4), and bootstrap again with `--reissue` only if no other
administrator exists.

---

## 2. Credentials and their rotation

| Credential | Where | Rotation | What rotating it does |
|---|---|---|---|
| **First administrator's password** | `user_credentials.password_hash` (Argon2id) | The invitee sets it; change it from Settings → Security (`/me/password`). The platform's expiry policy is `SECURITY_PASSWORD_EXPIRY_DAYS` (default 180) under the security slice | Changing it revokes every other session of that account |
| **First administrator's second factor** | `user_credentials.totp_secret_enc`, recovery codes `recovery_codes_enc` (AES-256-GCM under `DATA_ENCRYPTION_KEY`) | Shown once at phase 1. Store the recovery codes offline | — |
| **Bootstrap invitation link** | `admin_invitations.token_hash` (SHA-256; the raw token exists only in the mail or the printed output) | Single use, seven days. Superseded by reissuing; see *If a bootstrap link leaks* | — |
| `JWT_SECRET` | Environment (≥ 32 characters; production refuses the example placeholder) | Rotate on a schedule and on suspicion. Generate with `openssl rand -base64 48` | Every **access token** signed with the old value is refused at once. Refresh tokens are opaque random values stored hashed, not JWTs, so sessions continue: the next refresh mints an access token under the new key. Rotate on every instance at once |
| `DATA_ENCRYPTION_KEY` | Environment (base64 of exactly 32 bytes) | **Rotate with the procedure in §2.1**, never by replacing the value alone. Generate with `openssl rand -base64 32` | Encrypts every stored TOTP secret, recovery-code set and integration credential. Replacing it without §2.1 makes all of them undecryptable: every account with two-factor authentication — every administrator — is locked out. With §2.1 there is no lockout window |
| Database, SMTP, S3, Redis credentials | Environment | Per provider | Restart the API with the new values |

Generate secrets on the deployment's own machine, never commit them, and never reuse the
development or `.env.example` values — production boot refuses the example placeholders
(`env.schema.ts`, `productionRules`).

### 2.1 Rotating `DATA_ENCRYPTION_KEY`

The envelope service holds a keyring (`shared/crypto/envelope.service.ts`). The current key
is the only one that encrypts. The keys in `DATA_ENCRYPTION_KEY_PREVIOUS` may decrypt. GCM
authentication decides which key opens a value, so nothing is guessed. Two envelope layouts
are always **read**: the legacy one every earlier build uses, and a keyed one that names its
key. `DATA_ENCRYPTION_WRITE_FORMAT` decides which one is **written**.

#### Before any rotation: the two-phase rollout of this build

A build from before the keyring reads only the legacy layout, under one key. If it meets a
keyed envelope, that user's second factor fails on it.

- **Phase 1, the default (`DATA_ENCRYPTION_WRITE_FORMAT=legacy`).** Deploy this build. It
  reads both layouts and writes only legacy, so a rolling deploy is safe, and so is a
  rollback to an earlier build that has the same `DATA_ENCRYPTION_KEY`.
- **Phase 2 (`keyed`), optional and explicit.** Set this only once no earlier build will
  serve again. The keyed layout is not needed for rotation; it only names the key.
- **Leaving phase 2.** Set `legacy` on every instance, then run
  `npm run crypto:reencrypt -- --confirm` until it exits 0. Every keyed envelope is rewritten
  into the legacy layout. Only then deploy an earlier build.

Rotate only while **every** instance runs this build or later: an earlier build ignores
`DATA_ENCRYPTION_KEY_PREVIOUS`.

#### The rotation, safe under a rolling restart

Each step is one configuration change rolled out to every instance, and the next step starts
only when the rollout is finished. At every moment, every instance can read what every other
instance writes. The old instruction, "deploy with both keys on every instance at once", left a
window: an instance not yet restarted held only the old key and could not read what restarted
instances wrote.

| Step | `DATA_ENCRYPTION_KEY` | `DATA_ENCRYPTION_KEY_PREVIOUS` | Why it is safe mid-rollout |
|---|---|---|---|
| 0. Generate | — | — | `openssl rand -base64 32` → K2 (old key: K1) |
| 1. Pre-stage | K1 | K2 | Everyone still writes K1; K2 is only *accepted* |
| 2. Swap | K2 | K1 | Instances on step 1 read K2 (pre-staged); instances on step 2 read K1 |
| 3. Preview | — | — | `npm run crypto:reencrypt -- --dry-run`. Writes nothing |
| 4. Re-seal | — | — | `npm run crypto:reencrypt -- --confirm` until **exit 0** |
| 5. Retire | K2 | *(empty)* | Only when every precondition below holds |

#### Before step 5: the retirement preconditions (R1)

A clean `--confirm` (exit 0) is a **point-in-time** result. It means every envelope conformed
when its verification pass read it. It cannot see a write made after the pass read a row,
and it does not prevent future stale writes. The review reproduced exactly that: a K1 write
landed after verification and the run still exited 0. So the command's exit 0 is one
precondition for step 5, never permission on its own. **All** of these must hold:

1. **Before the verifying `--confirm` run started**, every process that writes envelopes was
   on step 2's configuration (K2 current, this build or later), and every old instance had
   **drained**, not just been told to stop. That covers:
   - API replicas, including canaries and blue/green standbys;
   - background workers and scheduled jobs;
   - autoscaling groups and launch templates;
   - old task definitions, deployments or images that an orchestrator could start again;
   - other regions or clusters on the same database;
   - one-off scripts and anything else that writes envelopes.

   The run prints its start time. That instant is the one that matters.
2. Nothing configured with K1 as current can start again. Remove or update every template
   and definition in the list above, not just the running instances.
3. The verifying `--confirm` run exited **0**, and the ledger holds both its
   `reencrypt_started` and its `reencrypted (complete)` rows (`--status` shows them). A dry
   run never counts.
4. **In-flight re-enrolment tokens have expired.** `POST /me/2fa/reenroll` returns an
   enrolment token that carries the new TOTP secret sealed under the key that was current
   when it was issued. The token is valid for **ten minutes**
   (`OTP_CHALLENGE_TTL_SECONDS = 10 * 60`, `otp-challenge.service.ts`; signed in
   `two-factor.service.ts`). Such a token lives in the user's client, not in the database,
   so no scan sees it. Retire K1 only when at least ten minutes have passed since the last
   instance that could seal with K1 drained. A token sealed under K1 and confirmed after
   K1 is gone cannot be opened, and that user has to start re-enrolment again.
5. **Keep K1 offline after retirement.** If a stale write slipped through despite (1)–(2),
   K1 is the only way to read that row, and the rollback table below assumes it is still
   held.

If any of these is uncertain, fix it and run `--confirm` again. A clean run that started
after the fix is what counts.

Boot refuses a previous key equal to the current one, a repeated entry, and an entry that is
not base64 for 32 bytes.

#### What the command checks before it exits 0

`--confirm` makes two passes:

- **Re-seal pass.** Every value is rewritten with a compare-and-set on the bytes it read.
  The compare-and-set runs **on the advisory lock's own database session, and is guarded
  in the same statement**: the UPDATE runs only if that exact server backend still holds the
  lock. When the compare-and-set loses, the row is **re-read and classified**:
  - removed concurrently: the row is gone, or its value was cleared;
  - rewritten concurrently (current): another instance wrote a value that already conforms;
  - unreadable: no configured key opens it;
  - a **stale concurrent write**: a readable value still under an old key or in the other
    format. The row is retried. A stale write means some instance still runs an old
    configuration, so the run can never count as clean.
- **Verification pass.** A read-only pass over every column starts only after every write of
  this run. Pages advance on the query that drives them, and a walk stops only when that
  query returns nothing.

Exit codes:

| Code | Meaning | What to do |
|---|---|---|
| **0** | `--confirm`: the verification pass found every value conforming (current key, configured format), no stale writer was seen, and both audit rows were written. **Point-in-time** — see the preconditions above | Step 5 only if every precondition holds |
| 1 | Values remain, a stale writer was seen, or the run failed part-way. Everything re-sealed so far stays readable | Fix the cause it names, then rerun |
| 2 | Usage error; nothing was done | — |
| 3 | Another re-encryption holds the lock (PostgreSQL advisory lock); nothing was done | Wait for it to finish (`--status`) |
| 4 | The audit ledger could not record the run. If the start could not be recorded, nothing was written. If the outcome could not be recorded, the rewrites stand but are unverified on record | Restore the ledger, then rerun |
| 5 | Stopped by SIGTERM or SIGINT, between rows. The outcome is recorded as `reencrypt_failed` with status `interrupted` and its counts, where the ledger allowed it | Rerun |
| 6 | The connection behaves like a transaction-mode pooler; nothing was done | Use a direct or session-mode `DATABASE_URL` |

**A dry run never authorizes retiring a key (R4).** It exits 0 when its own read-only pass
found every value conforming, writes nothing, is not audited, and tells you to run `--confirm`
once the preconditions hold.

`npm run crypto:reencrypt -- --status` lists recent runs from the ledger. It pairs each
`reencrypt_started` row with its outcome by `runId`, and names the run that holds the lock
right now. The lock session announces its run id and mode (`confirm` or `dry-run`) in its
`application_name`, before it takes the lock, and `--status` reads it from
`pg_stat_activity`. The newest `started` row is never assumed to be the lock holder: a dry
run writes no `started` row, and a confirm run holds the lock briefly before writing it. A
holder that does not identify itself is assumed to be none of the listed runs. A run that
started and never recorded an outcome stays listed permanently; the ledger is append-only.
It makes `--status` exit 1 only until a later run completes, because that run's
verification pass has re-read every value since.

#### Locking, connections and timeouts (R2, R3, R8)

- **One at a time; no write after the lock is lost.** Every run, dry runs included, holds a
  session advisory lock on one dedicated connection, and every envelope write runs on that
  connection. A session lock is lost only when its session ends, and then there is no session
  left to write through. Each write is also guarded in-statement by the lock and the exact
  backend pid. So once the lock is gone, the run writes nothing more and stops (exit 1). A
  successor that takes the lock meanwhile cannot overlap it. A crash releases the lock with
  the session.
- **Connection poolers.** Use a **direct connection or a session-mode pooler** for this
  command's `DATABASE_URL`.
  - **Transaction-mode pooling is detected and refused** (exit 6) when the connection shows
    any of three signs:
    - consecutive statements land on different server backends;
    - a fresh connection already holds the lock;
    - a later connection is handed the lock holder's backend.
  - **Detection is best effort.** A pooler that keeps giving this session the same backend can
    pass it. Such a run is still safe, because every write is admitted only on the backend
    that took the lock and any change of backend stops the run. But it is not supported.
  - **Verified 2026-11-07 against a local PgBouncer 1.22**, in transaction mode and session
    mode. Transaction mode: every run refused, nothing written, no lock left behind. Session
    mode: runs completed, and a concurrent second run got exit 3.
  - **Orphaned locks.** When a refusal cannot undo a lock it took through a pooler, the error
    names the server backend pid that keeps it. End that backend with
    `SELECT pg_terminate_backend(<pid>)`, or let the pooler recycle the connection.
- **Timeouts.** The lock connection is bounded:
  - connect 10 s;
  - client-side query timeout 30 s;
  - server `statement_timeout` 25 s;
  - server `lock_timeout` 10 s, so a write waits that long on a row live traffic holds;
  - TCP keepalive after 10 s idle;
  - a bounded close.

  Any timeout or failure on the lock connection stops the run (fail closed) and closes the
  connection, which ends the session and its lock. A blackholed network ends the lock only
  when the server's own TCP keepalive gives up; until then new runs are refused, which is the
  safe direction.

#### Audit trail, interrupts and partial counts (R5, R6, R7)

- **The rows.** A real run writes `encryption_key.reencrypt_started` before its first write,
  and refuses to start if that row cannot be written. Then it writes one outcome row:
  - `encryption_key.reencrypted`: `status` `complete` or `incomplete`, with every count;
  - or `encryption_key.reencrypt_failed`: `status` `failed` or `interrupted`, with every
    counter (scanned, already current, re-sealed, rewritten concurrently, removed
    concurrently, stale writes, unreadable, unresolved) and the error's class.

  All three are security warnings, keyed by the current key's fingerprint and sharing a
  `runId`. They go through the strict ledger writer, so the command reports whether each row
  was actually written.
- **Interrupts.** SIGTERM or SIGINT stops the run before its next write and records the
  outcome. A second signal, or 60 s without stopping, exits at once. **SIGKILL, power loss and
  machine failure cannot record anything**: that run keeps only its `started` row, which
  `--status` lists as having no outcome. Its rewrites stand and stay readable, and the next
  run counts them as already current.
- **Lower bounds.** A write whose connection failed before it was acknowledged may still have
  committed: a statement abandoned by a client-side timeout can commit later, once live
  traffic releases the row. Such writes are counted as `uncertainWrites`, the failure record
  sets `countsAreLowerBounds: true`, and the command reports "at least N re-sealed". A
  write is counted as **definitely unwritten** only on reliable evidence that PostgreSQL
  rejected it before commit: an error response with severity `ERROR` and a SQLSTATE outside
  classes `08` and `57`, for example `55P03` from `lock_timeout`. All of these count as
  uncertain:
  - `FATAL` and `PANIC`, since a termination can arrive after the commit;
  - SQLSTATE class `08`, connection exceptions;
  - SQLSTATE class `57`, operator intervention, including `57014` from `statement_timeout`,
    so a timed-out write is over-reported as uncertain rather than reasoned about;
  - a failure with no server response;
  - a severity that is not the literal `ERROR`. The driver exposes only the localized
    severity, so on a server with translated messages every error counts as uncertain.

  The FATAL-after-commit ordering is handled conservatively, not reproduced: the tests
  classify each kind of failure, but no test times a termination to land after a commit.
- **Durability (R7, documented, not changed).** "Recorded" means PostgreSQL acknowledged the
  commit. With `synchronous_commit = off`, or an asynchronous replica promoted after a crash,
  an acknowledged row can still be lost. Run rotations on a primary with synchronous commit.

#### Rollback

Never roll back by putting the old value back into `DATA_ENCRYPTION_KEY` alone. Values
already re-sealed under K2 would open under no configured key. A rollback is the same
procedure in reverse, and every state it passes through is readable:

| Situation | Set | Then |
|---|---|---|
| During or after step 2, before step 4 | K1 current, K2 previous (back to step 1) | Run `--confirm` until exit 0: it re-seals anything already written under K2 back to K1. Then empty the previous key |
| After a partial or completed step 4 | K1 current, K2 previous | The same. Every value opens under one of the two keys. Re-seal until exit 0, then retire K2 |
| After step 5 (K1 already retired) | K1 current, K2 previous, provided K1 is still held | As above. If K1 was destroyed, there is nothing to roll back to: stay on K2 |
| Code rollback to a build before the keyring | All values legacy (phase 1, or leave phase 2 as above) **and** no rotation in progress: one key, the earlier build's | A `--confirm` exit 0 with no previous key configured shows it at that moment (point-in-time; stop any keyed writer first) |

**Unreadable values** (opened by no configured key) are never overwritten, and their row ids
are printed. One usually means a key that was rotated away without step 4. Find that key
before you drop anything, because it may be the only way to read them. If no key can read
them, the account's second factor has to be cleared and enrolled again. Both self-service
routes need a signed-in session, which an unreadable factor prevents (`/me/2fa/disable` is
also refused to administrators, ADR-035 §7), and **no administrator route clears another
account's factor today**. That leaves direct database access, doing what `/me/2fa/disable`
does: `users.two_factor_enabled = false`, both `user_credentials` envelope columns `NULL`,
the account's sessions revoked. The user then enrols afresh. For an **administrator** that
state is refused at sign-in (`two_factor_required`, ADR-035 §7) and there is no supported
way back today. That is an open gap, not a procedure, so escalate to the owner.

**After a leak, rotation is not enough on its own.** Re-sealing protects the *same* secrets
under a new key. If only the key leaked, that is the containment. If the database leaked as
well, the TOTP secrets and recovery-code digests must be treated as disclosed: users
re-enrol and receive new recovery codes (`INCIDENT_RESPONSE.md` §3.3).

The column list is in `EnvelopeReencryptionService`, and
`test/envelope-key-rotation.e2e-spec.ts` fails if the schema gains a `bytea` column that the
list does not cover. The regressions for the review's findings F1–F7 are in
`test/envelope-key-rotation-hardening.e2e-spec.ts`.

---

## Evidence

- `test/admin-bootstrap.e2e-spec.ts` — 7 cases on a database created empty for the file:
  usage without `--confirm`; refusal before roles exist; `seedProduction` creates roles and
  catalogues and **zero** users and credentials; a rerun keeps an administrator's role
  rename; a mailed invitation with no sender and a system-actor audit row; an accepted but
  abandoned bootstrap blocks a new one, and `--reissue` removes exactly it; the printed link
  completes through accept → login refused → activate → TOTP sign-in as `admin` holding
  `roles.manage`; a second bootstrap is refused once an administrator exists, `--reissue`
  included.
- The **compiled** command (`node dist/cli/bootstrap-admin.js`) and `npm run
  db:seed:production`, run by hand against a scratch database on 2026-10-30 with
  `.env.example`'s values: no `--confirm` → exit 2; unseeded → `Refused (roles_not_seeded)`,
  exit 1; production seed → "No account was created", 0 users; bootstrap with
  `--print-link` → one invitation, `invited_by` NULL, exit 0.
- **Not exercised:** mail delivery through a real SMTP provider (the e2e uses the suite's
  SMTP sink), and any of this under `APP_ENV=production` against a production database.
