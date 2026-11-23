import { z } from 'zod';

import { parseTrustProxy } from './trust-proxy';

/**
 * The environment contract (RM M3.1).
 *
 * Every variable the application reads is declared here, and nothing
 * reads `process.env` outside this folder. A configuration mistake then
 * has exactly one failure mode — the process refuses to start and says
 * which variable is wrong — instead of surfacing hours later as an
 * `undefined` in a connection string.
 *
 * Two rules shape the schema:
 *
 *  1. **A default is only supplied when the value is genuinely safe
 *     everywhere.** Ports and TTLs have defaults; secrets and
 *     connection strings do not. A `DATABASE_URL` that silently defaults
 *     to localhost is how a staging box ends up talking to nothing.
 *  2. **Production tightens, never loosens** — see `productionRules`.
 */

export const APP_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

/**
 * Env values are always strings. `z.coerce.boolean()` is unusable here —
 * it treats the string `'false'` as true, which is the opposite of what
 * anyone writing `S3_FORCE_PATH_STYLE=false` means.
 */
const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int().positive();

/**
 * A bare hostname or IP, for a variable whose port lives in another one.
 * A URL or a `host:port` is refused at boot: the clients reading these
 * look the whole value up as a hostname and fail with `ENOTFOUND`, which
 * the mail and scanner ports both absorb by design — so the mistake would
 * otherwise surface only as a log line. IPv6 literals (`::1`) have more
 * than one colon and still pass.
 */
function bareHost(portVariable: string, example: string) {
  return z
    .string()
    .min(1)
    .refine((value) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(value), {
      message: `must be a hostname, not a URL — e.g. ${example}`,
    })
    .refine((value) => !/^[^:]+:\d+$/.test(value), {
      message: `must not include a port — put the port in ${portVariable}`,
    });
}

/** A JWT signing key short enough to brute force is not a secret. */
const MIN_SECRET_LENGTH = 32;

/** AES-256-GCM — the envelope cipher of `DATA_ENCRYPTION_KEY`. */
const AES_KEY_BYTES = 32;

/**
 * Byte length of a base64 string, or `-1` when it is not base64 at all.
 *
 * `Buffer.from(value, 'base64')` never throws — it skips characters it
 * does not recognise — so a 44-character passphrase would decode to
 * *some* buffer and could pass a naive length check. Re-encoding and
 * comparing is what makes the check mean "this is base64 for 32 bytes"
 * rather than "this is 44-ish characters".
 */
function decodedByteLength(value: string): number {
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded.byteLength : -1;
}

/**
 * MG §11.1-1 fixes the access token at **≤15 minutes**. It is a ceiling,
 * not a default, so the schema rejects a longer one rather than quietly
 * accepting it — a 24-hour access token would make the whole refresh
 * design pointless and nothing else in the system would notice.
 */
const MAX_ACCESS_TTL_SECONDS = 900;

export const envSchema = z.object({
  // ── Runtime ──────────────────────────────────────────────────────────
  APP_ENV: z.enum(APP_ENVS).default('development'),
  PORT: port.default(3000),
  /**
   * Left without a default on purpose: the sensible level depends on
   * `APP_ENV` (debug locally, info elsewhere), and that decision lives
   * with the logger. The schema's job here is to reject `LOG_LEVEL=loud`,
   * not to choose.
   */
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),

  /**
   * Comma-separated exact origins. A wildcard is invalid with
   * credentialed CORS, which the httpOnly refresh cookie requires
   * (ADR-011), so this is never `*`.
   */
  CORS_ORIGINS: z.string().min(1),

  // ── Datastores (M4, M31) ─────────────────────────────────────────────
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // ── Object storage (M25) ─────────────────────────────────────────────
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  /** MinIO needs path-style addressing; real S3 does not. */
  S3_FORCE_PATH_STYLE: booleanish.default(true),

  // ── Auth (M6) ────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(MIN_SECRET_LENGTH),
  JWT_ACCESS_TTL: positiveInt.max(MAX_ACCESS_TTL_SECONDS).default(900),
  /** API §1.2 — "remember me" is 30 days. */
  REFRESH_TTL_REMEMBER: positiveInt.default(2_592_000),
  /** API §1.2 — a plain session is 12 hours. */
  REFRESH_TTL_DEFAULT: positiveInt.default(43_200),
  COOKIE_DOMAIN: z.string().min(1),

  /**
   * Where the **web application** is served (M6.1).
   *
   * The verification and password-reset links land on frontend routes —
   * `/verify-email?token=…`, `/reset-password?token=…` — not on the API,
   * so the API cannot build them from its own address. No default: a
   * link that silently points at localhost is a reset email nobody can
   * use, and the failure appears in someone's inbox rather than in a log.
   */
  APP_PUBLIC_URL: z.string().url(),

  /**
   * The envelope key for application-layer encryption at rest (M6.4).
   *
   * Today it protects the TOTP secret and the recovery codes on
   * `user_credentials`, which DB §10 classes "never in API responses".
   * Separate from `JWT_SECRET` on purpose: signing keys get rotated on a
   * schedule, and rotating a key that also encrypts stored ciphertext
   * would make every stored second factor undecryptable.
   */
  DATA_ENCRYPTION_KEY: z
    .string()
    .min(MIN_SECRET_LENGTH)
    .refine((value) => decodedByteLength(value) === AES_KEY_BYTES, {
      message: `must be base64 for exactly ${String(AES_KEY_BYTES)} bytes — generate one with \`openssl rand -base64 32\``,
    }),
  /**
   * Envelope keys that may **decrypt**, never encrypt (M37, key rotation
   * — `PRODUCTION_SETUP.md` §2.1). Comma-separated, each base64 for 32
   * bytes. Unset or empty is the normal state.
   *
   * Set only during a rotation, and in the order §2.1 gives so a rolling
   * restart never has an instance that cannot read another's writes:
   * first the **next** key goes here while the old one stays current
   * (pre-staging), then the two swap, `npm run crypto:reencrypt` re-seals
   * every envelope under the new key, and this is emptied only after that
   * command exits 0. A key here that is also the current key is refused —
   * it would make the re-encryption report a rotation that never happened.
   */
  DATA_ENCRYPTION_KEY_PREVIOUS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .superRefine((keys, ctx) => {
      keys.forEach((key, index) => {
        if (decodedByteLength(key) !== AES_KEY_BYTES) {
          ctx.addIssue({
            code: 'custom',
            message: `entry ${String(index + 1)} must be base64 for exactly ${String(AES_KEY_BYTES)} bytes`,
          });
        }
        if (keys.indexOf(key) !== index) {
          ctx.addIssue({
            code: 'custom',
            message: `entry ${String(index + 1)} repeats an earlier entry`,
          });
        }
      });
    }),

  /**
   * Which envelope layout this instance **writes** (review finding F2).
   * Both are always read.
   *
   * `legacy` (the default) is the layout every earlier build reads, so a
   * rolling deploy and a rollback stay safe: no older instance meets a
   * second factor it cannot open. `keyed` adds a key id; set it only once
   * no build older than the keyring will serve again, and set it back to
   * `legacy` and run `npm run crypto:reencrypt` before any such rollback
   * (`PRODUCTION_SETUP.md` §2.1).
   */
  DATA_ENCRYPTION_WRITE_FORMAT: z.enum(['legacy', 'keyed']).default('legacy'),

  // ── Mail (M19) ───────────────────────────────────────────────────────
  /**
   * A bare hostname or IP. The port is `SMTP_PORT`, never part of this.
   *
   * Refused at boot because nodemailer does not refuse it:
   * `SMTP_HOST=localhost:1025` is looked up as a hostname, fails with
   * `ENOTFOUND`, and the mailer port swallows delivery failures by design
   * (`shared/mail/mail.types.ts`). Registration then answers 201, nothing
   * reaches mailhog, and the only trace is one log line. IPv6 literals
   * (`::1`) have more than one colon and still pass.
   */
  SMTP_HOST: bareHost('SMTP_PORT', '`localhost`, or `mailhog` inside compose'),
  SMTP_PORT: port.default(1025),
  /** Blank in development: mailhog accepts unauthenticated mail. */
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().min(1),

  // ── Malware scanning (M25.3) ────────────────────────────────────────
  /**
   * The clamd daemon `files.malware-scan` streams uploads to. **Unset, no
   * engine is bound**: every file stays `pending` and undownloadable,
   * which is the gate working (RA-M30.2). An empty value is unset.
   */
  CLAMAV_HOST: z.preprocess(
    (value) => (value === '' ? undefined : value),
    bareHost('CLAMAV_PORT', '`localhost`, or `clamav` inside compose').optional(),
  ),
  CLAMAV_PORT: port.default(3310),
  /** One file's scan, connection to verdict (ms); past it the file stays `pending`. */
  CLAMAV_TIMEOUT_MS: positiveInt.default(30_000),

  // ── SMS (M19) ────────────────────────────────────────────────────────
  SMS_PROVIDER: z.string().default('stub'),
  SMS_API_KEY: z.string().optional(),

  // ── AI provider (M16) ────────────────────────────────────────────────
  // Optional throughout: the AI gateway is the only consumer and it does
  // not exist until M16. `/health` reports `ai: unconfigured` until then.
  AI_PROVIDER: z.string().optional(),
  AI_API_KEY: z.string().optional(),

  // ── Communication content-access policy (ADR-006, M20.7) ─────────────
  // Second-admin approval: the project owner decided **self-serve plus a
  // complete audit trail** on 2026-08-12, and required the flow stay
  // policy-driven so the requirement can be switched on later. Both modes
  // are implemented; neither is hard-coded. RA-006.2 carries the matching
  // platform-settings field to M24.2, and this env layer is what
  // `PolicyService` resolves under it until then.
  COMMUNICATION_REQUIRE_SECOND_ADMIN_APPROVAL: booleanish.default(false),
  /**
   * How long a content-access grant stays active, in minutes.
   *
   * **Deliberately without a default.** ADR-006 §4 requires grants to
   * expire, and **RA-006.3 records that no source gives a duration** —
   * the ADR names the 15-minute PHI identity-reveal window as a
   * precedent and says in the same breath that whether it suits message
   * content "is a product question. Not decided."
   *
   * So the value is optional here and the grant endpoint fails closed
   * without it, rather than this file quietly inventing the most
   * privacy-sensitive timeout in the platform. Setting it is a
   * deployment decision an owner can make today; guessing it is not one
   * this schema may make for them.
   */
  COMMUNICATION_GRANT_TTL_MINUTES: z.preprocess(
    // An empty value means "not set", not "zero". `.env.example`
    // documents the key with no value precisely so a deployment sees it
    // and must choose — and `z.coerce.number()` would read that empty
    // string as 0, failing the positive check with a message about a
    // number nobody wrote.
    (value) => (value === '' || value === undefined ? undefined : value),
    positiveInt.optional(),
  ),

  // ── Security policy defaults (M3.3) ──────────────────────────────────
  // These are the env layer of the policy `PolicyService` resolves; M24's
  // platform-settings row overrides them. The default values are the
  // frontend's seeded `SecurityPolicySettings`
  // (`features/admin/admin-settings.api.ts`), because per the
  // source-of-truth hierarchy the frontend seed *is* the contract — a
  // backend that defaults differently would silently change the policy
  // an administrator already sees in the panel.
  SECURITY_TWO_FACTOR_REQUIRED: booleanish.default(false),
  SECURITY_PASSWORD_EXPIRY_DAYS: positiveInt.default(180),
  SECURITY_SESSION_TIMEOUT_MINUTES: positiveInt.default(30),
  SECURITY_LOGIN_ATTEMPT_LIMIT: positiveInt.default(5),
  SECURITY_SINGLE_SESSION_PER_USER: booleanish.default(false),
  /**
   * How long a lockout lasts once `SECURITY_LOGIN_ATTEMPT_LIMIT`
   * consecutive failures are reached (M6.2).
   *
   * **No upstream source states this number.** MG §11.1-8 and the
   * frontend's `SecurityPolicySettings` give the *count* and nothing
   * else, so the duration is a backend default rather than a
   * transcription — recorded as such in ADR-025, and layered through
   * `PolicyService` like the five that do have a panel field, so the day
   * one appears no enforcement code changes.
   */
  SECURITY_LOCKOUT_MINUTES: positiveInt.default(15),

  // ── Platform mode (M24.6) ────────────────────────────────────────────
  // The maintenance flag lives in the `general` platform-settings slice
  // and is layered over these exactly as the security policy is. They
  // exist for the reason ADR-020 §4 gives for the five `SECURITY_*`
  // variables: M3.3 cannot layer a database value over a default that
  // does not exist, and a policy key with no env layer would be
  // undefined on a platform whose settings row has not been seeded.
  //
  // The middleware that turns this into a 503 for non-admin requests is
  // **M38.3**. Reading it here is what makes that middleware a lookup
  // rather than a second configuration path.
  MAINTENANCE_MODE: booleanish.default(false),
  MAINTENANCE_MESSAGE: z.string().max(300).default(''),

  // ── Background jobs (M30.1) ────────────────────────────────────────
  /**
   * Whether this instance *fires* the schedules.
   *
   * On by default: an operator who deploys without setting anything gets
   * the retention purge and the notification drains running, which is
   * the safe failure. The variable exists for the two cases where that
   * is wrong — a test process, which declares the registry and drives it
   * by hand, and a replica that serves requests while a dedicated worker
   * owns the sweeps. It never suppresses *registration*; see
   * `JobsBootstrap`.
   */
  JOBS_ENABLED: booleanish.default(true),
  /**
   * Where a due job runs.
   *
   * `inline` keeps the schedules on this process's own timers; `bullmq`
   * hands them to Redis so that N replicas fire each schedule once. The
   * default is `inline` because requiring a broker to boot would mean
   * requiring one to run the test suite, and every registered job is an
   * idempotent sweep — the broker buys single-firing, not correctness.
   */
  JOBS_DRIVER: z.enum(['inline', 'bullmq']).default('inline'),
  /**
   * How often every API instance clears lapsed refresh successors
   * (ADR-045, RA-045.2), in seconds.
   *
   * Deliberately **not** governed by `JOBS_ENABLED`/`JOBS_DRIVER`: those
   * may legitimately be off on every instance, and this bounds how long an
   * encrypted live refresh token stays at rest. So it cannot be turned off,
   * only tuned within 5–60 s; the ceiling is what makes ADR-045's stated
   * bound (30 s window + this interval + latency) true.
   */
  REFRESH_SUCCESSOR_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(60).default(30),

  // ── Client address and rate limiting (M37.2) ───────────────────────
  /**
   * Which proxy hops' `X-Forwarded-For` to believe. Empty trusts none, and
   * `true` is refused — see `trust-proxy.ts`. **Must be set from the
   * deployment's real proxy topology** before `req.ip` (audit rows,
   * `login_events`, the rate limit) means anything behind a load balancer.
   */
  TRUST_PROXY: z
    .string()
    .default('')
    .superRefine((value, ctx) => {
      const parsed = parseTrustProxy(value);
      if (typeof parsed === 'object' && 'error' in parsed) {
        ctx.addIssue({ code: 'custom', message: parsed.error });
      }
    }),
  /**
   * The per-client limit on the public credential routes (login, OTP,
   * registration, recovery, verification, invitation acceptance).
   *
   * **Off by default** until the deployment's proxy is verified: it keys on
   * `req.ip`, and with `TRUST_PROXY` unset behind a load balancer every
   * client is the balancer, so one limit would throttle everyone together.
   * The per-account controls (login lockout, OTP attempts, mail cooldowns)
   * do not depend on it and are always on.
   *
   * The numbers are guardrails, not product rules — the same footing as
   * the upload limits (`file-policy.ts`): no source states them.
   */
  RATE_LIMIT_ENABLED: booleanish.default(false),
  RATE_LIMIT_AUTH_MAX: positiveInt.default(20),
  RATE_LIMIT_AUTH_WINDOW_SECONDS: positiveInt.default(60),

  // ── Phase 22 hospital scope, shadow mode ────────────────────────────
  /**
   * Whether `PatientScopeService` also computes the hospital-aware shadow
   * decision and logs divergence from the legacy decision. Observation
   * only: on or off, the legacy rule alone grants or refuses access. On
   * costs at most one hospital-context query per request and one
   * assignment-scope query per (doctor, patient) per request; off costs
   * nothing (PHASE22_BACKEND_HANDOFF.md, correction 3). `GET /auth/session`
   * reports the hospital context either way.
   */
  HOSPITAL_SCOPE_SHADOW_COMPARISON: booleanish.default(true),

  // ── Metrics (M38.1) ─────────────────────────────────────────────────
  /**
   * The bearer token `GET /metrics` requires. **Unset, the endpoint does
   * not exist** (404): request counts by route and process memory are
   * operational detail no anonymous caller should read, and a scraper is
   * configured with a token anyway. 32+ characters, like the other secrets;
   * an empty value is unset, which is what `METRICS_TOKEN=` means.
   */
  METRICS_TOKEN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(MIN_SECRET_LENGTH).optional(),
  ),

  // ── Retention (M28.5) ────────────────────────────────────────────────
  // The env layer under the `retention` slice's `auditLogDays`, which
  // M28.5's partition sweep enforces. 365 is ADR-007 R1's established
  // value, transcribed from the seeded slice rather than chosen — the
  // same relationship the five SECURITY_* defaults have to the security
  // panel.
  RETENTION_AUDIT_LOG_DAYS: positiveInt.default(365),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Values that ship in `.env.example` so a developer can boot in one
 * step. Every one of them is a security hole in production, so
 * `productionRules` rejects them there.
 */
const DEVELOPMENT_PLACEHOLDERS = ['replace-me', 'medora-dev-secret', 'changeme'];

/**
 * Checks that apply only when `APP_ENV=production`.
 *
 * Development deliberately ships working defaults — the alternative is a
 * README step everyone skips. The cost of that convenience is that the
 * placeholder values must be impossible to deploy, which is what this
 * does. A production boot with the example secret fails here rather than
 * becoming an incident later.
 */
export function productionRules(env: Env, ctx: z.RefinementCtx): void {
  if (env.APP_ENV !== 'production') return;

  const isPlaceholder = (value: string): boolean =>
    DEVELOPMENT_PLACEHOLDERS.some((placeholder) => value.toLowerCase().includes(placeholder));

  // M25's exit gate is "all uploads scanned". Without an engine nothing
  // is unsafe — every file stays `pending` and undownloadable — but a
  // clinic would find that out from its doctors, one attachment at a time.
  if (env.CLAMAV_HOST === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['CLAMAV_HOST'],
      message:
        'is required in production — without a scan engine no upload can ever be downloaded (M25.3)',
    });
  }

  if (isPlaceholder(env.JWT_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'is still the example placeholder — generate one with `openssl rand -base64 48`',
    });
  }

  // Decoded, not raw: the example key is base64 (the schema requires it),
  // so the recognisable placeholder text is inside the encoding rather
  // than in the variable's value. `.env.example` ships base64 for the
  // literal string `replace-me-with-openssl-rand-b64`.
  if (isPlaceholder(Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64').toString('utf8'))) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATA_ENCRYPTION_KEY'],
      message: 'is still the example placeholder — generate one with `openssl rand -base64 32`',
    });
  }

  // The links in verification and reset emails are built from this. A
  // localhost value in production sends every user a dead link.
  if (env.APP_PUBLIC_URL.includes('localhost')) {
    ctx.addIssue({
      code: 'custom',
      path: ['APP_PUBLIC_URL'],
      message: 'cannot point at localhost in production — auth emails link to it',
    });
  }

  if (isPlaceholder(env.S3_SECRET_ACCESS_KEY)) {
    ctx.addIssue({
      code: 'custom',
      path: ['S3_SECRET_ACCESS_KEY'],
      message: 'is still the example placeholder',
    });
  }

  // A refresh cookie scoped to `localhost` is never sent to the real
  // origin, so silent refresh fails for every user (ADR-011).
  if (env.COOKIE_DOMAIN === 'localhost') {
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_DOMAIN'],
      message: 'cannot be `localhost` in production',
    });
  }

  if (env.CORS_ORIGINS.includes('localhost')) {
    ctx.addIssue({
      code: 'custom',
      path: ['CORS_ORIGINS'],
      message: 'contains a localhost origin, which must not be allowed in production',
    });
  }

  // Not a hard requirement anywhere, but an unauthenticated relay that
  // works in production is almost always a misconfiguration pointing at
  // the development mailhog.
  if (env.SMTP_USER === undefined || env.SMTP_USER.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['SMTP_USER'],
      message:
        'is required in production — an unauthenticated SMTP relay is a development-only setup',
    });
  }
}

/**
 * Checks across variables that hold in every environment.
 *
 * The current envelope key listed again as a previous one decrypts
 * nothing extra, but it makes a half-done rotation look finished: the
 * operator who set the new key in both places would see the re-encryption
 * report "nothing to re-seal" over ciphertext still under the old key.
 */
export function crossRules(env: Env, ctx: z.RefinementCtx): void {
  const current = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  env.DATA_ENCRYPTION_KEY_PREVIOUS.forEach((key, index) => {
    if (Buffer.from(key, 'base64').equals(current)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_ENCRYPTION_KEY_PREVIOUS'],
        message: `entry ${String(index + 1)} is the current DATA_ENCRYPTION_KEY — a previous key must be a different, retired key`,
      });
    }
  });
}

export const productionEnvSchema = envSchema.superRefine((env, ctx) => {
  crossRules(env, ctx);
  productionRules(env, ctx);
});
