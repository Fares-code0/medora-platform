-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(40) NOT NULL,
    "first_name" VARCHAR(60) NOT NULL,
    "last_name" VARCHAR(60) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "email" CITEXT NOT NULL,
    "username" VARCHAR(30),
    "phone" VARCHAR(30) NOT NULL,
    "role_id" UUID NOT NULL,
    "email_verified_at" TIMESTAMPTZ(3),
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "user_status" NOT NULL DEFAULT 'active',
    "license_number" VARCHAR(40),
    "terms_accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "privacy_accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "last_active_at" TIMESTAMPTZ(3),
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "totp_secret_enc" BYTEA,
    "recovery_codes_enc" BYTEA,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "remember_me" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "device" VARCHAR(120),
    "browser" VARCHAR(80),
    "ip_address" INET,
    "location" VARCHAR(120),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "platform" "device_platform" NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "attempted_email" CITEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device" VARCHAR(120),
    "ip_address" INET,
    "location" VARCHAR(120),
    "result" "login_result" NOT NULL,
    "failure_code" VARCHAR(30),
    "anomaly_flag" VARCHAR(40),

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" "token_kind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "channel" VARCHAR(10) NOT NULL DEFAULT 'app',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_activity_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "activity_kind" NOT NULL,
    "summary" VARCHAR(200) NOT NULL,
    "detail" TEXT,

    CONSTRAINT "user_activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_public_id_key" ON "users"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE INDEX "user_permissions_permission_id_idx" ON "user_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "trusted_devices_user_id_idx" ON "trusted_devices"("user_id");

-- CreateIndex
CREATE INDEX "login_events_user_id_occurred_at_idx" ON "login_events"("user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "login_events_result_occurred_at_idx" ON "login_events"("result", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_kind_idx" ON "verification_tokens"("user_id", "kind");

-- CreateIndex
CREATE INDEX "verification_tokens_expires_at_idx" ON "verification_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "otp_codes_user_id_expires_at_idx" ON "otp_codes"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "user_activity_log_user_id_occurred_at_idx" ON "user_activity_log"("user_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_activity_log" ADD CONSTRAINT "user_activity_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.2).
--
-- What the drift check does and does not protect was measured during
-- M5.1 and M5.2 rather than assumed (ADR-023 §4). The boundary is exact:
-- `prisma migrate diff` compares what the Prisma schema language can
-- represent, and skips what it cannot.
--
--   NOT SEEN — safe to write here, and held by tests instead:
--     CHECK constraints · triggers and functions · PARTIAL indexes
--   SEEN — must be declared in the schema or it is reported as drift:
--     tables · columns · types · defaults (a generated column reads as
--     one) · ORDINARY indexes, including unique ones
--
-- Proven both ways on this very migration: adding a partial index gave
-- "No difference detected", and adding a plain index on the same table
-- immediately reported "Removed index on columns (browser)".

-- DB §8 — the live-session lookup, partial on the predicate that every
-- one of its callers carries. "Sign out all other sessions", the
-- single-session policy check and the active-session list all ask for a
-- user's *unrevoked* sessions; revoked rows accumulate forever and would
-- otherwise sit in the index that question uses.
CREATE INDEX "sessions_user_id_live_idx"
  ON "sessions" ("user_id") WHERE "revoked_at" IS NULL;

-- `otp_codes.channel` — DB §A11 types this varchar(10) and §6 lists no
-- enum for it, so the vocabulary is closed here instead.
ALTER TABLE "otp_codes"
  ADD CONSTRAINT "otp_codes_channel_check" CHECK ("channel" IN ('app', 'sms', 'email'));

-- Counters cannot go negative. A negative `failed_attempts` would compare
-- as *below* the lockout limit forever, which turns a decrement bug into
-- an account that can never be locked.
ALTER TABLE "otp_codes"
  ADD CONSTRAINT "otp_codes_attempts_non_negative" CHECK ("attempts" >= 0);
ALTER TABLE "user_credentials"
  ADD CONSTRAINT "user_credentials_failed_attempts_non_negative" CHECK ("failed_attempts" >= 0);

-- A session that expires before it starts is not a short session, it is a
-- clock or a TTL bug, and it would authenticate nobody while looking
-- valid in the table.
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_expires_after_start" CHECK ("expires_at" > "started_at");

-- Same for the single-use tokens: an already-expired token is never
-- usable, so issuing one silently breaks the flow that issued it.
ALTER TABLE "verification_tokens"
  ADD CONSTRAINT "verification_tokens_expires_after_creation" CHECK ("expires_at" > "created_at");
ALTER TABLE "otp_codes"
  ADD CONSTRAINT "otp_codes_expires_after_creation" CHECK ("expires_at" > "created_at");

-- DB §A4: `public_id` carries the `usr_` prefix the frontend already
-- shows. Enforced because it is a client-facing identifier — a row that
-- silently lacks the prefix produces a link that resolves nowhere.
ALTER TABLE "users"
  ADD CONSTRAINT "users_public_id_prefix" CHECK ("public_id" LIKE 'usr\_%');

-- DB §A4: username 3–30 chars matching the account schema's pattern.
-- The length is already the column type; the shape is not.
ALTER TABLE "users"
  ADD CONSTRAINT "users_username_shape"
  CHECK ("username" IS NULL OR "username" ~ '^[A-Za-z0-9._-]{3,30}$');
