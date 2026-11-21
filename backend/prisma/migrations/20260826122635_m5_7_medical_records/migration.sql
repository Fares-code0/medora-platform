-- CreateTable
CREATE TABLE "medical_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(20) NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "department_id" UUID,
    "appointment_id" UUID,
    "visit_date" TIMESTAMPTZ(3) NOT NULL,
    "visit_type" VARCHAR(40) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'draft',
    "priority" "record_priority" NOT NULL DEFAULT 'normal',
    "chief_complaint" TEXT NOT NULL,
    "history_of_present_illness" TEXT NOT NULL,
    "physical_examination" TEXT NOT NULL,
    "follow_up_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "medical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_diagnoses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_id" UUID NOT NULL,
    "icd_code_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_treatment_plan_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "record_treatment_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_medications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "dosage" VARCHAR(60) NOT NULL,
    "frequency" VARCHAR(60) NOT NULL,
    "instructions" TEXT,
    "status" "medication_status" NOT NULL DEFAULT 'active',
    "prescription_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "record_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_allergies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_id" UUID NOT NULL,
    "allergen" VARCHAR(120) NOT NULL,
    "severity" "allergy_severity" NOT NULL,
    "reaction" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "record_allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "authored_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "signed" BOOLEAN NOT NULL DEFAULT false,
    "signed_at" TIMESTAMPTZ(3),
    "ai_assisted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "record_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "kind" "record_attachment_kind" NOT NULL,
    "size_kb" INTEGER NOT NULL,
    "file_id" UUID NOT NULL,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "record_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_timeline_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_id" UUID NOT NULL,
    "kind" "record_timeline_kind" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_name" VARCHAR(120),
    "detail" VARCHAR(300),

    CONSTRAINT "record_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_issue_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_id" UUID NOT NULL,
    "reported_by" UUID,
    "description" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "record_issue_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medical_records_public_id_key" ON "medical_records"("public_id");

-- CreateIndex
CREATE INDEX "medical_records_patient_id_visit_date_idx" ON "medical_records"("patient_id", "visit_date" DESC);

-- CreateIndex
CREATE INDEX "medical_records_doctor_id_status_idx" ON "medical_records"("doctor_id", "status");

-- CreateIndex
CREATE INDEX "medical_records_status_priority_idx" ON "medical_records"("status", "priority");

-- CreateIndex
CREATE INDEX "medical_records_appointment_id_idx" ON "medical_records"("appointment_id");

-- CreateIndex
CREATE INDEX "medical_records_deleted_at_idx" ON "medical_records"("deleted_at");

-- CreateIndex
CREATE INDEX "record_diagnoses_icd_code_id_idx" ON "record_diagnoses"("icd_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "record_diagnoses_record_id_icd_code_id_key" ON "record_diagnoses"("record_id", "icd_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "record_treatment_plan_items_record_id_position_key" ON "record_treatment_plan_items"("record_id", "position");

-- CreateIndex
CREATE INDEX "record_medications_record_id_idx" ON "record_medications"("record_id");

-- CreateIndex
CREATE INDEX "record_medications_prescription_id_idx" ON "record_medications"("prescription_id");

-- CreateIndex
CREATE UNIQUE INDEX "record_allergies_record_id_allergen_key" ON "record_allergies"("record_id", "allergen");

-- CreateIndex
CREATE INDEX "record_notes_record_id_authored_at_idx" ON "record_notes"("record_id", "authored_at" DESC);

-- CreateIndex
CREATE INDEX "record_attachments_record_id_idx" ON "record_attachments"("record_id");

-- CreateIndex
CREATE INDEX "record_attachments_file_id_idx" ON "record_attachments"("file_id");

-- CreateIndex
CREATE INDEX "record_timeline_events_record_id_occurred_at_idx" ON "record_timeline_events"("record_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "record_issue_reports_status_created_at_idx" ON "record_issue_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "record_issue_reports_record_id_idx" ON "record_issue_reports"("record_id");

-- AddForeignKey
ALTER TABLE "patient_vital_signs" ADD CONSTRAINT "patient_vital_signs_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_diagnoses" ADD CONSTRAINT "record_diagnoses_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_diagnoses" ADD CONSTRAINT "record_diagnoses_icd_code_id_fkey" FOREIGN KEY ("icd_code_id") REFERENCES "icd_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_diagnoses" ADD CONSTRAINT "record_diagnoses_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_treatment_plan_items" ADD CONSTRAINT "record_treatment_plan_items_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_medications" ADD CONSTRAINT "record_medications_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_allergies" ADD CONSTRAINT "record_allergies_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_attachments" ADD CONSTRAINT "record_attachments_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_attachments" ADD CONSTRAINT "record_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_attachments" ADD CONSTRAINT "record_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_timeline_events" ADD CONSTRAINT "record_timeline_events_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_timeline_events" ADD CONSTRAINT "record_timeline_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_issue_reports" ADD CONSTRAINT "record_issue_reports_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_issue_reports" ADD CONSTRAINT "record_issue_reports_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_issue_reports" ADD CONSTRAINT "record_issue_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.7).

-- DB §8 — "partial unique: one primary diagnosis per record `WHERE
-- is_primary`". The constraint this milestone's verify step names.
--
-- A record with two primary diagnoses has no answer to "what was this
-- visit for", which is the question every summary line, every billing
-- rollup and every analytics group-by asks of it. Partial, because a
-- record may carry any number of secondary diagnoses.
CREATE UNIQUE INDEX "record_diagnoses_one_primary"
  ON "record_diagnoses" ("record_id") WHERE "is_primary";

-- DB §D1 — the `MR-` prefix the frontend already renders.
ALTER TABLE "medical_records"
  ADD CONSTRAINT "medical_records_public_id_prefix" CHECK ("public_id" LIKE 'MR-%');

-- DB §D1 — "`follow_up_date` ≥ visit_date". A follow-up scheduled before
-- the visit it follows is a data-entry slip that reads, on the patient
-- timeline, as an appointment already missed.
ALTER TABLE "medical_records"
  ADD CONSTRAINT "medical_records_follow_up_after_visit"
  CHECK ("follow_up_date" IS NULL OR "follow_up_date" >= "visit_date"::date);

-- The treatment plan is a sequence, and a sequence starts somewhere.
-- A negative position sorts before every real step.
ALTER TABLE "record_treatment_plan_items"
  ADD CONSTRAINT "record_treatment_plan_items_position_non_negative"
  CHECK ("position" >= 0);

-- DB §D8 — a zero-byte attachment is a failed upload recorded as success.
ALTER TABLE "record_attachments"
  ADD CONSTRAINT "record_attachments_size_positive" CHECK ("size_kb" > 0);

-- A signed note must carry when it was signed, and an unsigned one must
-- not. `signed` is what gates a record from draft to final (DB §B9), so
-- a note claiming to be signed with no timestamp has no attribution in
-- time — and one carrying a signature timestamp while flagged unsigned
-- would show as pending in the action queue forever.
ALTER TABLE "record_notes"
  ADD CONSTRAINT "record_notes_signed_at_iff_signed"
  CHECK ("signed" = ("signed_at" IS NOT NULL));

-- DB §S6 — the issue-report lifecycle.
ALTER TABLE "record_issue_reports"
  ADD CONSTRAINT "record_issue_reports_status_check"
  CHECK ("status" IN ('open', 'investigating', 'resolved'));

-- A resolved report has to say when, and an unresolved one cannot.
-- The admin queue (UX 3.1) filters on exactly this.
ALTER TABLE "record_issue_reports"
  ADD CONSTRAINT "record_issue_reports_resolved_at_iff_resolved"
  CHECK (("status" = 'resolved') = ("resolved_at" IS NOT NULL));

-- DB §8 — the open-issues queue, partial on the statuses it shows.
CREATE INDEX "record_issue_reports_open_idx"
  ON "record_issue_reports" ("created_at") WHERE "status" <> 'resolved';
