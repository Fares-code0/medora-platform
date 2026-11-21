# Rate limiting and the trusted proxy

**Status: implemented and tested in the API; production IP-based behaviour is PENDING
deployment-proxy verification.** The limit ships **disabled** (`RATE_LIMIT_ENABLED=false`)
and the API trusts **no** forwarded header (`TRUST_PROXY` empty) until someone who knows the
production network sets both. RM M37.2 ("rate-limit bypass"), M31.1 ("unified rate-limit
counters").

## What exists

| Control | Keyed on | Store | Always on? |
|---|---|---|---|
| Login lockout (`SECURITY_LOGIN_ATTEMPT_LIMIT`, `SECURITY_LOCKOUT_MINUTES`) | the account | PostgreSQL | Yes |
| OTP attempt cap and resend cooldown | the challenge / the account | PostgreSQL | Yes |
| Reset-password and verification mail cooldowns (sent nothing, still 202) | the address | PostgreSQL | Yes |
| **Per-client limit** (this document) | `req.ip` | Redis | **No — `RATE_LIMIT_ENABLED`** |

The per-account controls stop one account being guessed. The per-client limit is what stops
one client trying **many** accounts (credential stuffing), spamming registration, or cycling
OTP codes across challenges. It covers, as one shared allowance per client address:

`POST /auth/register`, `/auth/login`, `/auth/otp/verify`, `/auth/otp/recovery`, `/auth/otp/resend`,
`/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`,
`/auth/verification/resend`, `/auth/admin-invitations/accept`, `/auth/admin-invitations/activate`.

Not covered, deliberately: `/auth/refresh` (bound to a token the client already holds, and
called routinely by the web client) and every authenticated route.

Past the limit the API answers **429 `rate_limited`** with `Retry-After` (seconds until the
window resets), in the API §0.3 envelope. A fixed window per client: the first request starts
it and further traffic cannot extend it (`INCR` + `EXPIRE … NX`).

If Redis is unreachable the limit **lets requests through** and logs the outage once. Failing
closed would turn a Redis outage into a sign-in outage; the per-account controls above do not
depend on Redis.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `TRUST_PROXY` | *(empty)* — trust nothing | Which hops' `X-Forwarded-For` to believe. See below. `true` is **refused at boot** |
| `RATE_LIMIT_ENABLED` | `false` | Turns the per-client limit on |
| `RATE_LIMIT_AUTH_MAX` | `20` | Requests per window per client address, across the routes above |
| `RATE_LIMIT_AUTH_WINDOW_SECONDS` | `60` | Window length |

The numbers are **guardrails, not product rules** — no document states them, the same footing
as the upload limits in `file-policy.ts`. Twenty a minute is well above what one person signing
in, verifying and recovering needs (a handful of requests) and far below a stuffing run.

## `TRUST_PROXY` — what the deployment must establish

`req.ip` feeds the audit rows' `ip_address`, `login_events`, and this limit. Express derives
it from `X-Forwarded-For` **only for hops `TRUST_PROXY` names**; otherwise it is the TCP peer.
The header is written by whoever sends the request, so trusting it from an untrusted hop lets
a client choose its own address — a forged audit trail, and a limit bypassed by rotating one
header.

| Value | Use when | Effect |
|---|---|---|
| empty / `false` | Clients connect to the API directly | `req.ip` = the client. Forwarded headers ignored |
| `1` (a hop count) | Exactly one proxy, which **always overwrites or appends** to `X-Forwarded-For`, and the API is **not reachable except through it** | The right-most entry is the client |
| `10.0.0.0/8`, `loopback`, … (a list) | The proxies' addresses are known | Each trusted hop is peeled off; the first untrusted one is the client. Safest when it can be stated |

**Before enabling the limit in production, verify — on the real deployment — and record:**

1. What sits in front of the API (load balancer, ingress, CDN), how many hops, and their
   source addresses or ranges.
2. That the edge proxy **overwrites or appends** `X-Forwarded-For` rather than passing a
   client's value through untouched.
3. That the API's port is **not reachable around the proxy** (security group, network
   policy). If it is, a hop count is spoofable — use the address list form.
4. Then set `TRUST_PROXY`, deploy, and confirm from outside: a request's audit row shows the
   real client address, and two clients behind the same proxy are counted separately.
5. Only then set `RATE_LIMIT_ENABLED=true`. At boot the API logs the limit, and **warns** if
   it is on while `TRUST_PROXY` is unset (correct only with no proxy in front).

With the limit on and `TRUST_PROXY` unset behind a load balancer, every client is the load
balancer: one shared allowance of twenty requests a minute for the whole clinic. That is the
failure the disabled default prevents.

## Verification

| What | How | Result |
|---|---|---|
| `TRUST_PROXY` parsing, `true` refused | `src/config/trust-proxy.spec.ts` | Passing |
| Guard: no bucket / disabled / under / over / counter down | `src/shared/rate-limit/rate-limit.guard.spec.ts` (fake counter) | Passing |
| Counter: shared across instances, window not extended, expiry, unreachable Redis answers at once | `src/shared/rate-limit/redis-rate-limiter.spec.ts` — **needs Redis** (`REDIS_URL`; CI runs `redis:7-alpine`) | Passing |
| Over HTTP: 429 + `Retry-After`; one allowance across routes; **forged `X-Forwarded-For` ignored by default**; `/health` and `/auth/refresh` not limited; with a trusted proxy, clients counted separately and a forged left-hand entry changes nothing | `test/rate-limit.e2e-spec.ts` — needs PostgreSQL and Redis | Passing |
| **The production proxy's real `X-Forwarded-For` behaviour** | Only on the deployment, per the checklist above | **NOT VERIFIED — pending** |
