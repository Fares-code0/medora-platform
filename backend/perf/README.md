# `perf/` — load suite and synthetic dataset (RM M32)

Two tools and nothing else:

| Path                  | What it is                                                             |
| --------------------- | ---------------------------------------------------------------------- |
| `dataset/generate.ts` | Fills a **disposable** database with a synthetic clinic (no real data) |
| `k6/medora.js`        | The k6 suite: smoke, load, stress and badge-herd profiles              |

What was measured with them, and on what, is in [`docs/PERFORMANCE.md`](../docs/PERFORMANCE.md).
The nightly run is [`.github/workflows/perf-nightly.yml`](../../.github/workflows/perf-nightly.yml).
Results are written to `perf/results/`, which is git-ignored.

## Never against a real database

The generator refuses, before its first write, any database that

1. is not **named** `medora_perf…` (so `medora_test`, `medora`, `postgres` and any production
   name fail);
2. is reached with `APP_ENV=production`;
3. holds a single user whose email does not end in `@perf.medora.test`;
4. already holds the synthetic dataset (rerun on a fresh database instead).

The k6 suite only signs in as `perf-doctor-NNN@perf.medora.test`, so pointed at any database the
generator did not fill, it fails at `setup()` without writing anything.

## Running it locally

Everything below uses throwaway containers on non-default ports, so nothing collides with a
developer's `docker compose` stack.

```bash
docker run -d --name medora-perf-db -p 55432:5432 -e POSTGRES_USER=perf -e POSTGRES_PASSWORD=perf \
  -e POSTGRES_DB=medora_perf_medium --shm-size=1g postgres:16-alpine \
  -c shared_buffers=1GB -c work_mem=16MB -c max_connections=200
```

```bash
docker run -d --name medora-perf-redis -p 56379:6379 redis:7-alpine
```

Then, from `backend/`, with an env file that points `DATABASE_URL` at
`postgresql://perf:perf@localhost:55432/medora_perf_medium?schema=public`, `REDIS_URL` at
`redis://localhost:56379`, `APP_ENV=staging`, `PORT=3200`, `JOBS_ENABLED=false`, and freshly
generated `JWT_SECRET`, `DATA_ENCRYPTION_KEY` (`openssl rand -base64 32`) and `PERF_PASSWORD`:

```bash
npm run db:deploy && npm run db:seed:production
```

```bash
npx tsx perf/dataset/generate.ts --scale medium
```

```bash
npm run build && node dist/main.js
```

```bash
docker run --rm --network host -u "$(id -u)" -e PERF_PASSWORD \
  -v "$PWD/perf/k6:/scripts:ro" -v "$PWD/perf/results:/out" grafana/k6:1.3.0 \
  run -e PROFILE=load -e RESULTS_DIR=/out /scripts/medora.js
```

`-e PERF_PASSWORD` before the image name is docker's flag: the password reaches k6 through the
environment. Every other `-e` after `run` is k6's.

Clean up only what you created:

```bash
docker rm -f medora-perf-db medora-perf-redis
```

## The dataset

`--scale small | medium | large`, deterministic for a given `PERF_SEED` (default `32`):

|                                              |       small |      medium |       large |
| -------------------------------------------- | ----------: | ----------: | ----------: |
| Doctors                                      |          10 |          40 |         120 |
| Patients                                     |       2,000 |      20,000 |     100,000 |
| Appointments / patient (mean)                |           5 |           6 |           6 |
| Records, prescriptions, lab orders / patient | 2, 1.5, 1.5 | 2, 1.5, 1.5 | 2, 1.5, 1.5 |
| Notifications / doctor                       |       2,000 |       5,000 |       8,000 |
| Conversations × messages                     |    200 × 20 |  2,000 × 20 |  8,000 × 25 |
| Audit events                                 |      20,000 |     300,000 |   1,500,000 |

Medium generates in about three minutes and small in about 20 seconds on a 4-vCPU machine.

**Skewed, not uniform.** Patients are spread across doctors by a power law
(`⌊n^U⌋ − 1`), so a few doctors carry thousands of patients and most carry a few hundred. At
medium: min 150, median 256, max 3,792 primary patients per doctor. 15% of patients also have a
secondary doctor. Appointments run two years back and 60 days ahead, with status following time
(past ones completed, cancelled or no-show; future ones scheduled, confirmed or pending). 85% of
notifications are read, and 30% of those are archived. Prescriptions are drafts exactly when
unsigned. Audit events cover the last 60 days, so they land in both the current month's partition
and `audit_events_default`.

Every doctor shares `PERF_PASSWORD`, hashed once. `perf-doctor-001` also holds a `logs.view`
override, so the suite can page the audit log without enrolling a second factor.

## The k6 suite

| Profile      | Shape                                                                                                                 | Gates                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `smoke`      | 2 readers, 5 badge pollers, 2 dashboard pollers, 1 write/s, 30 s                                                      | Correctness: errors < 1%, checks > 99%. Latency budgets are reported, and enforced only with `STRICT=1` |
| `load`       | 20 readers, 100 badge pollers @ 10–15 s, one dashboard poller per doctor @ 10–15 s, 5 writes/s, 0.5 sign-ins/s, 3 min | Errors and the roadmap's latency budgets                                                                |
| `stress`     | Readers ramp 20 → 40 → 80 over 3 min, then hold for 1 min; the badge herd starts in lockstep; 10 writes/s             | The same: a breach marks the breaking point                                                             |
| `badge-herd` | The herd alone                                                                                                        | Badge budget                                                                                            |

Readers walk the doctor's day: patients (list, search, profile), appointments (list and week),
records, lab orders, prescriptions, notifications, conversations, the formulary and the lab
catalogue. On 20% of iterations the auditor pages three keyset pages of `/audit-events`.
Writes are 50% message sends, 40% notification reads and 10% patient creations.

Configuration, all as `-e NAME=value`:

| Name                                 | Default                        |                                                                    |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------ |
| `BASE_URL`                           | `http://localhost:3200/api/v1` | Never production                                                   |
| `PERF_PASSWORD`                      | _(required)_                   |                                                                    |
| `PROFILE`                            | `smoke`                        |                                                                    |
| `DOCTORS`                            | `40`                           | How many synthetic doctors to sign in (`10` for the small dataset) |
| `VUS`, `DURATION`                    | per profile                    |                                                                    |
| `BADGE_CLIENTS`                      | `100`                          |                                                                    |
| `READ_P95`, `BADGE_P95`, `WRITE_P95` | `200`, `50`, `500`             | ms                                                                 |
| `MAX_ERROR_RATE`                     | `0.01`                         |                                                                    |
| `REQUEST_TIMEOUT`                    | `10s`                          | A timed-out request also counts in `medora_timeouts`               |
| `ACCEPT_ENCODING`                    | `gzip, deflate, br`            | What a browser sends; `identity` measures the uncompressed path    |
| `STAGGER`                            | on (off for `stress`)          | Spread each poller's first poll over its interval                  |
| `STRICT`                             | off                            | Enforce the latency budgets on `smoke` too                         |
| `RESULTS_DIR`                        | `perf/results`                 |                                                                    |

A breached threshold makes k6 exit non-zero (99), which is what fails the nightly workflow.
`summary-<profile>.txt` holds p50, p90, p95, p99, mean and max per request kind and per endpoint;
`summary-<profile>.json` is k6's full summary.
