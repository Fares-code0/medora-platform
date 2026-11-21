-- CreateTable
CREATE TABLE "patient_access_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "grantee_user_id" UUID,
    "grantee_role_id" UUID,
    "scope" VARCHAR(30) NOT NULL,
    "reason" TEXT NOT NULL,
    "granted_by" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patient_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_bookmarks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "event_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "incident_ref" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incident_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requested_by" UUID NOT NULL,
    "category" "report_category" NOT NULL,
    "format" "export_format" NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "file_id" UUID,
    "error" TEXT,
    "watermark_ref" VARCHAR(40),
    "filters" JSONB NOT NULL DEFAULT '{}',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "provider_ref" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_access_grants_patient_id_idx" ON "patient_access_grants"("patient_id");

-- CreateIndex
CREATE INDEX "patient_access_grants_grantee_user_id_idx" ON "patient_access_grants"("grantee_user_id");

-- CreateIndex
CREATE INDEX "incident_bookmarks_incident_ref_idx" ON "incident_bookmarks"("incident_ref");

-- CreateIndex
CREATE UNIQUE INDEX "incident_bookmarks_owner_id_name_key" ON "incident_bookmarks"("owner_id", "name");

-- CreateIndex
CREATE INDEX "report_exports_requested_by_requested_at_idx" ON "report_exports"("requested_by", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "report_exports_status_idx" ON "report_exports"("status");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_key" ON "notification_deliveries"("notification_id", "channel");

-- AddForeignKey
ALTER TABLE "patient_access_grants" ADD CONSTRAINT "patient_access_grants_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_access_grants" ADD CONSTRAINT "patient_access_grants_grantee_user_id_fkey" FOREIGN KEY ("grantee_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_access_grants" ADD CONSTRAINT "patient_access_grants_grantee_role_id_fkey" FOREIGN KEY ("grantee_role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_access_grants" ADD CONSTRAINT "patient_access_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_access_grants" ADD CONSTRAINT "patient_access_grants_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_bookmarks" ADD CONSTRAINT "incident_bookmarks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.11).

-- A grant names a user or a role, never both and never neither.
-- Both is ambiguous about who it applies to; neither applies to nobody
-- while still appearing in the UX §3.4 grid as though it did.
ALTER TABLE "patient_access_grants"
  ADD CONSTRAINT "patient_access_grants_one_grantee"
  CHECK (num_nonnulls("grantee_user_id", "grantee_role_id") = 1);

ALTER TABLE "patient_access_grants"
  ADD CONSTRAINT "patient_access_grants_scope_check"
  CHECK ("scope" IN ('view', 'reveal_identity', 'manage'));

-- A revocation names its revoker, and a revoker implies a revocation.
ALTER TABLE "patient_access_grants"
  ADD CONSTRAINT "patient_access_grants_revoked_by_iff_revoked"
  CHECK (("revoked_at" IS NULL) = ("revoked_by" IS NULL));

-- An expiry before the grant makes the grant dead on arrival — which
-- reads in the grid as an active grant nobody can use.
ALTER TABLE "patient_access_grants"
  ADD CONSTRAINT "patient_access_grants_expires_after_granted"
  CHECK ("expires_at" IS NULL OR "expires_at" > "granted_at");

-- The live-grant lookup, which is the only question authorization asks.
CREATE INDEX "patient_access_grants_live_idx"
  ON "patient_access_grants" ("patient_id", "grantee_user_id")
  WHERE "revoked_at" IS NULL;

-- ADR-010 group 15 — the export lifecycle.
ALTER TABLE "report_exports"
  ADD CONSTRAINT "report_exports_status_check"
  CHECK ("status" IN ('queued', 'running', 'ready', 'failed'));

-- A ready export has an artefact and a completion time; a failed one has
-- an error. Without this a "ready" row can point at no file, which the
-- download endpoint would answer with a 500 rather than a useful state.
ALTER TABLE "report_exports"
  ADD CONSTRAINT "report_exports_ready_has_file"
  CHECK ("status" <> 'ready' OR ("file_id" IS NOT NULL AND "completed_at" IS NOT NULL));
ALTER TABLE "report_exports"
  ADD CONSTRAINT "report_exports_failed_has_error"
  CHECK ("status" <> 'failed' OR "error" IS NOT NULL);

-- ADR-010 group 7 — the delivery lifecycle.
--
-- `skipped` is a real outcome rather than an absence: quiet hours and a
-- per-category opt-out both suppress a channel deliberately, and no row
-- at all would read as "never attempted" in the UX §3.5 receipts drawer.
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_status_check"
  CHECK ("status" IN ('pending', 'sent', 'delivered', 'failed', 'skipped'));

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_attempts_non_negative"
  CHECK ("attempts" >= 0);

-- A delivered notification records when. Anything else must not.
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_delivered_at_iff_delivered"
  CHECK (("status" = 'delivered') = ("delivered_at" IS NOT NULL));
