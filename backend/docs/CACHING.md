# Caching — what is cached, for how long, and what invalidates it (RM M31)

Every cache the API keeps is listed here. A cache that is not in this file is a defect: its
invalidation has not been audited. The specs live in one place in code,
`src/shared/cache/cache.specs.ts`, and modules name them — they declare none of their own.

## The caches

| Cache (metric `cache=`) | What it holds | Scope | TTL | Invalidated by | Code |
|---|---|---|---|---|---|
| `badge-counts` | `GET /notifications/badge-counts` → `{ notifications, messages }` | one per recipient (user id) | **60 s** | every writer of the two counted columns, after its commit — the nine below | `NotificationService.badgeCounts` |
| `reference-data` | The formulary list (`GET /medications`), monographs (`GET /medications/{id}/monograph`), the lab catalogue (`GET /lab-tests/catalogue`), ICD-10 code → id lookups on record writes | one for all of it (`all`) | **1 h** | `db:seed` and `db:seed:production`, on exit — the only writers of these tables | `MedicationService`, `LabTestService`, `RecordRepository.icdCodeIdsByCode` |
| `doctor-dashboard` | Nothing is stored. `GET /dashboard/doctor` is **coalesced**: concurrent requests for one authorization scope share one computation | user id + role + capabilities, hashed | — | — (nothing outlives the request) | `DashboardService.overview` |
| Permission cache | A user's effective capabilities | one per user | 5 min | the roles-matrix and override writes (M7.4) | `shared/authz/redis-permission-cache.ts` (M7.1) |

Not cached, on purpose:

- **The safety screen** (`POST /prescriptions/safety-check` and the re-check inside `/sign`)
  reads medications, allergy classes and interactions straight from the database. A check that
  blocks a prescription must see the formulary as it is.
- **Sessions.** Since PRE-01 `AccessTokenGuard` reads the session row on every protected
  request (`SessionService.isActive`: one primary-key read that also checks `revoked_at`,
  `expires_at` and that the account is `ACTIVE` and not deleted). That read is deliberately
  **not** cached: owner decision I2 makes PostgreSQL the source of truth for session state, and
  a cache would need the staleness bound C-12, which is still open. Revocation therefore takes
  effect on the next request (O-13).
- **Rate-limit counters** are already one Redis fixed window per client address
  (`shared/rate-limit`, M37.2). Per-account lockout stays in `user_credentials` (ADR-025).
- **`GET /meta/enums`** reads PostgreSQL enum types, which change only with a migration.

## Badge writers — the complete list

The badge is computed from two columns, and every write to either bumps the affected badges
after it commits. Each is a repository method, so no caller can skip it.

| # | Writer | Changes | Badges bumped |
|---|---|---|---|
| 1 | `NotificationDispatchService.write` | a new notification | its recipient |
| 2 | `NotificationRepository.setRead` (read / unread) | `read_at` | the recipient |
| 3 | `NotificationRepository.markAllRead` | `read_at` | the recipient |
| 4 | `NotificationRepository.setFlag` (archive, favorite, pin) | `archived` | the recipient |
| 5 | `NotificationRepository.archiveAllRead` (clear-read) | `archived` | the recipient |
| 6 | `ConversationRepository.create` | new participant rows | every participant |
| 7 | `ConversationRepository.patchState` (archive and the folder flags) | `archived` | the participant |
| 8 | `MessageRepository.send` | others' `unread_count` | every other participant, read in the send's transaction |
| 9 | `MessageRepository.markRead` | own `unread_count` | the reader |

A write that matched no row bumps nothing. The only other way these rows change is the
`ON DELETE CASCADE` from `users`, which removes the badge's owner with it. **A write made outside
these methods** — a script, a migration, a test fixture — must call
`CacheService.invalidate(BADGE_COUNTS, [userId…])` itself, or the badge is wrong for up to the TTL.

`test/badge-cache.e2e-spec.ts` primes the cache before each writer and asserts the badge moves
at once; with the invalidations removed, the writer cases fail.

## The consistency model — versions, not deletes

Delete-on-write has a race that serves stale data until the TTL. A reader misses and loads the
old value; a writer commits and deletes the key; the reader then stores the old value. The kernel
avoids it with **versions**:

- every scope has a version key (`medora:cache:<cache>:v:<scope>`);
- an entry (`medora:cache:<cache>:e:<scope>:<key>`) is stored as `{ v, d }`;
- a read fetches the entry and the version in one `MGET`, and an entry is a hit only when its `v`
  is the current version;
- a miss loads, then stores under the version it read **before** loading;
- a writer `INCR`s the version **after** its transaction commits.

A load that began before a commit is stored under a version the bump has already left behind, so
no reader accepts it. The version key is extended past every entry written under it (twice the
TTL), so it never expires while an entry that could match a recreated version still exists.

**Single-flight.** Concurrent misses for one entry share one load. The flight is keyed by entry
*and observed version*, so a caller that has just written — and so sees the newer version — never
joins a load that started before its write.

## Failure behaviour

| Failure | What happens | Counted as |
|---|---|---|
| Redis unreachable on a read | the database answers; the request does not wait (no offline queue, 250 ms command timeout) | `error` |
| Redis fails a write | the value is returned, not stored | `error` |
| Redis fails a bump | the write it follows has already committed and succeeds. **The one case that can serve stale data**, bounded by the cache's TTL (badge 60 s, reference 1 h), and logged | `invalidation_error` |
| The seed cannot reach Redis | **the seed exits 1**: the database holds the new content and the caches the old, so it must be rerun | — |
| The seed runs without `REDIS_URL` | it says so, and the reference entries expire within 1 h | — |

`test/cache-unavailable.e2e-spec.ts` boots the application with a backend that rejects every
command. The badge, reference data and the Overview answer from the database, a write succeeds
though its invalidation fails, and the outage is counted.

## Metrics

`GET /api/v1/metrics` (M38.1) includes:

```text
# TYPE medora_cache_requests_total counter
medora_cache_requests_total{cache="badge-counts",result="hit"} …
medora_cache_requests_total{cache="badge-counts",result="miss"} …
medora_cache_requests_total{cache="doctor-dashboard",result="coalesced"} …
```

`result` is one of `hit`, `miss`, `coalesced`, `error` and `invalidation_error`. The hit rate is
`hit / (hit + miss)` per `cache`, computed in the scraper. The counters are per instance, like
every other series there. **Labels are cache names and outcomes only**, never a key, a scope or a
value: a badge scope is a user id, and a badge count is a person's inbox. `test/metrics.e2e-spec.ts`
asserts the counters move and that the scrape contains neither the user's id nor their handle.

The permission cache (M7.1) predates the kernel and is not counted here.

## Redis

One Redis on `REDIS_URL` serves the permission cache (`medora:authz:permissions:`), this kernel
(`medora:cache:`), the rate limiter (`medora:ratelimit:`), BullMQ (`bull:`) and the health probe. Each holds its own
connection, so a slow consumer on one does not queue another's commands.
