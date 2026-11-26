-- Staff-mediated patient account linking (ADR-048; owner decision 2026-11-26,
-- RA-030.1 / OQ-02).
--
-- A patient account issues a short one-time code; hospital staff enter it at
-- the desk after checking an identity document in person, and the server
-- links the account to the clinical record in one transaction. Only the
-- SHA-256 digest of the code is stored. No email matching (ADR-030).
--
-- Identity data rather than hospital data: no hospital_id and no RLS policy,
-- the same classification as `sessions` and `otp_codes` (RLS_DESIGN.md,
-- Appendix A — Internal/system).
-- Generated DDL first, then hand-written constraints Prisma cannot express.

-- CreateTable
CREATE TABLE "patient_account_link_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_account_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_account_link_codes_user_expires_idx" ON "patient_account_link_codes"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_account_link_codes_code_hash_key" ON "patient_account_link_codes"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "patient_account_link_codes_one_live_per_user_key" ON "patient_account_link_codes"("user_id") WHERE (used_at IS NULL);

-- AddForeignKey
ALTER TABLE "patient_account_link_codes" ADD CONSTRAINT "patient_account_link_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written ─────────────────────────────────────────────────────────

-- A digest, never a code: 64 lowercase hex characters. A plaintext code
-- written here by mistake fails the insert rather than sitting in the table.
-- A code lives at most one hour (the application issues 15 minutes), and is
-- used no earlier than it was created.
ALTER TABLE "patient_account_link_codes"
  ADD CONSTRAINT "patient_account_link_codes_code_hash_check" CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "patient_account_link_codes_expiry_check"
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour'),
  ADD CONSTRAINT "patient_account_link_codes_used_check" CHECK (used_at IS NULL OR used_at >= created_at);
