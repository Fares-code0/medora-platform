# External integrations — what is verified, with what, and what needs a real service

**Rule of this page.** An integration is called *verified* only for what a test actually
exercised. Where the other side is a test double, an emulator or nothing at all, the row says
so. None of the integrations below has been exercised against a production provider.

| Integration | Port (token) | Bound today | Verified with | Needs a real service for |
|---|---|---|---|---|
| Mail (SMTP) | `MAILER` | `SmtpMailer` (nodemailer 10) | A real SMTP conversation with an in-process sink (`test/support/smtp-sink.ts`, `mail.e2e-spec.ts` and every suite that sends mail) | Delivery through the deployment's relay: authentication, TLS, deliverability |
| Object storage (S3) | `FILE_STORAGE` | `S3FileStorage` (AWS SDK v3) | Always on: real SDK requests to a recording server (`s3-file-storage.spec.ts`), and consumers against an in-memory port. **Opt-in, run 2026-11-05 against real MinIO** (`pgsty/minio:RELEASE.2026-08-04T00-00-00Z`): `s3-live.e2e-spec.ts` (3 — put/get/delete, presigned download with the signed disposition, **403 once expired**, the health `HeadBucket`) and `storage-live.e2e-spec.ts` (every consumer, below) | AWS S3 itself — the same specs with `S3_LIVE_*` pointed at it |
| Malware scanning | `MALWARE_SCANNER` | `ClamAvMalwareScanner` (clamd `INSTREAM` over TCP) when `CLAMAV_HOST` is set — **required in production**; otherwise `UnconfiguredMalwareScanner` (no verdict, every file stays `pending`) | Protocol framing against an in-process clamd (`clamav-malware-scanner.spec.ts`); a scripted engine through the sweep (`malware-scan.e2e-spec.ts`). **Opt-in, run 2026-11-05 against real clamd** (`clamav/clamav:1.4.3`, bundled signatures 27927): `storage-live.e2e-spec.ts` — a clean upload judged `clean` and served, EICAR judged `infected` and refused | — (signature freshness is the deployment's: freshclam needs egress to `database.clamav.net`) |
| **Push notifications** | `PUSH_PROVIDER` | `UnconfiguredPushProvider` — deliveries `skipped / no-provider`, as before the port existed | A scripted provider in `push-delivery.e2e-spec.ts` (registration and every delivery outcome) | FCM, APNs or Expo: **not chosen, no credentials** |
| SMS | — | Stub: deliveries `skipped / no-provider` | — | A provider: not chosen (`SMS_PROVIDER=stub`) |
| AI assistant | `AI_GATEWAY` | `UnconfiguredAiGateway` until `AI_PROVIDER` and `AI_API_KEY` are set | Fakes in the AI suites | A model provider |
| Integration probe (`test-connection`) | `INTEGRATION_PROBE` | `HttpIntegrationProbe` | A local HTTP server with a substituted resolver (`integration-probe.spec.ts`) | A real provider endpoint over the deployment's egress |
| Redis (permission cache, cache kernel, job queue, rate limit) | — | ioredis 6 | **Real Redis** in CI (`redis:7-alpine`) and locally; `redis-cache.backend.spec.ts` asserts the cache kernel's commands against it | — |
| PostgreSQL | — | Prisma 7 + `pg` | **Real PostgreSQL 16** in CI and locally | — |
| Monitoring | — | **None.** Logs only (pino); no metrics, no alerting (M38.1) | — | A metrics backend and dashboards |

---

## Object storage — running the live spec

`test/s3-live.e2e-spec.ts` is skipped unless `S3_LIVE_ENDPOINT` is set. It writes and deletes
objects under `patient_document/` in an **existing** bucket, and never creates or deletes a
bucket. It asserts that the store accepts the adapter's `PUT`, that `GET` returns the same
bytes, that a presigned URL serves the object with the signed `Content-Disposition`, that a
1-second URL is refused (403) after it expires, and that `DELETE` is idempotent.

**MinIO, from the development stack:**

```bash
cd backend
docker compose up -d minio
docker compose exec minio sh -c \
  "mc alias set local http://localhost:9000 medora medora-dev-secret && mc mb --ignore-existing local/medora-live"

S3_LIVE_ENDPOINT=http://127.0.0.1:9000 S3_LIVE_BUCKET=medora-live \
S3_LIVE_ACCESS_KEY_ID=medora S3_LIVE_SECRET_ACCESS_KEY=medora-dev-secret \
npx vitest run test/s3-live.e2e-spec.ts
```

The compose service runs `pgsty/minio`, pinned to a release tag, and the image ships `mc`, so
no second client image is needed. `minio/minio` and `minio/mc` are no longer on Docker Hub.
Last run against `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` on 2026-11-05: 2/2 passed.

**AWS S3:** `S3_LIVE_ENDPOINT=https://s3.<region>.amazonaws.com`,
`S3_LIVE_REGION=<region>`, `S3_LIVE_FORCE_PATH_STYLE=false`, a bucket and an access key
allowed `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on it.

| Variable | Default | |
|---|---|---|
| `S3_LIVE_ENDPOINT` | *(unset → skipped)* | The store's URL |
| `S3_LIVE_BUCKET` | — | Must exist |
| `S3_LIVE_ACCESS_KEY_ID`, `S3_LIVE_SECRET_ACCESS_KEY` | — | Credentials for that bucket |
| `S3_LIVE_REGION` | `us-east-1` | |
| `S3_LIVE_FORCE_PATH_STYLE` | `true` | MinIO needs path style; AWS does not |

**What has actually run:** on 2026-10-30, against [s3rver](https://www.npmjs.com/package/s3rver)
3.7.1, an S3 **emulator**. **On 2026-11-05, against real MinIO** (`RELEASE.2026-08-04`): all three
cases, including the 403 on an expired URL. That closes RA-M25.1; AWS S3 itself has not been run.

## Malware scanning — ClamAV, and the end-to-end live spec

`ClamAvMalwareScanner` streams each pending upload to clamd with `zINSTREAM` (length-prefixed
chunks, zero terminator) and maps the reply: `stream: OK` → `clean`, `stream: <signature> FOUND`
→ `infected`, anything else — an `ERROR`, a timeout, a refused connection — → `unavailable`,
which writes nothing and leaves the file `pending` for the next run. It fails closed. No new
dependency: it is `node:net`.

| Variable | Default | |
|---|---|---|
| `CLAMAV_HOST` | *(unset → no engine)* | A bare host; **required when `APP_ENV=production`** |
| `CLAMAV_PORT` | `3310` | |
| `CLAMAV_TIMEOUT_MS` | `30000` | Connection to verdict, per file |

clamd's `StreamMaxLength` must be at least **25 MB**, the largest upload limit
(`shared/files/file-policy.ts`); a larger file is refused by clamd, logged as such, and stays
`pending`. The sweep rotates through the backlog (a keyset cursor), so files it cannot finish
never stop newer uploads from being scanned.

**The end-to-end spec**, `test/storage-live.e2e-spec.ts`, boots the application with the real
store and the real engine bound — nothing overridden — and drives every file consumer through
its own routes: patient documents, record attachments, lab attachments, message attachments,
a branding asset, the profile photo and a verification document. The real
`files.malware-scan` sweep judges each upload; the signed URL each download route returns is
fetched from the store and compared byte for byte. EICAR, uploaded as a message attachment, is
judged `infected` and its download stays refused.

```bash
docker run -d --name medora-minio -p 9000:9000 \
  -e MINIO_ROOT_USER=medora -e MINIO_ROOT_PASSWORD=medora-dev-secret \
  pgsty/minio:RELEASE.2026-08-04T00-00-00Z server /data
docker exec medora-minio sh -c \
  'mc alias set local http://localhost:9000 medora medora-dev-secret && mc mb --ignore-existing local/medora-live'
docker run -d --name medora-clamav -p 3310:3310 clamav/clamav:1.4.3   # ~1 min to load signatures

cd backend
S3_LIVE_ENDPOINT=http://127.0.0.1:9000 S3_LIVE_BUCKET=medora-live \
S3_LIVE_ACCESS_KEY_ID=medora S3_LIVE_SECRET_ACCESS_KEY=medora-dev-secret \
CLAMAV_LIVE_HOST=127.0.0.1 \
npx vitest run test/s3-live.e2e-spec.ts test/storage-live.e2e-spec.ts
```

**What has actually run (2026-11-05):** both specs, 7/7, against the two images above. Not run:
AWS S3, and a clamd with current signatures (this environment's egress refuses freshclam; the
image's bundled database was used — EICAR is in every database).

## Push notifications

**Built (M41.2, mobile contract P5.8):**

- `POST /me/devices` accepts an optional `pushToken` (≤ 1024 characters, opaque; FCM, APNs and
  Expo tokens differ in shape). It is stored on `trusted_devices.push_token` and **never
  returned**, because a token is enough to send the device a notification. The response shape
  is unchanged (`TrustedDevice`, M8.4).
- One device holds a given token. Registering it again — after a handset changes hands, or a
  reinstall — moves it, in the same transaction. Removing a device clears its token.
- The delivery worker's `push` channel checks the provider **first**. With none configured it
  records `skipped / no-provider`, which is exactly what it recorded before. Otherwise:
  - no registered device → `skipped / no-device`;
  - one send to every device of the recipient → `sent` (with the provider's reference) if any
    device accepted;
  - a token the provider calls permanently invalid is **cleared**;
  - no acceptance → `failed / invalid-token` or `failed / send-failed`.
- The push carries the notification's title and body only. Those are built from the PHI-free
  outbox payload, the same rule the email channel follows, because a lock screen is the least
  private surface the platform has.

**To go live**, decide and provide:

1. **The provider.** FCM (Android and, through APNs, iOS), APNs directly, or Expo's push
   service (the patient app is Expo-based; `patient-app/src/features/notifications/push-registration.ts`
   records the client side as not started).
2. **Its credentials**: an FCM service account, an APNs key (`.p8`) with key and team ids, or
   an Expo access token, held as deployment secrets.
3. An implementation of `PushProvider` (`src/shared/push/push.types.ts`) bound in
   `push.module.ts`. Nothing else changes.
4. **AD-1** (the patient app's blocker): notifications are addressed to a `User`. Patient
   accounts are users (ADR-030), but they are not linked to a patient record (RA-030.1), so
   clinical notifications cannot reach them yet.

**Verified:** `test/push-delivery.e2e-spec.ts`, 11 cases over HTTP and through the real
worker, with a scripted provider. **Not verified:** any real push service.

## Mail

Verified through a real SMTP exchange with the suite's sink. For a deployment, set
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM`, then send a password
reset to a real mailbox as the smoke test. The relay's TLS and authentication, and the message's
deliverability (SPF, DKIM, DMARC on the sending domain), are **not verified** here.
