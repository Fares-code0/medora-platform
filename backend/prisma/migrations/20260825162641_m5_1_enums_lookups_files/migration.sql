-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'inactive', 'locked', 'suspended');

-- CreateEnum
CREATE TYPE "login_result" AS ENUM ('success', 'failed');

-- CreateEnum
CREATE TYPE "token_kind" AS ENUM ('email_verification', 'password_reset');

-- CreateEnum
CREATE TYPE "activity_kind" AS ENUM ('profile', 'password', 'login', 'settings', 'security', 'integration', 'privacy');

-- CreateEnum
CREATE TYPE "device_platform" AS ENUM ('windows', 'mac', 'ios', 'android', 'desktop', 'mobile', 'tablet');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('female', 'male');

-- CreateEnum
CREATE TYPE "blood_type" AS ENUM ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');

-- CreateEnum
CREATE TYPE "patient_status" AS ENUM ('active', 'under-treatment', 'critical', 'follow-up', 'discharged');

-- CreateEnum
CREATE TYPE "risk_level" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "allergy_severity" AS ENUM ('mild', 'moderate', 'severe');

-- CreateEnum
CREATE TYPE "medication_status" AS ENUM ('active', 'completed', 'discontinued');

-- CreateEnum
CREATE TYPE "history_event_kind" AS ENUM ('diagnosis', 'surgery', 'procedure', 'hospitalization', 'vaccination');

-- CreateEnum
CREATE TYPE "study_status" AS ENUM ('completed', 'pending', 'critical');

-- CreateEnum
CREATE TYPE "study_modality" AS ENUM ('lab', 'imaging');

-- CreateEnum
CREATE TYPE "document_category" AS ENUM ('referral', 'consent', 'external-record', 'insurance', 'report');

-- CreateEnum
CREATE TYPE "alert_severity" AS ENUM ('critical', 'warning');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('scheduled', 'confirmed', 'pending', 'completed', 'cancelled', 'rescheduled', 'no-show', 'awaiting-patient');

-- CreateEnum
CREATE TYPE "appointment_priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "appointment_action" AS ENUM ('approve', 'reject', 'cancel', 'reschedule', 'complete', 'no-show', 'created', 'nudged', 'reassigned');

-- CreateEnum
CREATE TYPE "record_status" AS ENUM ('draft', 'active', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "record_priority" AS ENUM ('low', 'normal', 'high', 'critical');

-- CreateEnum
CREATE TYPE "record_attachment_kind" AS ENUM ('lab-result', 'imaging', 'referral', 'consent', 'external-report');

-- CreateEnum
CREATE TYPE "record_timeline_kind" AS ENUM ('created', 'vitals-recorded', 'diagnosis-added', 'medication-prescribed', 'note-added', 'attachment-added', 'status-changed');

-- CreateEnum
CREATE TYPE "lab_status" AS ENUM ('ordered', 'collected', 'processing', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "lab_priority" AS ENUM ('routine', 'urgent', 'stat');

-- CreateEnum
CREATE TYPE "lab_test_category" AS ENUM ('Hematology', 'Chemistry', 'Microbiology', 'Immunology', 'Pathology', 'Urinalysis', 'Hormones', 'Blood Bank');

-- CreateEnum
CREATE TYPE "lab_result_flag" AS ENUM ('normal', 'low', 'high', 'critical-low', 'critical-high', 'abnormal');

-- CreateEnum
CREATE TYPE "lab_specimen_type" AS ENUM ('Serum', 'Plasma', 'Whole blood', 'Urine', 'Swab', 'Tissue biopsy', 'Stool', 'Sputum', 'CSF');

-- CreateEnum
CREATE TYPE "lab_specimen_condition" AS ENUM ('Acceptable', 'Hemolyzed', 'Clotted', 'Insufficient volume');

-- CreateEnum
CREATE TYPE "lab_attachment_kind" AS ENUM ('report', 'addendum', 'external', 'raw-data');

-- CreateEnum
CREATE TYPE "lab_timeline_kind" AS ENUM ('ordered', 'collected', 'received', 'processing', 'resulted', 'verified', 'cancelled');

-- CreateEnum
CREATE TYPE "prescription_status" AS ENUM ('draft', 'pending-approval', 'active', 'dispensed', 'completed', 'discontinued', 'expired');

-- CreateEnum
CREATE TYPE "refill_status" AS ENUM ('none', 'available', 'due', 'pending');

-- CreateEnum
CREATE TYPE "medication_category" AS ENUM ('Antibiotics', 'Analgesics', 'Antihypertensives', 'Antidiabetics', 'Lipid-lowering', 'Anticoagulants', 'Corticosteroids', 'Bronchodilators', 'Psychiatric', 'Gastrointestinal', 'Opioids', 'Thyroid');

-- CreateEnum
CREATE TYPE "medication_form" AS ENUM ('Tablet', 'Capsule', 'Syrup', 'Injection', 'Inhaler', 'Cream', 'Drops', 'Patch');

-- CreateEnum
CREATE TYPE "medication_route" AS ENUM ('Oral', 'Intravenous', 'Intramuscular', 'Subcutaneous', 'Topical', 'Inhalation', 'Ophthalmic', 'Transdermal');

-- CreateEnum
CREATE TYPE "safety_warning_kind" AS ENUM ('interaction', 'allergy', 'duplicate', 'dosage');

-- CreateEnum
CREATE TYPE "safety_warning_severity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "prescription_timeline_kind" AS ENUM ('prescribed', 'dispensed', 'refill-requested', 'refill-approved', 'renewed', 'note-added', 'discontinued', 'expired');

-- CreateEnum
CREATE TYPE "attachment_kind" AS ENUM ('file', 'image');

-- CreateEnum
CREATE TYPE "message_status" AS ENUM ('sending', 'sent', 'delivered', 'read', 'failed');

-- CreateEnum
CREATE TYPE "message_kind" AS ENUM ('text', 'system');

-- CreateEnum
CREATE TYPE "conversation_kind" AS ENUM ('direct', 'group', 'announcement', 'system');

-- CreateEnum
CREATE TYPE "notification_category" AS ENUM ('appointments', 'medical-records', 'laboratory', 'pharmacy', 'patients', 'ai', 'system', 'security');

-- CreateEnum
CREATE TYPE "notification_priority" AS ENUM ('normal', 'important', 'critical');

-- CreateEnum
CREATE TYPE "notification_kind" AS ENUM ('alert', 'reminder', 'update');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('email', 'sms', 'push', 'desktop', 'inApp');

-- CreateEnum
CREATE TYPE "ai_context_mode" AS ENUM ('general', 'patient', 'record', 'labs', 'pharmacy');

-- CreateEnum
CREATE TYPE "ai_chat_role" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "ai_message_status" AS ENUM ('complete', 'stopped', 'error');

-- CreateEnum
CREATE TYPE "ai_response_length" AS ENUM ('concise', 'balanced', 'detailed');

-- CreateEnum
CREATE TYPE "ai_language" AS ENUM ('en', 'ar');

-- CreateEnum
CREATE TYPE "report_category" AS ENUM ('overview', 'revenue', 'patients', 'appointments', 'laboratory', 'records', 'pharmacy', 'messages', 'ai');

-- CreateEnum
CREATE TYPE "date_range_key" AS ENUM ('today', 'week', 'month', 'quarter', 'year', 'custom');

-- CreateEnum
CREATE TYPE "schedule_frequency" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "schedule_status" AS ENUM ('active', 'paused');

-- CreateEnum
CREATE TYPE "export_format" AS ENUM ('csv', 'excel', 'pdf', 'print');

-- CreateEnum
CREATE TYPE "run_status" AS ENUM ('sent', 'failed');

-- CreateEnum
CREATE TYPE "landing_page" AS ENUM ('overview', 'patients', 'appointments', 'labs', 'messages');

-- CreateEnum
CREATE TYPE "patient_tab" AS ENUM ('summary', 'records', 'labs', 'prescriptions');

-- CreateEnum
CREATE TYPE "records_tab" AS ENUM ('all', 'recent', 'critical');

-- CreateEnum
CREATE TYPE "integration_id" AS ENUM ('google-calendar', 'outlook', 'zoom', 'teams');

-- CreateEnum
CREATE TYPE "staff_role" AS ENUM ('doctor', 'nurse', 'receptionist', 'laboratory', 'pharmacy');

-- CreateEnum
CREATE TYPE "presence_status" AS ENUM ('on-duty', 'on-break', 'off-duty', 'on-leave');

-- CreateEnum
CREATE TYPE "room_kind" AS ENUM ('consultation', 'lab', 'procedure', 'pharmacy', 'waiting');

-- CreateEnum
CREATE TYPE "room_status" AS ENUM ('available', 'occupied', 'cleaning', 'maintenance');

-- CreateEnum
CREATE TYPE "active_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "shift_kind" AS ENUM ('morning', 'evening', 'on-call', 'vacation', 'leave');

-- CreateEnum
CREATE TYPE "queue_priority" AS ENUM ('routine', 'priority', 'urgent');

-- CreateEnum
CREATE TYPE "waiting_status" AS ENUM ('waiting', 'called', 'in-room');

-- CreateEnum
CREATE TYPE "announcement_priority" AS ENUM ('low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "template_kind" AS ENUM ('prescription', 'certificate', 'referral', 'lab-request', 'radiology-request', 'discharge');

-- CreateEnum
CREATE TYPE "holiday_kind" AS ENUM ('public', 'clinic');

-- CreateEnum
CREATE TYPE "resource_status" AS ENUM ('in-stock', 'low', 'out');

-- CreateEnum
CREATE TYPE "weekday" AS ENUM ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun');

-- CreateEnum
CREATE TYPE "doctor_verification_status" AS ENUM ('pending', 'verified', 'rejected', 'docs_requested');

-- CreateEnum
CREATE TYPE "doctor_practice_status" AS ENUM ('active', 'suspended', 'vacation');

-- CreateEnum
CREATE TYPE "backup_kind" AS ENUM ('automatic', 'manual');

-- CreateEnum
CREATE TYPE "audit_category" AS ENUM ('authentication', 'security', 'user_action', 'admin_activity', 'system');

-- CreateEnum
CREATE TYPE "audit_severity" AS ENUM ('info', 'warning', 'critical');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "base_role_id" UUID,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(60) NOT NULL,
    "domain" VARCHAR(30) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300) NOT NULL DEFAULT '',
    "status" "active_status" NOT NULL DEFAULT 'active',
    "head_staff_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(40) NOT NULL,
    "position" SMALLINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "visit_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chronic_conditions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "position" SMALLINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "chronic_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icd_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(10) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "icd_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "insurance_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specialties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(60) NOT NULL,
    "parent_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_key" TEXT NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" CHAR(64) NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "uploaded_by" UUID,
    "scanned_at" TIMESTAMPTZ(3),
    "scan_result" VARCHAR(20),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE INDEX "departments_deleted_at_idx" ON "departments"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "visit_types_name_key" ON "visit_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "chronic_conditions_name_key" ON "chronic_conditions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "icd_codes_code_key" ON "icd_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_providers_name_key" ON "insurance_providers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_name_key" ON "specialties"("name");

-- CreateIndex
CREATE INDEX "files_deleted_at_idx" ON "files"("deleted_at");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_base_role_id_fkey" FOREIGN KEY ("base_role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specialties" ADD CONSTRAINT "specialties_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.1).
--
-- The Prisma schema language has no CHECK syntax, so every constraint
-- DB §9 requires is written here. Two things follow from that, and both
-- matter more than the constraint itself:
--
--   1. `npm run db:check` does NOT see CHECK constraints. Verified by
--      probe during M5.1: a migration that adds one, against a schema
--      that cannot declare it, still reports "No difference detected".
--      The drift check therefore protects columns, types and indexes —
--      not constraints. A CHECK dropped by hand would never be reported.
--   2. So every CHECK below is covered by a failing-insert test instead.
--      That is the only mechanism that actually holds them, which is why
--      DB §9's constraints are verified rather than assumed throughout M5.

-- `files.kind` — the eight values of DB §11.
--
-- A CHECK rather than a native enum because DB §6 is the *complete* enum
-- inventory and does not list this vocabulary; inventing an enum type it
-- does not name would put a type in `pg_type` that no specification
-- describes. The vocabulary is still closed, just closed here.
ALTER TABLE "files"
  ADD CONSTRAINT "files_kind_check" CHECK ("kind" IN (
    'profile_photo', 'patient_document', 'record_attachment', 'lab_attachment',
    'message_attachment', 'verification_document', 'branding_asset', 'backup_artifact'
  ));

-- `files.scan_result` — free until a value is present, then closed.
-- Null is "not yet scanned", which the download path must not read as clean.
ALTER TABLE "files"
  ADD CONSTRAINT "files_scan_result_check"
  CHECK ("scan_result" IS NULL OR "scan_result" IN ('clean', 'infected', 'error'));

-- A role cannot be its own template. Self-reference would make the
-- template chain a cycle of length one, which the matrix editor would
-- resolve by recursing forever.
ALTER TABLE "roles"
  ADD CONSTRAINT "roles_base_role_not_self" CHECK ("base_role_id" IS NULL OR "base_role_id" <> "id");

-- Same for the specialty tree.
ALTER TABLE "specialties"
  ADD CONSTRAINT "specialties_parent_not_self" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
