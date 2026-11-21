-- `Idempotency-Key` replays (ADR-014; API §0.5; MG §8.4).
--
-- One row per (user, key): the first request with a key executes and its
-- response is stored; a replay within the 24 h window returns the stored
-- response without executing again. Rows past `expires_at` are deleted by
-- the `idempotency.expiry-sweep` job.
--
-- Additive only: a new table, its indexes and its foreign key. No existing
-- table, column or row is touched.

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "endpoint" VARCHAR(300) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
    -- The two states the interceptor writes. Prisma cannot declare a CHECK,
    -- so it lives here, as for every other closed varchar in the schema.
    CONSTRAINT "idempotency_records_status_check" CHECK ("status" IN ('in_progress', 'completed')),
    -- A completed row says when it completed.
    CONSTRAINT "idempotency_records_completed_stamped" CHECK (
        "status" <> 'completed' OR "completed_at" IS NOT NULL
    )
);

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_user_id_key_key" ON "idempotency_records"("user_id", "key");

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
