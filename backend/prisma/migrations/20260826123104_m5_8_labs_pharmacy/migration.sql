-- CreateTable
CREATE TABLE "lab_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(20) NOT NULL,
    "patient_id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "department_id" UUID,
    "ordered_by" UUID NOT NULL,
    "clinical_indication" VARCHAR(300) NOT NULL,
    "status" "lab_status" NOT NULL DEFAULT 'ordered',
    "priority" "lab_priority" NOT NULL DEFAULT 'routine',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collected_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "interpretation" TEXT,
    "has_critical_result" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "lab_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_specimens" (
    "lab_order_id" UUID NOT NULL,
    "type" "lab_specimen_type" NOT NULL,
    "container" VARCHAR(60) NOT NULL,
    "collection_site" VARCHAR(80) NOT NULL,
    "collected_by" VARCHAR(120) NOT NULL,
    "collected_by_id" UUID,
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3),
    "condition" "lab_specimen_condition" NOT NULL DEFAULT 'Acceptable',
    "volume" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lab_specimens_pkey" PRIMARY KEY ("lab_order_id")
);

-- CreateTable
CREATE TABLE "lab_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lab_order_id" UUID NOT NULL,
    "analyte_spec_id" UUID,
    "analyte" VARCHAR(80) NOT NULL,
    "value_text" VARCHAR(60) NOT NULL,
    "value_numeric" DECIMAL(12,3),
    "unit" VARCHAR(20) NOT NULL,
    "ref_low" DECIMAL(10,3),
    "ref_high" DECIMAL(10,3),
    "ref_text" VARCHAR(60) NOT NULL,
    "flag" "lab_result_flag" NOT NULL DEFAULT 'normal',
    "resulted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "lab_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lab_order_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "kind" "lab_attachment_kind" NOT NULL,
    "size_kb" INTEGER NOT NULL,
    "file_id" UUID NOT NULL,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "lab_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_timeline_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lab_order_id" UUID NOT NULL,
    "kind" "lab_timeline_kind" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" VARCHAR(120) NOT NULL,
    "actor_id" UUID,
    "detail" VARCHAR(300),

    CONSTRAINT "lab_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(20) NOT NULL,
    "patient_id" UUID NOT NULL,
    "medication_id" UUID NOT NULL,
    "prescribing_doctor_id" UUID NOT NULL,
    "department_id" UUID,
    "record_id" UUID,
    "strength" VARCHAR(30) NOT NULL,
    "dosage" VARCHAR(60) NOT NULL,
    "frequency" VARCHAR(60) NOT NULL,
    "route" "medication_route" NOT NULL,
    "duration_days" SMALLINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL,
    "status" "prescription_status" NOT NULL DEFAULT 'draft',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "refills_allowed" SMALLINT NOT NULL DEFAULT 0,
    "refills_remaining" SMALLINT NOT NULL DEFAULT 0,
    "refill_status" "refill_status" NOT NULL DEFAULT 'none',
    "signed_at" TIMESTAMPTZ(3),
    "discontinued_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_safety_warnings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prescription_id" UUID NOT NULL,
    "kind" "safety_warning_kind" NOT NULL,
    "severity" "safety_warning_severity" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "detail" TEXT NOT NULL,
    "acknowledged_by" UUID,
    "acknowledged_reason" VARCHAR(300),
    "acknowledged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prescription_safety_warnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prescription_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "authored_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "prescription_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_history_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prescription_id" UUID NOT NULL,
    "occurred_on" DATE NOT NULL,
    "event" VARCHAR(120) NOT NULL,
    "detail" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_history_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_timeline_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prescription_id" UUID NOT NULL,
    "kind" "prescription_timeline_kind" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_name" VARCHAR(120),
    "detail" VARCHAR(300),

    CONSTRAINT "prescription_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_public_id_key" ON "lab_orders"("public_id");

-- CreateIndex
CREATE INDEX "lab_orders_patient_id_requested_at_idx" ON "lab_orders"("patient_id", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "lab_orders_status_priority_idx" ON "lab_orders"("status", "priority");

-- CreateIndex
CREATE INDEX "lab_orders_ordered_by_idx" ON "lab_orders"("ordered_by");

-- CreateIndex
CREATE INDEX "lab_orders_deleted_at_idx" ON "lab_orders"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_results_analyte_resulted_at_idx" ON "lab_results"("analyte", "resulted_at");

-- CreateIndex
CREATE INDEX "lab_results_deleted_at_idx" ON "lab_results"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "lab_results_lab_order_id_analyte_key" ON "lab_results"("lab_order_id", "analyte");

-- CreateIndex
CREATE INDEX "lab_attachments_lab_order_id_idx" ON "lab_attachments"("lab_order_id");

-- CreateIndex
CREATE INDEX "lab_attachments_file_id_idx" ON "lab_attachments"("file_id");

-- CreateIndex
CREATE INDEX "lab_timeline_events_lab_order_id_occurred_at_idx" ON "lab_timeline_events"("lab_order_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_public_id_key" ON "prescriptions"("public_id");

-- CreateIndex
CREATE INDEX "prescriptions_patient_id_status_idx" ON "prescriptions"("patient_id", "status");

-- CreateIndex
CREATE INDEX "prescriptions_prescribing_doctor_id_created_at_idx" ON "prescriptions"("prescribing_doctor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "prescriptions_status_end_date_idx" ON "prescriptions"("status", "end_date");

-- CreateIndex
CREATE INDEX "prescriptions_medication_id_idx" ON "prescriptions"("medication_id");

-- CreateIndex
CREATE INDEX "prescriptions_deleted_at_idx" ON "prescriptions"("deleted_at");

-- CreateIndex
CREATE INDEX "prescription_safety_warnings_prescription_id_idx" ON "prescription_safety_warnings"("prescription_id");

-- CreateIndex
CREATE INDEX "prescription_notes_prescription_id_authored_at_idx" ON "prescription_notes"("prescription_id", "authored_at" DESC);

-- CreateIndex
CREATE INDEX "prescription_history_entries_prescription_id_occurred_on_idx" ON "prescription_history_entries"("prescription_id", "occurred_on" DESC);

-- CreateIndex
CREATE INDEX "prescription_timeline_events_prescription_id_occurred_at_idx" ON "prescription_timeline_events"("prescription_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_studies" ADD CONSTRAINT "patient_studies_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_medications" ADD CONSTRAINT "record_medications_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "lab_test_catalogue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_ordered_by_fkey" FOREIGN KEY ("ordered_by") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_specimens" ADD CONSTRAINT "lab_specimens_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_specimens" ADD CONSTRAINT "lab_specimens_collected_by_id_fkey" FOREIGN KEY ("collected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_analyte_spec_id_fkey" FOREIGN KEY ("analyte_spec_id") REFERENCES "lab_analyte_specs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_attachments" ADD CONSTRAINT "lab_attachments_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_attachments" ADD CONSTRAINT "lab_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_attachments" ADD CONSTRAINT "lab_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_timeline_events" ADD CONSTRAINT "lab_timeline_events_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_timeline_events" ADD CONSTRAINT "lab_timeline_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_prescribing_doctor_id_fkey" FOREIGN KEY ("prescribing_doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_safety_warnings" ADD CONSTRAINT "prescription_safety_warnings_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_safety_warnings" ADD CONSTRAINT "prescription_safety_warnings_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_notes" ADD CONSTRAINT "prescription_notes_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_notes" ADD CONSTRAINT "prescription_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_history_entries" ADD CONSTRAINT "prescription_history_entries_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_timeline_events" ADD CONSTRAINT "prescription_timeline_events_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_timeline_events" ADD CONSTRAINT "prescription_timeline_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.8).

-- DB §9 — "`refills_remaining BETWEEN 0 AND refills_allowed`". The
-- constraint this milestone's verify step names, and the one with the
-- most direct clinical consequence in the file: a remaining count above
-- the allowance dispenses medication nobody authorized, and a negative
-- one compares below every threshold, so the "refill due" sweep of
-- RM M13.5 would never see it again.
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_refills_allowed_non_negative"
  CHECK ("refills_allowed" >= 0);
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_refills_remaining_within_allowed"
  CHECK ("refills_remaining" BETWEEN 0 AND "refills_allowed");

-- DB §9 — `end_date >= start_date`. A course that ends before it starts
-- is already expired, so the expiry sweep discontinues it immediately.
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_end_after_start" CHECK ("end_date" >= "start_date");

-- DB §9 — `quantity > 0`, and a duration of zero days is not a course.
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_duration_positive" CHECK ("duration_days" > 0);

-- DB §F3 — the `RX-` prefix the frontend already renders.
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_public_id_prefix" CHECK ("public_id" LIKE 'RX-%');

-- P4 — ADR-002 §4: `/cancel` and `/discontinue` both resolve to
-- `discontinued`, and "the distinction is preserved in the audit event
-- and the P4 reason". That makes the reason the only record of *why*,
-- so a discontinuation without one is not representable.
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_discontinued_reason_required"
  CHECK ("status" <> 'discontinued' OR "discontinued_reason" IS NOT NULL);

-- ADR-002 §1 — a draft has not been prescribed by anyone, so it cannot
-- carry a signature; and every status past draft is reached through
-- `POST …/sign`, so each of them must.
--
-- `pending-approval` is included deliberately: ADR-002's lifecycle table
-- reaches it from `draft` via `/sign` when the medication is controlled,
-- so it is a *signed* prescription awaiting a second decision, not an
-- unsigned one.
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_signed_at_matches_status"
  CHECK (("status" = 'draft') = ("signed_at" IS NULL));

-- DB §E3 — an interpretation of results that do not exist yet is a draft
-- opinion sitting in a clinical record.
ALTER TABLE "lab_orders"
  ADD CONSTRAINT "lab_orders_interpretation_requires_completion"
  CHECK ("interpretation" IS NULL OR "status" = 'completed');

-- DB §E3 — the `LAB-` prefix, and the workflow timestamps in order.
ALTER TABLE "lab_orders"
  ADD CONSTRAINT "lab_orders_public_id_prefix" CHECK ("public_id" LIKE 'LAB-%');
ALTER TABLE "lab_orders"
  ADD CONSTRAINT "lab_orders_collected_after_requested"
  CHECK ("collected_at" IS NULL OR "collected_at" >= "requested_at");
ALTER TABLE "lab_orders"
  ADD CONSTRAINT "lab_orders_completed_after_collected"
  CHECK ("completed_at" IS NULL OR "collected_at" IS NULL OR "completed_at" >= "collected_at");

-- A review must name its reviewer, and a reviewer implies a review.
-- UX 2.6 makes "Mark reviewed" the required workflow for critical
-- results, so an unattributed review is not evidence that anyone looked.
ALTER TABLE "lab_orders"
  ADD CONSTRAINT "lab_orders_reviewed_by_iff_reviewed"
  CHECK (("reviewed_at" IS NULL) = ("reviewed_by" IS NULL));

-- DB §8 — the "Critical unreviewed: N" chip. A partial index on exactly
-- the predicate that chip runs, which is why `has_critical_result` is the
-- one derived value DB §14.5-6 permits to be stored.
CREATE INDEX "lab_orders_critical_unreviewed_idx"
  ON "lab_orders" ("requested_at")
  WHERE "has_critical_result" AND "reviewed_at" IS NULL;

-- DB §E4 — a specimen received before it was collected inverts the chain
-- of custody.
ALTER TABLE "lab_specimens"
  ADD CONSTRAINT "lab_specimens_received_after_collected"
  CHECK ("received_at" IS NULL OR "received_at" >= "collected_at");

-- DB §E5 — a numeric result must be numeric. `value_numeric` is what the
-- trend charts read; a qualitative result leaves it null, but a result
-- that claims a flag against a reference range without a comparable value
-- is a flag nothing computed.
ALTER TABLE "lab_results"
  ADD CONSTRAINT "lab_results_numeric_flag_needs_value"
  CHECK (
    "flag" IN ('normal', 'abnormal')
    OR "value_numeric" IS NOT NULL
  );

-- DB §F4 — API §7.7 requires `{ acknowledgedWarningIds, reason }` to pass
-- a severe interaction, and UX 2.7 audit-logs the acknowledgment. The
-- reason is the whole record of why someone proceeded, so an
-- acknowledgment without one is not representable.
ALTER TABLE "prescription_safety_warnings"
  ADD CONSTRAINT "prescription_safety_warnings_acknowledgment_complete"
  CHECK (
    ("acknowledged_by" IS NULL AND "acknowledged_reason" IS NULL AND "acknowledged_at" IS NULL)
    OR ("acknowledged_by" IS NOT NULL AND "acknowledged_reason" IS NOT NULL AND "acknowledged_at" IS NOT NULL)
  );

-- DB §E6, §F — a zero-byte attachment is a failed upload recorded as a
-- success.
ALTER TABLE "lab_attachments"
  ADD CONSTRAINT "lab_attachments_size_positive" CHECK ("size_kb" > 0);
