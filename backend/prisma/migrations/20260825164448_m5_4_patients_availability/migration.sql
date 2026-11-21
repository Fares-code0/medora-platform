-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(20) NOT NULL,
    "mrn" VARCHAR(20) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" "gender" NOT NULL,
    "blood_type" "blood_type" NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "email" CITEXT,
    "address" TEXT,
    "photo_url" TEXT,
    "status" "patient_status" NOT NULL DEFAULT 'active',
    "risk_level" "risk_level" NOT NULL DEFAULT 'low',
    "medical_notes" TEXT,
    "last_visit_at" TIMESTAMPTZ(3),
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_doctor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_allergies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "allergen" VARCHAR(120) NOT NULL,
    "severity" "allergy_severity" NOT NULL,
    "reaction" VARCHAR(200) NOT NULL,
    "notes" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "patient_allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_chronic_conditions" (
    "patient_id" UUID NOT NULL,
    "condition_id" UUID NOT NULL,
    "diagnosed_on" DATE,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_chronic_conditions_pkey" PRIMARY KEY ("patient_id","condition_id")
);

-- CreateTable
CREATE TABLE "patient_emergency_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "relationship" VARCHAR(60) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "patient_emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_insurance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "policy_number" VARCHAR(60) NOT NULL,
    "plan" VARCHAR(80),
    "valid_until" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "patient_insurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" "document_category" NOT NULL,
    "size_kb" INTEGER NOT NULL,
    "file_id" UUID NOT NULL,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
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
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "patient_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_medical_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "kind" "history_event_kind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "occurred_on" DATE NOT NULL,
    "detail" TEXT,
    "facility" VARCHAR(120),
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "patient_medical_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_vital_signs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "record_id" UUID,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blood_pressure_systolic" SMALLINT NOT NULL,
    "blood_pressure_diastolic" SMALLINT NOT NULL,
    "heart_rate_bpm" SMALLINT NOT NULL,
    "temperature_c" DECIMAL(4,1) NOT NULL,
    "respiratory_rate" SMALLINT NOT NULL,
    "oxygen_saturation" SMALLINT NOT NULL,
    "weight_kg" DECIMAL(5,2) NOT NULL,
    "height_cm" DECIMAL(5,1) NOT NULL,
    -- A STORED GENERATED column, hand-edited from what Prisma emitted.
    -- The schema language has no way to say "generated", so it wrote
    -- `DEFAULT round(...)` — which Postgres rejects outright ("cannot use
    -- column reference in DEFAULT expression") and which would be the wrong
    -- semantics even if it parsed: a default applies only when the caller
    -- omits the column, so a caller supplying a bmi would have it stored,
    -- disagreeing with the weight and height on its own row. That is exactly
    -- the double-storage DB §14.5-6 warns about. GENERATED ALWAYS makes the
    -- column unwritable and recomputed on every write.
    -- NULLIF guards the divisor. Without it a height of 0 raises
    -- division_by_zero from the *generation* expression, which Postgres
    -- evaluates before the CHECK constraints — so the row is still
    -- rejected, but by a numeric error instead of by
    -- `patient_vital_signs_height_positive`, and the caller learns
    -- nothing about which rule it broke. With the guard, bmi is NULL
    -- and the height CHECK reports the actual problem.
    "bmi" DECIMAL(4,1) GENERATED ALWAYS AS (round("weight_kg" / ((NULLIF("height_cm", 0) / 100) * (NULLIF("height_cm", 0) / 100)), 1)) STORED,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "patient_vital_signs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_clinical_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "message" VARCHAR(300) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "patient_clinical_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_medications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "prescription_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "dosage" VARCHAR(60) NOT NULL,
    "frequency" VARCHAR(60) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "prescribed_by" UUID,
    "status" "medication_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "patient_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_studies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "lab_order_id" UUID,
    "modality" "study_modality" NOT NULL,
    "category_label" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "performed_on" DATE NOT NULL,
    "status" "study_status" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "patient_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_availability" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doctor_id" UUID NOT NULL,
    "weekday" "weekday" NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "is_break" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "doctor_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_time_off" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doctor_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "auto_behavior" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "doctor_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_verification_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doctor_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "file_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_on" DATE,
    "check_authentic" BOOLEAN NOT NULL DEFAULT false,
    "check_current" BOOLEAN NOT NULL DEFAULT false,
    "check_identity_match" BOOLEAN NOT NULL DEFAULT false,
    "decision" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "reject_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "doctor_verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patients_public_id_key" ON "patients"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_mrn_key" ON "patients"("mrn");

-- CreateIndex
CREATE INDEX "patients_deleted_at_idx" ON "patients"("deleted_at");

-- CreateIndex
CREATE INDEX "patients_status_idx" ON "patients"("status");

-- CreateIndex
CREATE INDEX "patients_assigned_doctor_id_idx" ON "patients"("assigned_doctor_id");

-- CreateIndex
CREATE INDEX "patients_full_name_trgm_idx" ON "patients" USING GIN ("full_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "patients_mrn_trgm_idx" ON "patients" USING GIN ("mrn" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "patients_phone_trgm_idx" ON "patients" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "patient_allergies_deleted_at_idx" ON "patient_allergies"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_allergies_patient_id_allergen_key" ON "patient_allergies"("patient_id", "allergen");

-- CreateIndex
CREATE INDEX "patient_chronic_conditions_condition_id_idx" ON "patient_chronic_conditions"("condition_id");

-- CreateIndex
CREATE INDEX "patient_emergency_contacts_patient_id_idx" ON "patient_emergency_contacts"("patient_id");

-- CreateIndex
CREATE INDEX "patient_emergency_contacts_deleted_at_idx" ON "patient_emergency_contacts"("deleted_at");

-- CreateIndex
CREATE INDEX "patient_insurance_provider_id_idx" ON "patient_insurance"("provider_id");

-- CreateIndex
CREATE INDEX "patient_insurance_deleted_at_idx" ON "patient_insurance"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_insurance_patient_id_policy_number_key" ON "patient_insurance"("patient_id", "policy_number");

-- CreateIndex
CREATE INDEX "patient_documents_patient_id_idx" ON "patient_documents"("patient_id");

-- CreateIndex
CREATE INDEX "patient_documents_file_id_idx" ON "patient_documents"("file_id");

-- CreateIndex
CREATE INDEX "patient_documents_deleted_at_idx" ON "patient_documents"("deleted_at");

-- CreateIndex
CREATE INDEX "patient_notes_patient_id_authored_at_idx" ON "patient_notes"("patient_id", "authored_at" DESC);

-- CreateIndex
CREATE INDEX "patient_notes_deleted_at_idx" ON "patient_notes"("deleted_at");

-- CreateIndex
CREATE INDEX "patient_medical_history_patient_id_occurred_on_idx" ON "patient_medical_history"("patient_id", "occurred_on" DESC);

-- CreateIndex
CREATE INDEX "patient_medical_history_deleted_at_idx" ON "patient_medical_history"("deleted_at");

-- CreateIndex
CREATE INDEX "patient_vital_signs_patient_id_recorded_at_idx" ON "patient_vital_signs"("patient_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "patient_vital_signs_record_id_idx" ON "patient_vital_signs"("record_id");

-- CreateIndex
CREATE INDEX "patient_vital_signs_deleted_at_idx" ON "patient_vital_signs"("deleted_at");

-- CreateIndex
CREATE INDEX "patient_clinical_alerts_patient_id_idx" ON "patient_clinical_alerts"("patient_id");

-- CreateIndex
CREATE INDEX "patient_clinical_alerts_deleted_at_idx" ON "patient_clinical_alerts"("deleted_at");

-- CreateIndex
CREATE INDEX "patient_medications_patient_id_status_idx" ON "patient_medications"("patient_id", "status");

-- CreateIndex
CREATE INDEX "patient_medications_prescription_id_idx" ON "patient_medications"("prescription_id");

-- CreateIndex
CREATE INDEX "patient_medications_deleted_at_idx" ON "patient_medications"("deleted_at");

-- CreateIndex
CREATE INDEX "patient_studies_patient_id_performed_on_idx" ON "patient_studies"("patient_id", "performed_on" DESC);

-- CreateIndex
CREATE INDEX "patient_studies_lab_order_id_idx" ON "patient_studies"("lab_order_id");

-- CreateIndex
CREATE INDEX "patient_studies_deleted_at_idx" ON "patient_studies"("deleted_at");

-- CreateIndex
CREATE INDEX "doctor_availability_doctor_id_weekday_idx" ON "doctor_availability"("doctor_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_availability_doctor_id_weekday_start_time_key" ON "doctor_availability"("doctor_id", "weekday", "start_time");

-- CreateIndex
CREATE INDEX "doctor_time_off_doctor_id_starts_at_ends_at_idx" ON "doctor_time_off"("doctor_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "doctor_verification_documents_doctor_id_idx" ON "doctor_verification_documents"("doctor_id");

-- CreateIndex
CREATE INDEX "doctor_verification_documents_decision_idx" ON "doctor_verification_documents"("decision");

-- CreateIndex
CREATE INDEX "doctor_verification_documents_deleted_at_idx" ON "doctor_verification_documents"("deleted_at");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_assigned_doctor_id_fkey" FOREIGN KEY ("assigned_doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_chronic_conditions" ADD CONSTRAINT "patient_chronic_conditions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_chronic_conditions" ADD CONSTRAINT "patient_chronic_conditions_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "chronic_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_chronic_conditions" ADD CONSTRAINT "patient_chronic_conditions_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_emergency_contacts" ADD CONSTRAINT "patient_emergency_contacts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_insurance" ADD CONSTRAINT "patient_insurance_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_insurance" ADD CONSTRAINT "patient_insurance_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "insurance_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medical_history" ADD CONSTRAINT "patient_medical_history_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medical_history" ADD CONSTRAINT "patient_medical_history_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_vital_signs" ADD CONSTRAINT "patient_vital_signs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_vital_signs" ADD CONSTRAINT "patient_vital_signs_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_clinical_alerts" ADD CONSTRAINT "patient_clinical_alerts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_prescribed_by_fkey" FOREIGN KEY ("prescribed_by") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_studies" ADD CONSTRAINT "patient_studies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_time_off" ADD CONSTRAINT "doctor_time_off_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_verification_documents" ADD CONSTRAINT "doctor_verification_documents_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_verification_documents" ADD CONSTRAINT "doctor_verification_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_verification_documents" ADD CONSTRAINT "doctor_verification_documents_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.4).

-- `patient_vital_signs.bmi` is declared inline above as GENERATED
-- ALWAYS — see the comment at the column. The Prisma schema still
-- carries `@default(dbgenerated(…))` for it, because that is the only
-- way to tell Prisma the expression exists: `migrate diff` reads a
-- generation expression back as a default, and without the declaration
-- the drift check reports a difference on every run (measured during
-- M5.1; ADR-023 §4).
-- DB §9, §B11 — the vitals ranges. These are the constraints the M5.4
-- verify step names, and they are clinical rather than cosmetic: a
-- systolic of 1280 from a slipped decimal point should fail the write,
-- not reach a chart.
ALTER TABLE "patient_vital_signs"
  ADD CONSTRAINT "patient_vital_signs_systolic_range"
  CHECK ("blood_pressure_systolic" BETWEEN 40 AND 300);
ALTER TABLE "patient_vital_signs"
  ADD CONSTRAINT "patient_vital_signs_diastolic_range"
  CHECK ("blood_pressure_diastolic" BETWEEN 20 AND 200);
ALTER TABLE "patient_vital_signs"
  ADD CONSTRAINT "patient_vital_signs_heart_rate_range"
  CHECK ("heart_rate_bpm" BETWEEN 20 AND 300);
ALTER TABLE "patient_vital_signs"
  ADD CONSTRAINT "patient_vital_signs_temperature_range"
  CHECK ("temperature_c" BETWEEN 30 AND 45);
ALTER TABLE "patient_vital_signs"
  ADD CONSTRAINT "patient_vital_signs_respiratory_rate_range"
  CHECK ("respiratory_rate" BETWEEN 4 AND 80);
ALTER TABLE "patient_vital_signs"
  ADD CONSTRAINT "patient_vital_signs_oxygen_saturation_range"
  CHECK ("oxygen_saturation" BETWEEN 0 AND 100);
ALTER TABLE "patient_vital_signs"
  ADD CONSTRAINT "patient_vital_signs_weight_positive" CHECK ("weight_kg" > 0);
ALTER TABLE "patient_vital_signs"
  ADD CONSTRAINT "patient_vital_signs_height_positive" CHECK ("height_cm" > 0);

-- DB §B3 — the `PT-` prefix the frontend already renders.
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_public_id_prefix" CHECK ("public_id" LIKE 'PT-%');

-- A date of birth in the future is a typo, and age is derived from this
-- column (DB §14.5-6), so the typo becomes a negative age everywhere.
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_date_of_birth_past" CHECK ("date_of_birth" <= CURRENT_DATE);

-- DB §8 partial uniques — "one primary emergency contact `WHERE
-- is_primary`", "one current insurance `WHERE is_active`". Partial,
-- because the rule constrains only the flagged rows: a patient may have
-- any number of secondary contacts and any number of lapsed policies.
CREATE UNIQUE INDEX "patient_emergency_contacts_one_primary"
  ON "patient_emergency_contacts" ("patient_id") WHERE "is_primary";
CREATE UNIQUE INDEX "patient_insurance_one_active"
  ON "patient_insurance" ("patient_id") WHERE "is_active";

-- DB §B13 — a course that ends before it starts.
ALTER TABLE "patient_medications"
  ADD CONSTRAINT "patient_medications_end_after_start"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

-- DB §B8 — a zero-byte document is a failed upload recorded as a success.
ALTER TABLE "patient_documents"
  ADD CONSTRAINT "patient_documents_size_positive" CHECK ("size_kb" > 0);

-- ADR-005 §1 — each availability row is a range, so it must be one.
ALTER TABLE "doctor_availability"
  ADD CONSTRAINT "doctor_availability_end_after_start" CHECK ("end_time" > "start_time");

-- ADR-005 §3 — time off is an interval, and its vocabulary is closed.
ALTER TABLE "doctor_time_off"
  ADD CONSTRAINT "doctor_time_off_end_after_start" CHECK ("ends_at" > "starts_at");
ALTER TABLE "doctor_time_off"
  ADD CONSTRAINT "doctor_time_off_kind_check"
  CHECK ("kind" IN ('vacation', 'emergency-block'));
ALTER TABLE "doctor_time_off"
  ADD CONSTRAINT "doctor_time_off_auto_behavior_check"
  CHECK ("auto_behavior" IN ('block-new', 'reschedule-existing'));

-- DB §S1 — the verification document vocabularies.
ALTER TABLE "doctor_verification_documents"
  ADD CONSTRAINT "doctor_verification_documents_kind_check"
  CHECK ("kind" IN ('medical_license', 'degree_certificate', 'national_id', 'other'));
ALTER TABLE "doctor_verification_documents"
  ADD CONSTRAINT "doctor_verification_documents_decision_check"
  CHECK ("decision" IN ('pending', 'approved', 'rejected'));

-- A rejection with no reason is a decision the doctor cannot act on.
-- UX §3.3 requires the reason; this makes "rejected without one"
-- unrepresentable rather than merely discouraged.
ALTER TABLE "doctor_verification_documents"
  ADD CONSTRAINT "doctor_verification_documents_reject_reason_required"
  CHECK ("decision" <> 'rejected' OR "reject_reason" IS NOT NULL);
