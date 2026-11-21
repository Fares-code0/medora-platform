-- CreateTable
CREATE TABLE "platform_settings" (
    "key" VARCHAR(30) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform_integrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "last_sync_at" TIMESTAMPTZ(3),
    "config_enc" BYTEA,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "label" VARCHAR(120) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "label" VARCHAR(120) NOT NULL,
    "size_mb" DECIMAL(10,1) NOT NULL,
    "kind" "backup_kind" NOT NULL,
    "created_by" UUID,
    "storage_ref" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_role" VARCHAR(20),
    "category" "audit_category" NOT NULL,
    "event_type" VARCHAR(60) NOT NULL,
    "severity" "audit_severity" NOT NULL DEFAULT 'info',
    "summary" VARCHAR(300) NOT NULL,
    "target" VARCHAR(120),
    "ip_address" INET,
    "device" VARCHAR(120),
    "session_id" UUID,
    "payload" JSONB,
    "incident_ref" VARCHAR(40),

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id","occurred_at")
)
-- Hand-edited: the schema language cannot express partitioning.
--
-- DB §M1 asks for "partition by month", and ADR-007 R2 makes it
-- load-bearing rather than an optimisation: audit retention is executed
-- by dropping whole monthly partitions, never by deleting rows, because
-- the app role holds no DELETE grant on this table. Partitioning is the
-- only mechanism by which anything ever leaves it.
--
-- The primary key gained `occurred_at` for the same reason: PostgreSQL
-- requires every partition-key column in the primary key. See ADR-024.
PARTITION BY RANGE ("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_integrations_name_key" ON "platform_integrations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "backups_created_at_idx" ON "backups"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_brin_idx" ON "audit_events" USING BRIN ("occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_occurred_at_idx" ON "audit_events"("actor_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_category_severity_occurred_at_idx" ON "audit_events"("category", "severity", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_session_id_idx" ON "audit_events"("session_id");

-- CreateIndex
CREATE INDEX "audit_events_ip_address_idx" ON "audit_events"("ip_address");

-- CreateIndex
CREATE INDEX "audit_events_summary_trgm_idx" ON "audit_events" USING GIN ("summary" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_integrations" ADD CONSTRAINT "platform_integrations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backups" ADD CONSTRAINT "backups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.10).
--
-- Note what is NOT here: the BRIN index on `audit_events.occurred_at`.
-- It began as raw SQL and `migrate dev` immediately generated a
-- corrective migration dropping it — BRIN *is* expressible in the schema
-- language, so an undeclared one is drift. It is declared in
-- `11-platform.prisma` instead. ADR-023 §4's rule holds exactly: raw SQL
-- is for what Prisma cannot represent, and nothing else.
-- ─────────────────────────────────────────────────────────────────────

-- ══ 1. audit_events partitions ══════════════════════════════════════

-- Creates the monthly partition covering a given month, if absent.
-- M30's scheduled-job registry calls this ahead of time; the DEFAULT
-- partition below is what stops a missing call from losing an event.
CREATE FUNCTION create_audit_events_partition(month_start date)
RETURNS void AS $$
DECLARE
  partition_name text := 'audit_events_' || to_char(month_start, 'YYYY_MM');
BEGIN
  IF to_regclass(format('public.%I', partition_name)) IS NOT NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE TABLE %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    month_start,
    month_start + interval '1 month'
  );
END;
$$ LANGUAGE plpgsql;

-- A DEFAULT partition, and it is not a formality.
--
-- Without one, an insert whose timestamp falls outside every declared
-- range fails — and this table is the audit ledger, so a failed insert
-- means an action that happened was never recorded. Losing the event is
-- strictly worse than filing it in a catch-all, so the catch-all exists
-- and keeping it empty is the retention job's business.
CREATE TABLE audit_events_default PARTITION OF audit_events DEFAULT;

-- The current month and the eleven that follow, so a fresh deployment
-- has somewhere to write for a year without the job having run.
DO $$
DECLARE
  month_cursor date := date_trunc('month', now())::date;
BEGIN
  FOR i IN 0..11 LOOP
    PERFORM create_audit_events_partition((month_cursor + (i || ' months')::interval)::date);
  END LOOP;
END;
$$;

-- ══ 2. updated_at, maintained by the database ═══════════════════════

-- DB §2: "`updated_at` maintained by trigger".
--
-- Prisma's `@updatedAt` is applied by the *client*, so it is absent from
-- every write that does not go through it — a migration, a psql session,
-- a future service in another language. This trigger makes the column
-- true regardless of who writes the row.
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attached to every table that has the column, discovered rather than
-- listed: a hand-maintained list silently stops covering the next table
-- someone adds, which is the failure mode that matters here.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT LIKE '\_%'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      target.table_name || '_set_updated_at',
      target.table_name
    );
  END LOOP;
END;
$$;

-- ══ 3. The appointment status machine (DB §4.1, ADR-001) ════════════

-- The transition matrix, enforced at the database.
--
-- It is a **backstop**, not the primary rule: `AppointmentStatusMachine`
-- in `shared/` is where the matrix lives for the API, and it returns the
-- 409 with the `detail` API §0.3 requires. This trigger exists so that a
-- migration, a psql session or a future service cannot walk a row into a
-- state the service would have refused — the invariant belongs to the
-- data, not to one caller.
--
-- ⚠ The slot-date rule is deliberately NOT here. ADR-001 allows
-- `completed` and `no-show` only once the slot date has passed **in the
-- clinic's configured timezone**, which lives in the platform
-- localization slice. A trigger could read that row, but the comparison
-- would then depend on a table that may be empty, and a wrong timezone
-- would let a doctor mark an appointment complete a day early. The
-- service layer owns that rule, where the timezone is already resolved;
-- the trigger owns which states may follow which.
CREATE FUNCTION enforce_appointment_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('completed', 'cancelled', 'no-show') THEN
    RAISE EXCEPTION
      'illegal appointment transition: % is terminal (attempted %)', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (
    (OLD.status = 'pending'
      AND NEW.status IN ('confirmed', 'cancelled', 'scheduled', 'awaiting-patient'))
    OR (OLD.status IN ('scheduled', 'confirmed', 'rescheduled')
      AND NEW.status IN ('rescheduled', 'cancelled', 'completed', 'no-show'))
    OR (OLD.status = 'awaiting-patient'
      AND NEW.status IN ('confirmed', 'cancelled', 'rescheduled'))
  ) THEN
    RAISE EXCEPTION
      'illegal appointment transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointments_enforce_transition
  BEFORE UPDATE OF status ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION enforce_appointment_transition();

-- ══ 4. The prescription status machine (DB §4.3, ADR-002) ═══════════

CREATE FUNCTION enforce_prescription_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('completed', 'discontinued', 'expired') THEN
    RAISE EXCEPTION
      'illegal prescription transition: % is terminal (attempted %)', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- ADR-002 §3's lifecycle table, verbatim. `dispensed` is
  -- terminal-adjacent: it may expire or be discontinued, but "cannot
  -- return to `active`".
  IF NOT (
    (OLD.status = 'draft'
      AND NEW.status IN ('active', 'pending-approval', 'discontinued'))
    OR (OLD.status = 'pending-approval'
      AND NEW.status IN ('active', 'expired', 'discontinued'))
    OR (OLD.status = 'active'
      AND NEW.status IN ('dispensed', 'completed', 'expired', 'discontinued'))
    OR (OLD.status = 'dispensed'
      AND NEW.status IN ('completed', 'expired', 'discontinued'))
  ) THEN
    RAISE EXCEPTION
      'illegal prescription transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prescriptions_enforce_transition
  BEFORE UPDATE OF status ON "prescriptions"
  FOR EACH ROW EXECUTE FUNCTION enforce_prescription_transition();

-- ══ 5. has_critical_result, maintained not written ══════════════════

-- DB §E3 marks this column "derived: any result with critical flag
-- (trigger-maintained)". It is the one derived value DB §14.5-6 allows to
-- be stored, and only because the "Critical unreviewed: N" chip is a
-- partial index scan that cannot be a join.
--
-- Because it is stored, it can be wrong — so nothing writes it by hand.
-- The trigger recomputes it from the results themselves on every change,
-- which is what keeps a stored derivation honest.
CREATE FUNCTION refresh_lab_order_critical_flag() RETURNS trigger AS $$
DECLARE
  target_order uuid := COALESCE(NEW.lab_order_id, OLD.lab_order_id);
BEGIN
  UPDATE "lab_orders"
  SET "has_critical_result" = EXISTS (
    SELECT 1 FROM "lab_results"
    WHERE "lab_order_id" = target_order
      AND "flag" IN ('critical-low', 'critical-high')
      AND "deleted_at" IS NULL
  )
  WHERE "id" = target_order;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lab_results_refresh_critical_flag
  AFTER INSERT OR UPDATE OR DELETE ON "lab_results"
  FOR EACH ROW EXECUTE FUNCTION refresh_lab_order_critical_flag();

-- ══ 6. resources.status, likewise ═══════════════════════════════════

-- DB §K5 stores this "for filter parity" while noting it is derivable
-- from quantity vs reorder_level. Same rule as above: stored, therefore
-- maintained rather than written.
CREATE FUNCTION refresh_resource_status() RETURNS trigger AS $$
BEGIN
  NEW.status := CASE
    WHEN NEW.quantity = 0 THEN 'out'
    WHEN NEW.quantity <= NEW.reorder_level THEN 'low'
    ELSE 'in-stock'
  END::resource_status;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resources_refresh_status
  BEFORE INSERT OR UPDATE OF quantity, reorder_level ON "resources"
  FOR EACH ROW EXECUTE FUNCTION refresh_resource_status();

-- ══ 7. Platform tables — CHECKs ═════════════════════════════════════

-- DB §L1 — the eleven slice keys. A twelfth would be a settings panel
-- with nothing reading it, or a typo silently shadowing a real slice.
ALTER TABLE "platform_settings"
  ADD CONSTRAINT "platform_settings_key_check" CHECK ("key" IN (
    'general', 'organization', 'branding', 'localization', 'notifications',
    'security', 'email', 'sms', 'backup', 'retention', 'privacy'
  ));

-- A slice is a JSON object. An array or a scalar satisfies `jsonb` and
-- breaks every panel that reads a field out of it.
ALTER TABLE "platform_settings"
  ADD CONSTRAINT "platform_settings_value_is_object"
  CHECK (jsonb_typeof("value") = 'object');

-- DB §L4 — a backup of nothing is a failed backup recorded as a success.
ALTER TABLE "backups" ADD CONSTRAINT "backups_size_positive" CHECK ("size_mb" > 0);

-- DB §8 — live API keys. Partial, because revoked keys accumulate and
-- authentication only ever asks about the live ones.
CREATE INDEX "api_keys_live_idx" ON "api_keys" ("prefix") WHERE "revoked_at" IS NULL;
