-- M19.1 — the transactional outbox (ADR-019 §4 defined the port; this is
-- the durable store behind it).
--
-- Replaces the M2 log-and-discard stub. Rows are written inside the
-- caller's transaction, so an event and the fact it announces commit or
-- roll back together. Draining into BullMQ is M30.1.

CREATE TABLE "domain_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "topic" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupe_key" VARCHAR(200),
    "correlation_id" VARCHAR(64),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "delivered_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- The vocabulary is closed in the database, not only in TypeScript: a
-- second writer (a worker, a migration, a fix-up script) cannot invent a
-- fourth status that the drain would then skip forever.
ALTER TABLE "domain_events"
    ADD CONSTRAINT "domain_events_status_check"
    CHECK ("status" IN ('pending', 'delivered', 'failed'));

-- At-least-once delivery means publishers retry. A plain UNIQUE on a
-- nullable column is exactly the rule wanted: every message that names a
-- key is deduplicated, and one that declines to name one never is,
-- because Postgres permits many NULLs in a unique index.
CREATE UNIQUE INDEX "domain_events_dedupe_key_key" ON "domain_events"("dedupe_key");

-- The drain's access pattern: oldest pending first (M30.1, SKIP LOCKED).
CREATE INDEX "domain_events_status_created_at_idx" ON "domain_events"("status", "created_at");
