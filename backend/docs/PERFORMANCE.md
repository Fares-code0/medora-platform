# Performance — baseline, budgets, compression and the index review (RM M32)

Every number here was measured and is reproducible with `perf/` (see `perf/README.md`). An
estimate is labelled as one. **No measurement here was taken on production hardware, against
production data, or against the project's real database.** All of it ran on a disposable
PostgreSQL filled with the synthetic dataset.

Measured 2026-11-05.

## 1. Where it was measured

|                |                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine        | 4 vCPU Intel Xeon @ 2.10 GHz, 15 GB RAM, one Linux container                                                                                                     |
| API            | One `node dist/main.js` process (production build), Node 22.23.4 (CI runs 20), `APP_ENV=staging`, JSON request logs on, `JOBS_ENABLED=false`                     |
| PostgreSQL     | 16.15 (`postgres:16-alpine`) in Docker, `shared_buffers=1GB`, `work_mem=16MB`, `max_connections=200`. Database `medora_perf_medium`, created empty for this work |
| Redis          | 7 (`redis:7-alpine`), a container of its own                                                                                                                     |
| Prisma pool    | `@prisma/adapter-pg` with no pool options, so node-postgres's default of **10 connections**                                                                      |
| Load generator | k6 1.3.0 (`grafana/k6:1.3.0`), `--network host`, **on the same 4 vCPUs**                                                                                         |
| Network        | Loopback. No TLS and no proxy, so transfer time is near zero                                                                                                     |

Two consequences shape every result below:

- **k6 shares the CPUs with the system under test.** Under the stress profile it competes with
  the API and PostgreSQL. The load-profile numbers are less affected: total CPU there stayed
  under about 60% of the machine.
- **Loopback hides transfer time.** Byte savings from compression show up as bytes, not as
  latency (§5).

## 2. The dataset

`generate.ts --scale medium`, `PERF_SEED=32`. It took 3 minutes to generate, and the database
was 315 MB after `ANALYZE`.

| Table                    |                                                                                                         Rows |
| ------------------------ | -----------------------------------------------------------------------------------------------------------: |
| Doctors                  |                                                                                                           40 |
| Patients                 |                                                                                                       20,000 |
| Care assignments         |                                                                                                       22,890 |
| Appointments             | 119,475: completed 79,889, cancelled 19,712, no-show 10,994, scheduled 4,045, confirmed 3,066, pending 1,769 |
| Medical records          |                                                                                                       39,999 |
| Prescriptions            |                                                                                                       29,036 |
| Lab orders               |                                                                                                       29,591 |
| Notifications            |                                                                        196,000 (unread per doctor 393–1,934) |
| Conversations / messages |                                                                                               2,000 / 39,578 |
| Audit events             |                  300,000: 276,911 in `audit_events_default` (older months), 23,089 in `audit_events_2026_11` |

Primary patients per doctor: min 150, median 256, **max 3,792**. The skew is deliberate (§2 of
`perf/README.md`): a scope query is only interesting at the heavy end.

## 3. Baseline (before any M32 change)

The `load` profile, 3 minutes, measured before compression was added:

- 20 readers;
- 100 badge pollers and 40 dashboard pollers, each every 10–15 s, first polls staggered;
- 5 writes/s and 0.5 sign-ins/s.

**22,371 requests, 113.5 req/s, 0 failed, 0 timeouts. Every threshold met.**

| Kind   |  Count | Mean |  p50 |  p90 |      p95 |   p99 | Max (ms) | Budget (p95) |
| ------ | -----: | ---: | ---: | ---: | -------: | ----: | -------: | ------------ |
| Reads  | 19,798 | 31.2 | 22.6 | 63.6 | **86.6** | 151.6 |    295.1 | < 200 ✅     |
| Badge  |  1,422 | 12.7 |  9.5 | 25.7 | **32.7** |  52.6 |    111.6 | < 50 ✅      |
| Writes |    901 | 29.9 | 22.6 | 60.4 | **76.8** | 117.4 |    260.1 | < 500 ✅     |

Per endpoint, slowest p95 first (ms):

| Endpoint                                       |         p50 |         p95 |           p99 |
| ---------------------------------------------- | ----------: | ----------: | ------------: |
| `POST /auth/login`                             |        74.3 |       207.8 |         239.8 |
| `GET /audit-events` (keyset pages)             |        88.0 |       157.1 |         205.9 |
| `POST /patients`                               |        40.8 |       116.9 |         179.6 |
| `GET /lab-orders`                              |        43.0 |       102.0 |         208.2 |
| `GET /dashboard/doctor`                        |        49.1 |        98.1 |         158.2 |
| `POST /conversations/{id}/messages`            |        31.1 |        83.5 |         115.9 |
| `GET /patients/{id}/profile`                   |        28.2 |        80.6 |         165.1 |
| `GET /medical-records`                         |        27.4 |        75.8 |         178.1 |
| `GET /patients?q=`                             |        27.2 |        73.2 |         134.4 |
| `GET /patients`                                |        28.6 |        71.9 |         200.3 |
| `GET /prescriptions`                           |        20.7 |        57.5 |         140.7 |
| `GET /appointments` (list / week)              | 18.7 / 19.8 | 53.1 / 52.1 | 144.8 / 156.4 |
| `GET /conversations`                           |        18.3 |        48.6 |         107.1 |
| `GET /notifications`                           |        15.0 |        44.3 |          69.5 |
| `PATCH /notifications/{id}` (read)             |        11.9 |        35.0 |          69.9 |
| `GET /notifications/badge-counts`              |         9.5 |        32.7 |          52.6 |
| `GET /medications`, `GET /lab-tests/catalogue` |   8.3 / 7.6 | 27.3 / 25.7 |   41.5 / 38.4 |

Received: 205.2 MiB, or 9,617 bytes per request on average.

**Resources.** PostgreSQL averaged 158% CPU (out of 400%) while active, with a 268% peak. The API
process averaged **68% of one core** (88% peak) and used 563 MB RSS at most.

The API figure is from the corrected run in §5.3. The first API CPU figures, taken with
`ps -o %cpu`, were wrong and are not used. `ps` reports CPU averaged over the process's whole
life, so the result depends on how long the process had been idle before the run. Every API CPU
figure in this file is a 5-second delta of `/proc/<pid>/stat`.

### 3.1 The cold-start herd

A first unstaggered run (`STAGGER=0`) breached the badge budget: **p95 201 ms**. The trace
explains it. All 100 pollers fired their first request inside the same 3 seconds, every one a
cache miss (max 202 ms). After those 3 seconds the herd settled to p50 5.6, p95 8.4 and p99
12.9 ms. The two badge queries themselves take under 0.5 ms
(`notifications_unread_idx`, `conversation_participants_user_id_archived_idx`).

Real clients do not start in lockstep, so the load profile staggers first polls. A deploy or an
API restart that reconnects every open tab at once _does_ start them in lockstep, so the herd is
a real event. `PROFILE=badge-herd STAGGER=0` measures it: **p95 148 ms** with nothing else
running. It lasts seconds, and it is recorded here rather than tuned away.

### 3.2 Stress: where it breaks

The `stress` profile:

- readers ramp to 80;
- the badge herd starts in lockstep;
- 10 writes/s.

38,073 requests at 132.3 req/s, 0 failed, 0 timeouts. **Budgets breached**: read p95 550.5 ms,
badge p95 212.1 ms, write p95 450.2 ms (still under budget).

| Phase              | API process CPU (of one core) | PostgreSQL CPU (of four) |
| ------------------ | ----------------------------: | -----------------------: |
| Ramp to 20 readers |                        42–60% |                  40–190% |
| 40 → 80 readers    |                    **85–96%** |                 180–280% |

**The first ceiling is the single Node process, not the database.** Throughput plateaus at about
130 req/s on this mix once the event loop saturates one core, and latency then grows with queue
length. PostgreSQL still had idle cores. k6 itself was using part of the remaining CPU, so the
exact knee on dedicated hardware will be higher. The _shape_ will not change: one Node process
is one core.

## 4. Targets

### 4.1 The roadmap's budgets — met under the load profile

| Budget (RM M32.2) | Baseline p95 | Headroom |
| ----------------- | -----------: | -------: |
| Reads < 200 ms    |      86.6 ms |     2.3× |
| Badge < 50 ms     |      32.7 ms |     1.5× |
| Writes < 500 ms   |      76.8 ms |     6.5× |

These are budgets for _this_ load (about 113 req/s from one process). They are not met beyond
about 130 req/s per process (§3.2).

### 4.2 Recommended

These are recommendations, not measurements:

| Recommendation                                                                             | Why                                                                                                      |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Keep the roadmap's three budgets as the release gate**, measured with the `load` profile | They hold with headroom, and k6 enforces them                                                            |
| **Add `GET /audit-events` p95 < 250 ms** as a per-endpoint budget                          | Its p95 sits closest to the read budget (157 ms) and grows with the ledger (§6.2)                        |
| **Add sign-in p95 < 300 ms** as a separate budget, outside the read and write classes      | 208 ms is Argon2id doing its job (M2). It must not trigger an "optimisation" that weakens the hash       |
| **Treat the nightly run as a trend, not a gate on absolute numbers**                       | A shared GitHub runner is noisier than this machine and runs the small dataset                           |
| **Plan capacity as ~110 req/s per API process at this mix**, before a margin               | The stress knee (§3.2), less the k6 contention. Scale out with processes; one Node process uses one core |

## 5. Compression (RM M32.3)

### 5.1 Dependency review

|                      |                                                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package              | `compression` 1.8.2, the Express project's own middleware (maintainers dougwilson, ulisesgascon and wesleytodd; last published 2026-09-11)                                                                                 |
| Why a dependency     | Express 4 has no built-in compression. Nest's documented approach is this package                                                                                                                                          |
| New code in the tree | `compressible`, `on-headers`, and `compression`'s own `debug` and `negotiator` versions. `vary`, `bytes`, `safe-buffer` and `destroy` were already present through Express                                                 |
| Security             | `on-headers` 1.1.0 is installed, which contains the CVE-2025-7339 fix. `npm audit --omit=dev` is **unchanged**: the same three pre-existing moderates (`@nestjs/core`, `@nestjs/platform-express`, `ajv`) before and after |
| Types                | `@types/compression` 1.8.1, dev only                                                                                                                                                                                       |

### 5.2 What is compressed

See `src/common/http/compression.ts`.

- **Negotiated from `Accept-Encoding`.** Brotli (quality 4, the library default) is preferred,
  then gzip (level 6). A client that offers neither gets the identity body. `Vary:
Accept-Encoding` is set.
- **Threshold: 1 KB**, and only compressible types (JSON, CSV, text).
- **Never compressed:**
  - **Server-Sent Events**, because compression buffers and would hold back the stream's deltas.
  - **`/api/v1/auth/*`**, because those bodies carry tokens, and a secret compressed beside
    attacker-influenced bytes is the BREACH precondition.
- **ETags still work.** A matching `If-None-Match` answers 304 for both encodings.

`test/compression.e2e-spec.ts` covers all of this over raw `node:http`, not supertest, because
supertest decodes bodies before the test sees them. `src/common/http/compression.spec.ts` covers
the filter.

**For deployment:** if the reverse proxy also compresses, configure it to pass an already-encoded
response through. Either layer alone is enough.

### 5.3 Before and after

Payload sizes, as single requests over loopback (bytes):

| Response                          | Identity |   gzip |                        br |
| --------------------------------- | -------: | -----: | ------------------------: |
| `GET /patients?pageSize=20`       |    8,468 |  1,266 |                     1,237 |
| `GET /patients?pageSize=100`      |   42,073 |  4,392 |                     4,337 |
| `GET /appointments?view=week`     |   64,260 |  6,054 |                     6,122 |
| `GET /prescriptions?pageSize=20`  |   21,300 |  2,038 |                     1,926 |
| `GET /dashboard/doctor`           |   11,253 |  2,351 |                     2,293 |
| `GET /audit-events?pageSize=50`   |   18,936 |  2,351 |                     2,147 |
| `GET /patients/export` (CSV)      |  393,097 | 72,980 |                    77,562 |
| `GET /patients/{id}/profile`      |      539 |    539 | 539 (under the threshold) |
| `GET /notifications/badge-counts` |       46 |     46 |  46 (under the threshold) |

The `load` profile was run three times on the same build, back to back. Only the client's
`Accept-Encoding` changed between runs. Times are p50 / p95 / p99 in ms:

|                                | `identity`           | `gzip`               | `gzip, deflate, br` (→ br) |
| ------------------------------ | -------------------- | -------------------- | -------------------------- |
| Requests / rate                | 22,343 / 113.1 req/s | 22,419 / 114.0 req/s | 21,977 / 110.8 req/s       |
| **Received**                   | **194.7 MiB**        | **45.4 MiB (−77%)**  | **44.6 MiB (−77%)**        |
| Reads                          | 22.4 / 85.2 / 142.2  | 22.1 / 84.2 / 137.3  | 25.2 / 91.3 / 153.1        |
| Badge                          | 10.0 / 37.3 / 68.2   | 8.6 / 28.3 / 43.7    | 9.9 / 31.1 / 55.5          |
| Writes                         | 24.3 / 76.4 / 101.1  | 21.2 / 71.4 / 104.7  | 24.1 / 71.3 / 113.6        |
| API CPU, mean / max (one core) | 68.2% / 88.1%        | 69.6% / 78.3%        | 71.7% / 78.3%              |
| PostgreSQL CPU, mean / max     | 153.6% / 250.2%      | 136.8% / 272.7%      | 145.7% / 239.1%            |
| Failed                         | 0                    | 0                    | 0                          |

**Reading it:**

- Compression cuts bytes on the wire by about 77%. It costs about 1.5–3.5 points of one core,
  which is inside run-to-run noise.
- It does not change latency on loopback, and it is not expected to. The latency gain is on
  real networks, where those bytes take time: a 64 KB week view becomes 6 KB.
- The br run's reads are about 3 ms slower at p50. That is within what separates two runs of the
  same configuration, so this data does not show that brotli is slower.

A codec microbenchmark on nine real response bodies (mean 17.6 KB) puts numbers on the trade-off:

| Codec                       | Compressed size | CPU per response |
| --------------------------- | --------------: | ---------------: |
| gzip 6 (used)               |           12.4% |           150 µs |
| brotli q4 (used, preferred) |           12.2% |           165 µs |
| gzip 1                      |           14.1% |            76 µs |
| brotli q1                   |           14.0% |            43 µs |

The defaults are kept. Dropping to brotli q1 would save about 120 µs per response for 15% more
bytes. That is a tuning lever, not a need at today's CPU use.

## 6. Database index review (RM M32.3) — analysis only

**No index was added to the schema. No migration was written. The project's database was not
touched.** Every experiment below ran in the disposable `medora_perf_medium`. Every
experimental index was created there, measured and dropped there, and named `m32_exp_*` so it
could not be mistaken for a real one.

### 6.1 Method

1. **Inventory.** `pg_indexes`: **455 indexes on 126 tables** (partitions included).
2. **What the API actually sends.** `pg_stat_statements`, enabled in the benchmark container
   only, collected over a full `load` run.
3. **Plans.** `EXPLAIN (ANALYZE, BUFFERS)` on the costliest statements. Parameters were real ids
   for a median doctor (226 patients) and the heaviest doctor (3,905 live assignments).
4. **Timings.** `pgbench -c 1 -t 300` per query, so each figure is a mean of 300 executions rather
   than one EXPLAIN.
5. **Usage.** `pg_stat_user_indexes` after a statistics reset and a full `stress` run.
6. **Write cost.** Inserting 20,000 patients and 40,000 medical records in a transaction that is
   rolled back, timed with and without the experimental indexes.

### 6.2 Where the database time goes

The top statements by total time over one `load` run. Shares are of the 30 costliest statements' combined 246 s of execution time:

| Statement                                                                            |         Calls |        Mean | Max (ms) | Buffers/call |   Share |
| ------------------------------------------------------------------------------------ | ------------: | ----------: | -------: | -----------: | ------: |
| Audit pivot: `COUNT(*) … GROUP BY severity` and `… GROUP BY category`, with a cursor |     608 + 608 | 62.9 / 61.6 |    179.5 |        6,237 | **31%** |
| The same two pivots, first page                                                      |     304 + 304 | 59.0 / 56.7 |    164.4 |        6,237 |     14% |
| `GET /lab-orders` page and its count                                                 | 1,508 + 1,508 | 21.6 / 20.9 |     96.9 |        1,123 |     26% |
| `GET /patients` page and count, `GET /medical-records` page and count                |   ~1,500 each |     4.6–5.8 |     42.8 |    446–1,911 |     19% |
| The other 20 of the 30                                                               |               |       ≤ 4.5 |          |              |     10% |

**The audit pivot.** Every `GET /audit-events` page runs two `GROUP BY`s over the whole filtered
ledger (`AuditRepository.pivot`). With no filter, that is a parallel sequential scan of all
300,000 rows, twice per page.

**No index fixes this:**

- the plan already reads every row because it counts every row;
- forcing the existing `(category, severity, occurred_at)` index made it _slower_ (46.7 ms
  against 40.1 ms);
- a single `GROUPING SETS` pass lost parallelism and took 95.4 ms.

The cost is proportional to the ledger. At the large scale's 1.5 M events it would be about five
times this, an estimate from the linear scan and not measured. Planning alone costs 9–13 ms per
audit query, because each statement is planned against 13 partitions.

> **Finding — the pivot counts the wrong set on pages 2+ (fixed, §9).** `pivot()` uses `whereFor(query)`,
> which includes the keyset cursor. On the first page it counts the filtered ledger, as
> documented. On every later page it counts only the rows _older than the cursor_, so the
> numbers beside the filters shrink as the user pages. This is a behaviour defect, not only a
> cost. It was found here and **not changed** (see §7).

**Lab orders.** The care scope is written as `ordered_by = me OR EXISTS(assignment for the
LEFT-JOINed patient)`. The `OR` across a join stops PostgreSQL from using an index for either
half. Every page and every count sequentially scans `lab_orders` and `patients` and hash-joins
them: 1,117 buffers for 20 rows.

### 6.3 Experiments

pgbench means over 300 executions each, in ms.

| Query                                      | Today | With experimental index | Index                                                                                                     | Today's shape, rewritten |
| ------------------------------------------ | ----: | ----------------------: | --------------------------------------------------------------------------------------------------------- | -----------------------: |
| `GET /patients` page, heavy doctor         |  5.02 |                **0.92** | `m32_exp_patients_full_name_live`: `patients (full_name) WHERE deleted_at IS NULL`                        |                        — |
| `GET /patients` page, median doctor        |  3.58 |                    2.87 | same                                                                                                      |                        — |
| `GET /medical-records` page, heavy doctor  | 10.95 |                **1.69** | `m32_exp_mr_visit_date_live`: `medical_records (visit_date DESC) WHERE deleted_at IS NULL`                |                        — |
| `GET /medical-records` page, median doctor |  3.55 |                    1.91 | same                                                                                                      |                        — |
| `GET /lab-orders` page, heavy doctor       | 18.00 |          13.23 (unused) | `m32_exp_lab_ordered_by_requested`: `lab_orders (ordered_by, requested_at DESC) WHERE deleted_at IS NULL` |                 **5.65** |
| `GET /lab-orders` page, median doctor      | 12.86 |          11.26 (unused) | same                                                                                                      |                 **5.14** |
| Audit pivot (unfiltered)                   | 22.91 |                   21.07 | — (no index applies)                                                                                      |                        — |

"Rewritten" means the scope expressed on `lab_orders.patient_id` directly:
`ordered_by = me OR patient_id IN (SELECT patient_id FROM patient_doctor_assignments WHERE
doctor_id = me AND revoked_at IS NULL)`, with no `LEFT JOIN` to `patients`. The planner still
scans `lab_orders`, but it drops the join and the `patients` scan. Its result was checked to be
the same row set for both doctors (320 and 5,747 rows, `EXCEPT` empty both ways). With the scope's patient ids fetched first and passed as an
array, the page took 4.9–5.3 ms on a single EXPLAIN.

One single-EXPLAIN reading was misleading, and the 300-run means correct it. With
`m32_exp_patients_full_name_live`, the median doctor's single plan walked 1,870 rows of the name
index to find 20 and took 8.0 ms, against 4.2 ms without the index. Over 300 runs the index came
out ahead for that doctor too (2.87 against 3.58 ms). The sensitivity is real: an ordered index
walk for a narrow scope is a planner bet that the matching rows appear early.

**Write cost** (bulk insert in a transaction that was rolled back; mean of 4 runs, ms):

|                        | Without | With the 3 experimental indexes |                                                    Change |
| ---------------------- | ------: | ------------------------------: | --------------------------------------------------------: |
| 20,000 patients        |     563 |                             622 |                                                      +10% |
| 40,000 medical records |   6,397 |                           6,702 | +5% (a fourth run of 13,281 ms is excluded as an outlier) |

The indexes are 256–656 kB each at this scale.

### 6.4 What this means at the endpoint

The heavy-doctor gains are real (5–6×), but they are milliseconds inside endpoints whose p95 is
70–100 ms, and most of that time is spent in the API process (§3.2). Under the load profile, on
this dataset, **no index is what stands between an endpoint and its budget.** That is why
nothing was proposed as a migration. The case for the two partial indexes strengthens at the
large scale and for the heaviest doctors. It has not been measured there.

### 6.5 Unused and possibly redundant indexes

`idx_scan` after a statistics reset and a full `stress` run, for tables over 1,000 rows. Zero
scans under _this_ workload does not mean redundant: search by MRN or phone, admin screens, jobs
and the retention sweep were not exercised.

| Index                                                                                                                           | Scans | Assessment                                                                                                                                                                                              | Confidence                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `patient_doctor_assignments_doctor_id_patient_id_idx` (full)                                                                    |     0 | Shares its columns with the partial `…_live_idx` (`WHERE revoked_at IS NULL`), which served 20,931 scans. It is redundant unless something reads _revoked_ assignments by doctor                        | **Medium** — the history and audit readers need checking first                                                     |
| `audit_events_*_occurred_at_idx1` (BRIN)                                                                                        |     0 | A b-tree on the same column exists on every partition and serves all 8,265 range scans. The BRIN is 24 kB                                                                                               | **Medium**. Nothing to gain by dropping it                                                                         |
| `*_deleted_at_idx` on `appointments`, `lab_orders`, `medical_records`, `messages`, `patients`, `prescriptions`, `conversations` |     0 | Live reads filter `deleted_at IS NULL`, which matches almost every row and is never served by this index. Only the purge and restore paths (`ONLY_DELETED`, `file.repository`) look for non-null values | **Low–medium**. Candidates for partial `WHERE deleted_at IS NOT NULL` indexes, about 8.5 MB together at this scale |
| `patients_mrn_trgm_idx`, `patients_phone_trgm_idx`, `messages_body_trgm_idx`, `audit_events_*_summary_idx`                      |     0 | Search indexes. The suite searches by name only                                                                                                                                                         | **Not redundant**. Exercise them before judging                                                                    |
| `medical_records_doctor_id_status_idx`, `*_status_priority_idx`, `appointments_status_starts_at_idx`                            |     0 | Admin and queue filters the suite does not drive                                                                                                                                                        | **Not assessed**                                                                                                   |

## 7. Recommendations — and what became of them

The table below is as first written. The owner then decided each item. Status as of 2026-11-05:

| #   | Status                                                                                                                                               | Where |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| R1  | **Done.** The pivot counts the filters only, on page one, or on request (`pivot=true`)                                                               | §9    |
| R2  | **Not applied.** Equivalence proven, but the Prisma-expressible form is slower for the heaviest doctor. The tests found a **search leak**, now fixed | §10   |
| R3  | **Re-measured at two scales, still a recommendation.** Big wins at the heavy end, regressions for median doctors. No schema change                   | §11   |
| R4  | Open                                                                                                                                                 | §6.5  |
| R5  | **Measured locally.** Multiple processes are architecturally safe; on a 4-vCPU box with the database co-located, a second process buys little        | §12   |
| R6  | Open: pool size per process, with replicas                                                                                                           | §12   |
| R7  | **Done.** `no-store` by default; `private, no-cache` for PHI-free reference data                                                                     | §13   |

Unchanged from the first write-up: no schema change and no migration were authorised in M32.

| #   | Recommendation                                                                                                                                                | Evidence                                                                                                                                                                     | Kind                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| R1  | **Compute the audit pivot without the cursor**, and decide whether pages 2+ need it at all. Options: the first page only, or cached briefly in the M31 kernel | §6.2: 45% of the costliest statements' time under load, and wrong counts on pages 2+                                                                                         | Behaviour fix plus API contract (`pivot` on cursor pages)                                      |
| R2  | **Rewrite the lab-orders scope** onto `lab_orders.patient_id`                                                                                                 | §6.3: 12.9–18.0 → 5.1–5.7 ms per statement, twice per request                                                                                                                | Query change in an _authorization scope_, so it needs a scope-equivalence test before it ships |
| R3  | **Partial indexes** `patients (full_name) WHERE deleted_at IS NULL` and `medical_records (visit_date DESC) WHERE deleted_at IS NULL`                          | §6.3: 5–6× for the heaviest doctor, +5–10% insert cost                                                                                                                       | Migration. Re-measure at the large scale first                                                 |
| R4  | **Review the zero-scan indexes** in §6.5 with a workload that includes search, admin and jobs                                                                 | §6.5                                                                                                                                                                         | Analysis, then a migration                                                                     |
| R5  | **Run more than one API process** (cluster or replicas) before raising the pool size                                                                          | §3.2: one process saturates one core at ~130 req/s while PostgreSQL has idle cores                                                                                           | Deployment                                                                                     |
| R6  | **Size the Prisma pool explicitly** (`max`) once there are several processes. Today it is node-postgres's default of 10 per process                           | Not shown to be a bottleneck: no timeouts in any run, and the API saturated first under stress. Pool waits were not instrumented. Recorded because the size was never chosen | Configuration                                                                                  |
| R7  | **Decide `Cache-Control`** (the M37.2 finding), because it decides whether browsers use the ETags at all                                                      | §5.2                                                                                                                                                                         | Security decision                                                                              |

## 8. Finalization (2026-11-05)

The owner decided each recommendation in §7: fix the pivot, prove the lab scope before touching
it, re-measure the indexes at scale, measure several processes, review the cache policy, and run
the nightly workflow on GitHub. §9–§14 are those results, measured the same way as §1–§6, on
the same machine and synthetic data. Each section says what changed in code and what is still
only a recommendation.

## 9. The audit pivot — fixed (RM M32.3, R1)

**What was wrong.** `GET /audit-events` ran `AuditRepository.pivot()` on every page: two
`GROUP BY`s over the filtered ledger. The pivot used `whereFor(query)`, which includes the keyset
cursor, so on page 2 and later it counted only the rows older than the cursor. The numbers
beside the filters shrank as the reader paged.

**What changed.**

- The pivot counts the filters alone (`filtersOf`), never the cursor.
- It is computed on the first page and omitted on cursor pages, the same way `nextCursor` is
  absent when there is no next page. The filtered set, and so the pivot, is identical on every
  page of one listing, so page 2 carries nothing page 1 did not already give.
- `pivot=true` asks for it on a cursor page. `pivot=false` skips it on page one. A mangled
  cursor already counted as page one for the rows, and now it does for the pivot too.
- Authorization is unchanged: `logs.view`, and the ledger is platform-wide by design (API §14).

Nothing the API contract requires was removed. §14.1 lists filters, keyset pagination and the
retention meta. The pivot is M28.3's addition, no client reads it yet, and every listing still
gets it on page one.

**Measured.** Medium dataset (300,000 events), auditor walking page 1 and two keyset pages of 50,
200 walks per build, run twice, alternating builds:

|                                                | Before              | After                                         |
| ---------------------------------------------- | ------------------- | --------------------------------------------- |
| Page 1, p50 / p95                              | 39–40 / 51 ms       | 40–43 / 51–53 ms (unchanged: it still counts) |
| Pages 2 and 3, p50 / p95                       | 43 / 53–55 ms       | **8–9 / 11–12 ms**                            |
| One three-page walk (mean)                     | 129 ms              | **58–62 ms**                                  |
| Pivot `GROUP BY` calls / DB time per 200 walks | 1,200 / 37.4–37.7 s | **400 / 11.8–12.6 s (−67%)**                  |

**Tests.** `test/audit-pivot.e2e-spec.ts` covers:

- page one, page two and every page;
- tie boundaries and a cursor past the last row;
- an empty set and the filters;
- the two routes to `logs.view` (admin role, per-user override) and a refused caller;
- concurrent pages and validation.

With the old behaviour restored, 9 of its 16 cases fail.

## 10. The lab-orders scope — a leak fixed, the rewrite not applied (R2)

**A leak, found by the equivalence tests.** `LabOrderRepository.whereFor` spread the care scope
(`visibleTo`, an `OR`) and the `q` search (another `OR`) into one object. The second `OR` key
replaced the first, so **any search on `GET /lab-orders` dropped the care scope**. On the medium
dataset, a doctor with 1,582 orders in scope got all 29,591 for `q=LAB-` or `q=a`.

- The CSV export (`GET /lab-orders/export`) reads the same clause.
- The detail read, the bulk review and the summary did not: each spreads the scope alone.
- The scope is now under `AND`, where no later key can replace it.
- The other list endpoints with `q` were probed the same way. None returned more with a search
  than without one.

**Equivalence.** `test/lab-order-scope.e2e-spec.ts` builds every shape of API §8.2's scope:

- own orders;
- care-scoped patients;
- a colleague's order on my patient;
- a revoked consult, where my own order stays visible and the colleague's does not;
- a live consult;
- a soft-deleted order;
- a doctor with nothing.

It then compares the worklist with a hand-written SQL oracle:

- all pages, at four page sizes, both sort directions, past the last page;
- searches and filters;
- the detail read (200 inside the scope, 404 outside);
- the summary total.

With the old clause, the two search cases fail.

At the SQL level, on the medium dataset, the current scope, the prefetched-ids form and the
`IN (subquery)` form return **identical ordered sets for all 40 doctors (33,867 rows, 0
mismatches)**.

**Why the rewrite is not applied.** Equivalent results, but not a uniform speed-up. Prisma cannot
express `patient_id IN (SELECT …)` without the join. The form it can express prefetches the
doctor's live patient ids, then filters `ordered_by = me OR patient_id IN (…ids)`, one bind
parameter per patient. Measured as Prisma sends it (parameterised, 200 runs, mean ms):

|                                   | Median doctor (346 patients) | Heaviest doctor (3,845 patients) |
| --------------------------------- | ---------------------------: | -------------------------------: |
| Today: page / count               |                  12.0 / 10.2 |                      13.4 / 12.4 |
| Prefetch ids                      |                          1.0 |                              2.6 |
| Prefetch + `IN (…)`: page / count |                    6.1 / 5.4 |         **15.3 / 13.8 (slower)** |
| `= ANY($array)` page              |                          5.6 |                             14.2 |

The fast numbers from §6.3 (5.1–5.7 ms) were the `IN (subquery)` form, which needs raw SQL. That
puts hand-written SQL inside an authorization scope, so it is a decision, not a refactor. The
prefetch form also grows with the scope and moves the scope into a second statement. **The
original query stays**, with the leak fixed.

## 11. The partial indexes, re-measured at two scales (R3) — still recommendations

**Recommendation only. No schema change, no migration, nothing in `prisma/`.** Every index below
was created in a disposable `medora_perf_*` database, measured, and dropped. The script refuses
any database not named `medora_perf_*` or holding a non-synthetic user.

**The large dataset.** `generate.ts --scale large` into a fresh `medora_perf_large`, in the same
benchmark container, verified empty first. It took 14 min 22 s and the database is 1.38 GB:

| Doctors | Patients | Assignments | Appointments | Records | Prescriptions | Lab orders | Notifications | Conversations / messages | Audit events |
| ------: | -------: | ----------: | -----------: | ------: | ------------: | ---------: | ------------: | -----------------------: | -----------: |
|     120 |  100,000 |     114,811 |      599,394 | 198,228 |       146,961 |    146,566 |       940,800 |          8,000 / 198,225 |    1,500,000 |

The heaviest doctor has **14,717** live assignments and the median doctor 480 (medium: 3,845 and
346).

**Reads.** pgbench mean of 300 executions, ms. The two indexes are `patients (full_name) WHERE
deleted_at IS NULL` and `medical_records (visit_date DESC) WHERE deleted_at IS NULL`:

| Query                              | Medium: without → with        | Large: without → with         |
| ---------------------------------- | ----------------------------- | ----------------------------- |
| Patients page, **heaviest** doctor | 4.69 → 0.75 (6.3×)            | **21.32 → 0.82 (26×)**        |
| Patients page, median doctor       | 3.51 → 1.86                   | **1.78 → 5.55 (3.1× slower)** |
| Records page, **heaviest** doctor  | 11.29 → 1.74 (6.5×)           | **29.73 → 2.32 (13×)**        |
| Records page, median doctor        | **2.01 → 7.43 (3.7× slower)** | 3.22 → 2.92                   |

Index sizes: 248 kB and 296 kB at medium, 760 kB and 1,416 kB at large.

**Writes.** In a rolled-back transaction, mean of 4–5 runs:

|                                        | Medium: without → with                    | Large: without → with                     |
| -------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| 20,000 patient inserts                 | 479 → 537 ms (+12%)                       | 550 → 590 ms (+7%)                        |
| 20,000 `visit_date` updates on records | 814 → 910 ms (+12%)                       | 750 → 884 ms (+18%)                       |
| 40,000 record inserts                  | 21,680 → 20,991 ms (within noise, sd 292) | 21,466 → 21,753 ms (within noise, sd 605) |

The record-insert statement is dominated by its own row construction (`jsonb_populate_record`
over 40k rows), so an index's share of it does not show. An update of `visit_date` stops being
HOT once an index covers the column, which is the +12–18%.

**What it means.** The heavy end gains a lot, and the gain grows with scale: 21–30 ms becomes
under 2.5 ms. But the indexes are a **planner bet**, and they lose it for typical doctors. With
an ordered index available, PostgreSQL sometimes walks the whole live set in name or visit-date
order, hoping the doctor's rows appear early. For a median doctor they appear late, which is 3×
slower in two of the four median cases. Neither plan is wrong; the statistics cannot tell the
planner which doctor it is serving.

**Recommendation, unchanged in kind:** do not add these as they stand. Options for a later
decision, none measured here:

- the same indexes plus a query shape that keeps the scope-first plan for small scopes;
- an index keyed on the scope itself (for example `patients (assigned_doctor_id, full_name)`, if
  the primary assignment is enough for the list);
- leaving it until a real deployment shows doctors at the heavy end.

## 12. More than one API process — investigation and local measurements (R5, R6)

**Nothing in the deployment or bootstrap was changed.** The experiment used a scratch launcher,
outside the repository: `node:cluster` forking N copies of the production build onto one port.

### 12.1 Is the application safe to run as several processes?

| Concern                                  | Finding                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions and auth                        | Stateless access JWTs (`AccessTokenGuard` reads no session row). Refresh tokens, lockout counters and 2FA state are in PostgreSQL. **Safe**                                                                                                                                                                                                         |
| Permission cache                         | `RedisPermissionCache` (M7.1), invalidated through Redis. `InMemoryPermissionCache` is a unit-test double only. **Safe**                                                                                                                                                                                                                            |
| M31 cache kernel (badge, reference data) | Redis, versioned invalidation. **Safe**, and measured below                                                                                                                                                                                                                                                                                         |
| Single-flight and dashboard coalescing   | Per process by design: each process coalesces its own herd, and correctness comes from the versions, not from the flight. **Safe**, with less deduplication                                                                                                                                                                                         |
| Rate limiter                             | One Redis fixed window per client (M37.2). **Safe**: the limit is global, not per process                                                                                                                                                                                                                                                           |
| Idempotency keys (ADR-014)               | Durable table, `UNIQUE`. **Safe**                                                                                                                                                                                                                                                                                                                   |
| Scheduled jobs                           | `JOBS_DRIVER=inline` runs each sweep on every process with `JOBS_ENABLED=true`. Every job is idempotent, and the drains claim rows with `FOR UPDATE SKIP LOCKED`, so a duplicate is wasted work, not duplicate output (`inline-job-queue.ts`). `JOBS_DRIVER=bullmq` fires each schedule once across N processes. **Safe; configure one of the two** |
| In-process state                         | Every remaining `new Map` in a service or repository is request-local. No WebSocket gateway and no in-process event bus. SSE streams are per request. **Safe**                                                                                                                                                                                      |
| PostgreSQL pool                          | `PrismaPg` with node-postgres's default `max: 10`, **per process**. N processes are up to 10·N connections, plus BullMQ's Redis connections. Default `max_connections` is 100                                                                                                                                                                       |
| Client IP (audit, rate limit)            | Needs `TRUST_PROXY` set for the real proxy topology behind a balancer. Already required for one process                                                                                                                                                                                                                                             |

**Measured, not just read.** With 3 workers and round-robin dispatch (requests spread
409 / 411 / 411 across the worker pids):

- 20 rounds of "mark a notification read, then read the badge 10 times" gave **200 reads, 0
  stale**: a write on one worker invalidated the badge for reads served by the others;
- a token issued through one worker was accepted 30 times out of 30.

The k6 checks (status and body shape on every request) passed throughout every run below.

### 12.2 Throughput and latency, 1 vs 2 vs 3 processes

Same 4-vCPU machine, medium dataset, current build. k6 and PostgreSQL share the machine.

**Stress** (readers ramp to 80, the badge herd starts in lockstep, 10 writes/s), p95 / p99 in ms:

| Processes | Requests |          Throughput | Reads     | Badge     | Writes    | Errors |                  API CPU (hold) | PostgreSQL CPU (hold) |  API RSS |
| --------: | -------: | ------------------: | --------- | --------- | --------- | -----: | ------------------------------: | --------------------: | -------: |
|         1 |   41,873 |         145.4 req/s | 453 / 573 | 200 / 377 | 376 / 483 |      0 | **99.5%** (one core, saturated) |                  158% |   554 MB |
|         2 |   45,620 |   158.4 req/s (+9%) | 393 / 493 | 186 / 275 | 340 / 447 |      0 |                            122% |                  204% | 1,152 MB |
|         3 |   45,810 | 159.1 req/s (+0.4%) | 436 / 606 | 216 / 298 | 379 / 521 |      0 |                            129% |                  210% | 1,550 MB |

**Load** (113 req/s target, below saturation):

| Processes |  Throughput | Reads p50 / p95 / p99 | Badge p95 | Writes p95 | Errors | API CPU mean |  API RSS |
| --------: | ----------: | --------------------- | --------: | ---------: | -----: | -----------: | -------: |
|         1 | 114.2 req/s | 21.9 / 69.7 / 140.8   |      32.4 |       75.1 |      0 |        74.5% |   581 MB |
|         2 | 114.4 req/s | 20.9 / 70.5 / 139.2   |      27.1 |       65.4 |      0 |        85.8% | 1,036 MB |

**Reading it:**

- **One process saturates one core**, which §3.2 had shown. A second process lifts throughput only
  9% here, and a third nothing, because **the machine runs out first**:
  - PostgreSQL takes about two of the four cores under stress;
  - k6 takes most of the rest;
  - the load average reached 10.

  This measures the box, not the application's ceiling: on dedicated hardware with the database
  on its own host, the second and third process would have cores to use. That was not measurable
  here.

- **Below saturation a second process buys nothing**: latency is the same within noise. It costs
  memory (~0.5 GB per process) and about 11 points of CPU in overhead.
- Every run, every process count: 0 errors, 0 timeouts.

The single-process stress throughput rose from 132 req/s (§3.2) to 145 req/s on the current build.
The audit pivot fix (§9) is the largest change between the two. Under the load profile,
`/audit-events` p50 fell from 88 to 21 ms and p95 from 157 to 114 ms.

### 12.3 Recommendation

- **Do not change process management in code.** No `node:cluster` in `main.ts`. Scale with
  **replicas of the existing container** (one process each), which the Dockerfile already
  supports. Each replica keeps its own health check (`/api/v1/ready`), SIGTERM drain
  (`enableShutdownHooks`) and restart, which a cluster primary would otherwise have to
  re-implement.
- **Add the second replica when sustained traffic per replica approaches ~110 req/s at this mix**
  (§4.2), or for availability, which is a better reason than throughput below that.
- **With more than one replica**, either set `JOBS_DRIVER=bullmq` (each schedule fires once) or
  `JOBS_ENABLED=false` on all but one.
- **Pool (R6):** 10·N connections must stay under the database's `max_connections`, with headroom
  for migrations and admin sessions. Put PgBouncer (transaction pooling) in front past about four
  replicas. Pool waits were not instrumented, and no run showed a timeout.
- **Measure again on the real topology** (database on its own host) before sizing. The numbers
  above bound the co-located case only.

## 13. HTTP cache policy — security review and what was implemented (R7)

### 13.1 What the API sent before

| Response                                                                                                            | `Cache-Control`          | Risk                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every JSON route: patients, records, prescriptions, labs, appointments, dashboard, notifications, messages, `/me/*` | **none**                 | A browser may store the body in its disk cache and reuse it after revalidation. On a shared workstation, the next user of the profile can reach it through the cache. ASVS 8.2.1 asks that sensitive data not be cached by browsers |
| `POST /auth/*` (tokens in the body)                                                                                 | **none**                 | Low: a `POST` response is stored only with explicit freshness, but nothing said `no-store`                                                                                                                                          |
| CSV exports, `POST /audit-events/export`, `GET /metrics`                                                            | `no-store`               | —                                                                                                                                                                                                                                   |
| AI token stream (SSE)                                                                                               | `no-cache, no-transform` | `no-cache` permits storage. See R9                                                                                                                                                                                                  |

**Shared caches** (a proxy or CDN between the client and the API) could not store the
authenticated responses even before this change. RFC 9111 §3.5 forbids storing a response to a
request carrying `Authorization` unless the response explicitly allows it (`public`,
`s-maxage`, `must-revalidate`), and none did. No route is cookie-authenticated on `GET`: the
refresh cookie is read only by `POST /auth/refresh`. So there was no cross-user exposure through
an intermediary, only the browser's own cache.

**`Vary`.** Compression adds `Vary: Accept-Encoding`. `Vary: Authorization` is not needed:

- a `no-store` response is never stored, so there is nothing to key;
- the revalidate-only routes return the same body to every caller.

**ETags.** Express's weak ETag hashes the body, so two users' bodies give two tags. A 304 has no
body, so `If-None-Match` cannot surface another user's data: it confirms a copy the requester
already holds. ETags still work on `no-store` routes for a client that sends them. Browsers
simply never will, because they keep nothing.

### 13.2 The policy (implemented)

`common/http/cache-policy.ts`:

| Category                                                                     | Policy                                                    | Routes                                                                                                        |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Everything, by default**: PHI, personal data, auth, errors (401, 404, 413) | `no-store`                                                | All, unless listed below                                                                                      |
| Reference data with no person in it, identical for every caller              | `private, no-cache`, **on success only**                  | `GET /meta/enums`, `GET /medications`, `GET /medications/{id}/monograph`, `GET /lab-tests/catalogue`          |
| Routes that already set their own                                            | unchanged (a handler's header wins over the middleware's) | CSV exports and the audit export (`no-store`), metrics (`no-store`), the AI stream (`no-cache, no-transform`) |

The design choices:

- **Default-deny rather than a PHI list.** A route added later is `no-store` without anyone
  remembering. A list of PHI routes is a list someone forgets to update.
- **`private`, not `public`, for reference data.** It is behind authentication. A shared cache must
  never answer an unauthenticated request from a copy made for an authenticated one.
- **Success only.** Nest's `@Header` is applied even when the handler throws, which the first test
  run showed: a 404 from the monograph route carried `private, no-cache`. The marker is an
  interceptor that sets the header once the handler returns.
- **Badge counts stay `no-store`.** They are per user, and the body (~50 bytes) is smaller than
  the 304 that revalidation would buy.
- **Compatibility.** Neither the web client (`frontend/src/api/client.ts`, plain `fetch`) nor the
  patient app sends `If-None-Match` or handles a 304. Neither has a service worker. So `no-store`
  changes what browsers keep, not what clients receive.

`test/cache-policy.e2e-spec.ts` checks:

- one route of every sensitive category, plus sign-in, refresh, 401, 404 and a 404 from a
  reference route, all `no-store`;
- the reference routes, `private, no-cache` with a working 304;
- that no response walked is `public`, carries `s-maxage` or carries a positive `max-age`.

`cache-policy.spec.ts` checks the interceptor's success-only rule.

### 13.3 Not implemented: decisions for the owner

| #   | Question                                                                                                 | Recommendation                                                                  |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| R9  | The AI token stream sends `no-cache, no-transform`. Its deltas can quote a chart                         | `no-store, no-transform`. Left alone because the AI module is outside this work |
| R10 | `Pragma: no-cache` / `Expires: 0` for HTTP/1.0 intermediaries                                            | Not needed for modern clients. Add only if a deployment proxy is HTTP/1.0       |
| R11 | Whether the patient app should cache anything offline (it is a mobile client, outside the browser cache) | A product decision. It would need encrypted on-device storage, not HTTP caching |

## 14. The nightly workflow on GitHub Actions (M32.1, M32.2)

**First run: [#42076132663](https://github.com/Fares7324/smart-healthcare-assistant-system/actions/runs/42076132663),
2026-11-05, success**, on the pull request that adds it. It ran on the `pull_request` trigger,
path-filtered to `backend/perf/**` and the workflow file. GitHub only schedules and dispatches
a workflow that is on the default branch, so the nightly schedule starts once this reaches
`main`.

The run, every step green:

- `npm ci`, migrations, seed, the small dataset;
- build, then the API on `localhost:3200`;
- k6 smoke, then load;
- job summary and artifact (`perf-results-42076132663`, 5 files, retained 30 days);
- the service containers were removed with the job.

There is no deploy step and no secret from the repository: the three run secrets are generated
and masked per run.

`ubuntu-latest`, small dataset (10 doctors, 2,000 patients), `load` profile:

|        |  count | mean |  p50 |  p90 |      p95 |   p99 | max (ms) | budget   |
| ------ | -----: | ---: | ---: | ---: | -------: | ----: | -------: | -------- |
| Reads  | 20,713 | 17.9 | 12.4 | 33.4 | **43.5** | 130.1 |    362.5 | < 200 ✅ |
| Badge  |  1,421 |  8.0 |  5.2 | 16.9 | **21.6** |  37.7 |    118.4 | < 50 ✅  |
| Writes |    901 | 28.5 | 14.8 | 62.3 | **99.9** | 208.8 |    369.8 | < 500 ✅ |

23,166 requests at 119.0 req/s, **0 failed, 0 timeouts, every threshold met**. 43.7 MiB received
(compressed). Smoke: 501 requests, 0 failed. Slowest endpoints at p95: patient-create 171 ms,
sign-in 147 ms, patient-profile 110 ms, message-send 99 ms. These are a shared runner on the small
dataset, so they are not comparable with the medium-dataset numbers in §3. They are the
workflow's own baseline.

One cosmetic fix came out of the run: the Postgres service health check probed a database named
`perf` (`pg_isready -U perf` defaults the database to the user), which logged `FATAL: database
"perf" does not exist` every 10 seconds. It now names `medora_perf_ci`.

## 15. Reproducing

`perf/README.md` has the commands. In short: a fresh `medora_perf_*` database, `db:deploy`,
`db:seed:production`, the generator, a production build, then k6. The nightly workflow does
exactly this on the small dataset (`.github/workflows/perf-nightly.yml`). It has been rehearsed
step by step on this machine, but has not yet run on GitHub.

## 16. PRE-01 session check under load (2026-11-14)

PRE-01 adds one PostgreSQL read to every protected request (`SessionService.isActive`, called by the global
`AccessTokenGuard`; owner decisions I4 and O-13). Measured before it was merged, against the build it replaces.

**Setup.** Local, disposable: PostgreSQL 16 with `pg_stat_statements`, Redis 7, the seeded demo dataset (not the
synthetic `perf/` dataset), one `node dist/main.js` process. Baseline = `1d08b3c1` built from a temporary detached
worktree; PRE-01 = the change. 20 signed-in doctors; a keep-alive Node client cycling `GET /me/sessions`,
`/auth/session`, `/notifications/badge-counts`, `/patients?pageSize=20`; 5 s warm-up, then 30 s at concurrency 16
and 30 s at 64. Two rounds, alternated (baseline, PRE-01, baseline, PRE-01). Pool usage sampled from
`pg_stat_activity` every 250 ms. k6 (§15) was not available in the environment; the client is a short script
using only Node's `http`, so absolute numbers are this client's, and the comparison between builds is the result.

| Concurrency | Build | req/s (round 1 / 2) | p50 ms | p95 ms | p99 ms | non-200 |
|---|---|---:|---:|---:|---:|---:|
| 16 | baseline | 617 / 526 | 22.2 / 26.1 | 48.1 / 57.0 | 60.8 / 66.2 | 0 |
| 16 | PRE-01 | 483 / 476 | 29.2 / 29.7 | 57.1 / 56.8 | 72.6 / 69.0 | 0 |
| 64 | baseline | 537 / 519 | 99.4 / 109.1 | 248.1 / 248.7 | 323.6 / 296.8 | 0 |
| 64 | PRE-01 | 429 / 494 | 135.5 / 114.0 | 271.1 / 238.4 | 291.1 / 274.9 | 0 |

| Measure | Result |
|---|---|
| Lookups per protected request | Exactly 1 (`calls` of the PRE-01 statement = requests, every run) |
| Lookup execution time | mean 0.021–0.028 ms, max 0.5–4.5 ms |
| Lookup failures | 0 |
| Pool | ≤ 10 connections (the `pg` default) in both builds; ≤ 3 active at any sample |
| Throughput | −13 to −16 % on this mix of cheap endpoints |

**Reading it.** The database time is negligible and the pool is far from saturated; the cost is the extra Prisma
call's CPU in the single API process, which is what this mix is bound by. A heavier endpoint pays the same absolute
cost, a smaller share. No cache was added: owner decision I2 makes PostgreSQL authoritative and the staleness bound
C-12 is open.

**PostgreSQL stopped for 10 s under load.** With PRE-01 every protected route fails closed (500) for the whole outage,
including `GET /notifications/badge-counts`, which the baseline kept answering 200 from Redis without any session
check; both builds recover within a second of the restart, and the process survives.
