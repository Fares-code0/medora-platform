-- =============================================================================
-- MEDORA DATABASE SCHEMA BUNDLE
-- Generated from backend/prisma/migrations in chronological order.
--
-- Source of truth: backend/prisma/migrations + backend/prisma/schema
-- Migration count: 34
--
-- IMPORTANT:
-- 1) For normal application setup, use Prisma:
--      cd backend
--      npm run db:deploy
--    This creates/updates the schema AND records migration history in
--    public._prisma_migrations.
-- 2) This file is a standalone SQL bootstrap bundle for a fresh, EMPTY
--    PostgreSQL database. It does NOT create Prisma's _prisma_migrations
--    history table or mark migrations as applied.
-- 3) Do NOT run this file and then run `prisma migrate deploy` against the
--    same database. Prisma would try to replay migrations that this file
--    already applied.
-- 4) Never run against the existing `medora` database without an explicitly
--    reviewed backup and migration plan.
-- 5) Run with psql and stop on the first error:
--      psql -v ON_ERROR_STOP=1 -d <fresh_database> -f schema.sql
--
-- Generated from the exact migration files shipped with this repository.
-- Do not edit this bundle by hand; change Prisma migrations instead and
-- regenerate this file.
-- =============================================================================

\set ON_ERROR_STOP on



-- >>> BEGIN MIGRATION: 20260814120000_enable_extensions
-- Postgres extensions (RM M4.1).
--
-- Raw SQL and a migration of its own, deliberately. Prisma's schema
-- language cannot express `CREATE EXTENSION`, and putting these in the
-- same migration as a table would mean a table could be created before
-- the extension its column type or default depends on.
--
-- All three must exist before any M5 model: `gen_random_uuid()` is the
-- default on every primary key, `citext` is the type of every email and
-- username, and `pg_trgm` backs the fuzzy search of M26.
--
-- `IF NOT EXISTS` so the migration is idempotent against a database
-- where a DBA installed an extension ahead of us — that is a legitimate
-- production setup, not drift.

-- pgcrypto — `gen_random_uuid()` for database-side primary keys.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- citext — case-insensitive text. Emails compare correctly without a
-- `lower()` wrapper that would defeat the index (DB §10).
CREATE EXTENSION IF NOT EXISTS "citext";

-- pg_trgm — trigram similarity, the index behind cross-entity search
-- (API §16.1, RM M26).
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
-- <<< END MIGRATION: 20260814120000_enable_extensions


-- >>> BEGIN MIGRATION: 20260814124013_conventions_reference
-- CreateTable
CREATE TABLE "_conventions_reference" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "label" CITEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "_conventions_reference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conventions_reference_deleted_at_idx" ON "_conventions_reference"("deleted_at");

-- Trigram index (RM M4.1). The reference model carries one so pg_trgm is
-- proven live, not merely installed: M26's cross-entity search is built
-- on exactly this index shape, and a GIN/trgm index is not expressible
-- in the Prisma schema language.
CREATE INDEX "conventions_reference_label_trgm_idx"
  ON "_conventions_reference" USING GIN ("label" gin_trgm_ops);
-- <<< END MIGRATION: 20260814124013_conventions_reference


-- >>> BEGIN MIGRATION: 20260825162641_m5_1_enums_lookups_files
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
-- <<< END MIGRATION: 20260825162641_m5_1_enums_lookups_files


-- >>> BEGIN MIGRATION: 20260825163417_m5_2_identity
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
-- <<< END MIGRATION: 20260825163417_m5_2_identity


-- >>> BEGIN MIGRATION: 20260825164010_m5_3_people_clinic
-- CreateTable
CREATE TABLE "doctors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "photo_url" TEXT,
    "full_name" VARCHAR(80) NOT NULL,
    "title" VARCHAR(60),
    "specialty" VARCHAR(60) NOT NULL,
    "license_number" VARCHAR(40) NOT NULL,
    "license_expires_on" DATE,
    "employee_id" VARCHAR(40),
    "department_id" UUID,
    "hospital" VARCHAR(80),
    "years_of_experience" SMALLINT NOT NULL DEFAULT 0,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "biography" TEXT,
    "education" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedin_url" TEXT,
    "website_url" TEXT,
    "emergency_contact_name" VARCHAR(80),
    "emergency_contact_phone" VARCHAR(30),
    "contact_email" CITEXT NOT NULL,
    "contact_phone" VARCHAR(30) NOT NULL,
    "office_location" VARCHAR(80),
    "office_hours" VARCHAR(80),
    "verification_status" "doctor_verification_status" NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMPTZ(3),
    "verified_by" UUID,
    "practice_status" "doctor_practice_status" NOT NULL DEFAULT 'active',
    "rating_avg" DECIMAL(3,2),
    "default_duration_min" SMALLINT NOT NULL DEFAULT 30,
    "buffer_min" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_specialties" (
    "doctor_id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_specialties_pkey" PRIMARY KEY ("doctor_id","specialty_id")
);

-- CreateTable
CREATE TABLE "admin_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "photo_url" TEXT,
    "full_name" VARCHAR(80) NOT NULL,
    "title" VARCHAR(80),
    "biography" TEXT,
    "contact_email" CITEXT NOT NULL,
    "contact_phone" VARCHAR(30),
    "office_location" VARCHAR(80),
    "emergency_contact_name" VARCHAR(80),
    "emergency_contact_phone" VARCHAR(30),
    "education" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "experience" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedin_url" TEXT,
    "website_url" TEXT,
    "landing_section" VARCHAR(30) NOT NULL DEFAULT 'overview',
    "weekly_digest" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "role" "staff_role" NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "department_id" UUID NOT NULL,
    "status" "presence_status" NOT NULL DEFAULT 'off-duty',
    "phone" VARCHAR(30) NOT NULL,
    "email" CITEXT NOT NULL,
    "working_hours" VARCHAR(80) NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_shift_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL,
    "kind" "shift_kind" NOT NULL,
    "days" BOOLEAN[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "staff_shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "kind" "room_kind" NOT NULL,
    "status" "room_status" NOT NULL DEFAULT 'available',
    "capacity" SMALLINT NOT NULL,
    "note" VARCHAR(300),
    "department_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "location" VARCHAR(120) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reorder_level" INTEGER NOT NULL,
    "status" "resource_status" NOT NULL DEFAULT 'in-stock',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_working_days" (
    "day" "weekday" NOT NULL,
    "open" BOOLEAN NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "break_label" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "clinic_working_days_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "date" DATE NOT NULL,
    "kind" "holiday_kind" NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "doctors_user_id_key" ON "doctors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_license_number_key" ON "doctors"("license_number");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_employee_id_key" ON "doctors"("employee_id");

-- CreateIndex
CREATE INDEX "doctors_deleted_at_idx" ON "doctors"("deleted_at");

-- CreateIndex
CREATE INDEX "doctors_department_id_idx" ON "doctors"("department_id");

-- CreateIndex
CREATE INDEX "doctors_verification_status_idx" ON "doctors"("verification_status");

-- CreateIndex
CREATE INDEX "doctors_practice_status_idx" ON "doctors"("practice_status");

-- CreateIndex
CREATE INDEX "doctor_specialties_specialty_id_idx" ON "doctor_specialties"("specialty_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_user_id_key" ON "admin_profiles"("user_id");

-- CreateIndex
CREATE INDEX "admin_profiles_deleted_at_idx" ON "admin_profiles"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_email_key" ON "staff_members"("email");

-- CreateIndex
CREATE INDEX "staff_members_deleted_at_idx" ON "staff_members"("deleted_at");

-- CreateIndex
CREATE INDEX "staff_members_department_id_idx" ON "staff_members"("department_id");

-- CreateIndex
CREATE INDEX "staff_shift_assignments_deleted_at_idx" ON "staff_shift_assignments"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_shift_assignments_staff_id_kind_key" ON "staff_shift_assignments"("staff_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_name_key" ON "rooms"("name");

-- CreateIndex
CREATE INDEX "rooms_deleted_at_idx" ON "rooms"("deleted_at");

-- CreateIndex
CREATE INDEX "rooms_department_id_idx" ON "rooms"("department_id");

-- CreateIndex
CREATE INDEX "resources_deleted_at_idx" ON "resources"("deleted_at");

-- CreateIndex
CREATE INDEX "holidays_date_idx" ON "holidays"("date");

-- CreateIndex
CREATE INDEX "holidays_deleted_at_idx" ON "holidays"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_name_date_key" ON "holidays"("name", "date");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_staff_id_fkey" FOREIGN KEY ("head_staff_id") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shift_assignments" ADD CONSTRAINT "staff_shift_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.3). See the M5.2 migration for what
-- the drift check does and does not see; CHECKs and partial indexes are
-- in the "not seen" half and are held by failing-insert tests instead.

-- DB §B1 — the validation the `profileSchema` already applies client-side.
-- Restating it here is the point: the schema is one client's opinion, and
-- the column is where the rule has to survive a second one.
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_years_of_experience_range"
  CHECK ("years_of_experience" BETWEEN 0 AND 70);

ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_rating_avg_range"
  CHECK ("rating_avg" IS NULL OR "rating_avg" BETWEEN 0 AND 5);

ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_biography_length" CHECK (char_length("biography") <= 600);

-- The bounded list caps of DB §B1. Stored as `text[]` per §14.3, so the
-- bound is a constraint rather than a table shape. An unbounded array on
-- a row every appointment list joins to is a payload-size problem.
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_languages_max" CHECK (coalesce(array_length("languages", 1), 0) <= 8);
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_education_max" CHECK (coalesce(array_length("education", 1), 0) <= 8);
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_certifications_max"
  CHECK (coalesce(array_length("certifications", 1), 0) <= 8);
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_skills_max" CHECK (coalesce(array_length("skills", 1), 0) <= 12);

-- ADR-005 §2 — "`default_duration_min` ∈ {15,20,30,45,60} (validated —
-- the API contract fixes this set)". A slot length outside it produces
-- a grid the booking UI cannot render.
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_default_duration_allowed"
  CHECK ("default_duration_min" IN (15, 20, 30, 45, 60));

-- A negative buffer would *overlap* adjacent appointments rather than
-- separate them — the conflict check of ADR-005 §4 rule 4 extends each
-- slot by this value on both sides.
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_buffer_non_negative" CHECK ("buffer_min" >= 0);

-- One primary specialty per doctor. A partial unique index, because the
-- constraint applies only to the flagged rows — a doctor may hold any
-- number of secondary specialties.
CREATE UNIQUE INDEX "doctor_specialties_one_primary"
  ON "doctor_specialties" ("doctor_id") WHERE "is_primary";

-- DB §K3 — seven days, index 0 = Monday. Postgres accepts `boolean[7]`
-- as a column type and then ignores the 7, so the length is only real
-- here. A six-element mask would silently drop Sunday from every rota.
ALTER TABLE "staff_shift_assignments"
  ADD CONSTRAINT "staff_shift_assignments_days_is_week"
  CHECK (array_length("days", 1) = 7);

-- DB §9 — `capacity > 0`. A room that holds nobody is not a room.
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_capacity_positive" CHECK ("capacity" > 0);

-- DB §K5 — stock counts are non-negative. A negative quantity would
-- compare below `reorder_level` and sit in the reorder alert forever.
ALTER TABLE "resources"
  ADD CONSTRAINT "resources_quantity_non_negative" CHECK ("quantity" >= 0);
ALTER TABLE "resources"
  ADD CONSTRAINT "resources_reorder_level_non_negative" CHECK ("reorder_level" >= 0);

-- DB §9, §K6 — `end_time > start_time`. A day that closes before it
-- opens makes every availability comparison in ADR-005 §4 vacuously false.
ALTER TABLE "clinic_working_days"
  ADD CONSTRAINT "clinic_working_days_end_after_start" CHECK ("end_time" > "start_time");
-- <<< END MIGRATION: 20260825164010_m5_3_people_clinic


-- >>> BEGIN MIGRATION: 20260825164448_m5_4_patients_availability
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
-- <<< END MIGRATION: 20260825164448_m5_4_patients_availability


-- >>> BEGIN MIGRATION: 20260825165251_m5_5_catalogues
-- CreateTable
CREATE TABLE "lab_test_catalogue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "category" "lab_test_category" NOT NULL,
    "specimen_type" "lab_specimen_type" NOT NULL,
    "container" VARCHAR(60) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "lab_test_catalogue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_analyte_specs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "test_id" UUID NOT NULL,
    "analyte" VARCHAR(80) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "ref_low" DECIMAL(10,3),
    "ref_high" DECIMAL(10,3),
    "decimals" SMALLINT DEFAULT 0,
    "critical_low" DECIMAL(10,3),
    "critical_high" DECIMAL(10,3),
    "qualitative_options" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "lab_analyte_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "generic_name" VARCHAR(120) NOT NULL,
    "category" "medication_category" NOT NULL,
    "form" "medication_form" NOT NULL,
    "route" "medication_route" NOT NULL,
    "manufacturer" VARCHAR(80) NOT NULL,
    "is_controlled" BOOLEAN NOT NULL DEFAULT false,
    "is_high_risk" BOOLEAN NOT NULL DEFAULT false,
    "interaction_note" TEXT,
    "allergy_class" VARCHAR(60),
    "frequencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "durations_days" SMALLINT[] DEFAULT ARRAY[]::SMALLINT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_strengths" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "medication_id" UUID NOT NULL,
    "strength" VARCHAR(30) NOT NULL,
    "position" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "medication_strengths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drug_interactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "medication_a_id" UUID NOT NULL,
    "medication_b_id" UUID NOT NULL,
    "severity" "safety_warning_severity" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "detail" TEXT NOT NULL,
    "management" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "drug_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_monographs" (
    "medication_id" UUID NOT NULL,
    "indications" TEXT,
    "contraindications" TEXT,
    "standard_dosing" TEXT,
    "pregnancy_category" VARCHAR(1),
    "warnings" TEXT,
    "side_effects" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "medication_monographs_pkey" PRIMARY KEY ("medication_id")
);

-- CreateTable
CREATE TABLE "ai_prompt_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(60) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "prompt_text" TEXT NOT NULL,
    "context_mode" "ai_context_mode",
    "position" SMALLINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lab_test_catalogue_code_key" ON "lab_test_catalogue"("code");

-- CreateIndex
CREATE INDEX "lab_test_catalogue_name_trgm_idx" ON "lab_test_catalogue" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "lab_analyte_specs_test_id_analyte_key" ON "lab_analyte_specs"("test_id", "analyte");

-- CreateIndex
CREATE INDEX "medications_name_trgm_idx" ON "medications" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "medications_generic_name_trgm_idx" ON "medications" USING GIN ("generic_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "medications_name_generic_name_key" ON "medications"("name", "generic_name");

-- CreateIndex
CREATE UNIQUE INDEX "medication_strengths_medication_id_strength_key" ON "medication_strengths"("medication_id", "strength");

-- CreateIndex
CREATE INDEX "drug_interactions_medication_b_id_idx" ON "drug_interactions"("medication_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "drug_interactions_medication_a_id_medication_b_id_key" ON "drug_interactions"("medication_a_id", "medication_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_templates_slug_key" ON "ai_prompt_templates"("slug");

-- AddForeignKey
ALTER TABLE "lab_analyte_specs" ADD CONSTRAINT "lab_analyte_specs_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "lab_test_catalogue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_strengths" ADD CONSTRAINT "medication_strengths_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_interactions" ADD CONSTRAINT "drug_interactions_medication_a_id_fkey" FOREIGN KEY ("medication_a_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_interactions" ADD CONSTRAINT "drug_interactions_medication_b_id_fkey" FOREIGN KEY ("medication_b_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_monographs" ADD CONSTRAINT "medication_monographs_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.5).

-- DB §9 — "lab specs: `critical_low < ref_low`, `critical_high > ref_high`
-- (where non-null)". These are clinical rather than tidy: a critical_low
-- sitting *above* the reference low would mark ordinary results critical
-- and bury the genuine ones in the "Critical unreviewed: N" chip.
ALTER TABLE "lab_analyte_specs"
  ADD CONSTRAINT "lab_analyte_specs_critical_low_below_ref"
  CHECK ("critical_low" IS NULL OR "ref_low" IS NULL OR "critical_low" < "ref_low");
ALTER TABLE "lab_analyte_specs"
  ADD CONSTRAINT "lab_analyte_specs_critical_high_above_ref"
  CHECK ("critical_high" IS NULL OR "ref_high" IS NULL OR "critical_high" > "ref_high");

-- A reference range that is inverted is not a range.
ALTER TABLE "lab_analyte_specs"
  ADD CONSTRAINT "lab_analyte_specs_ref_range_ordered"
  CHECK ("ref_low" IS NULL OR "ref_high" IS NULL OR "ref_low" <= "ref_high");

-- DB §E2 — display precision 0–3.
ALTER TABLE "lab_analyte_specs"
  ADD CONSTRAINT "lab_analyte_specs_decimals_range"
  CHECK ("decimals" IS NULL OR "decimals" BETWEEN 0 AND 3);

-- An analyte is either numeric (a reference range) or qualitative (a list
-- of options), never neither. Without this an analyte can exist that no
-- result can be flagged against — it would render every value as
-- "normal" because nothing contradicts it.
ALTER TABLE "lab_analyte_specs"
  ADD CONSTRAINT "lab_analyte_specs_range_or_options"
  CHECK (
    ("ref_low" IS NOT NULL OR "ref_high" IS NOT NULL)
    OR coalesce(array_length("qualitative_options", 1), 0) > 0
  );

-- ADR-010 group 8 — the pair is stored once, in a fixed order.
--
-- Both directions would be two rows that can disagree about severity,
-- and an interaction screen whose answer depends on which drug the
-- caller named first is worse than no screen at all. The ordering makes
-- the unique index on (a, b) actually mean "this pair", and callers
-- normalize before lookup.
ALTER TABLE "drug_interactions"
  ADD CONSTRAINT "drug_interactions_pair_ordered"
  CHECK ("medication_a_id" < "medication_b_id");

-- DB §F1 — the durations offered on the prescribing form.
ALTER TABLE "medications"
  ADD CONSTRAINT "medications_durations_positive"
  CHECK ("durations_days" IS NULL OR 0 < ALL ("durations_days"));

-- Free text here would eventually hold "probably fine".
ALTER TABLE "medication_monographs"
  ADD CONSTRAINT "medication_monographs_pregnancy_category_check"
  CHECK ("pregnancy_category" IS NULL OR "pregnancy_category" IN ('A', 'B', 'C', 'D', 'X'));
-- <<< END MIGRATION: 20260825165251_m5_5_catalogues


-- >>> BEGIN MIGRATION: 20260825165807_m5_6_scheduling
-- CreateTable
CREATE TABLE "patient_doctor_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'consulting',
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "granted_by" UUID,

    CONSTRAINT "patient_doctor_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(20) NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "department_id" UUID,
    "visit_type_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_min" SMALLINT NOT NULL DEFAULT 30,
    "status" "appointment_status" NOT NULL DEFAULT 'pending',
    "priority" "appointment_priority" NOT NULL DEFAULT 'normal',
    "is_new_patient" BOOLEAN NOT NULL DEFAULT false,
    "is_follow_up" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(300) NOT NULL,
    "notes" TEXT,
    "cancelled_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" "appointment_action" NOT NULL,
    "from_status" "appointment_status",
    "to_status" "appointment_status",
    "actor_id" UUID,
    "actor_name" VARCHAR(120),
    "reason" VARCHAR(300),
    "detail" JSONB,

    CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_reschedule_proposals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "proposed_by" UUID,
    "slot_1" TIMESTAMPTZ(3) NOT NULL,
    "slot_2" TIMESTAMPTZ(3),
    "slot_3" TIMESTAMPTZ(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "chosen_slot" SMALLINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_reschedule_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "satisfaction_surveys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satisfaction_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket" VARCHAR(10) NOT NULL,
    "patient_id" UUID,
    "patient_name" VARCHAR(120) NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "priority" "queue_priority" NOT NULL DEFAULT 'routine',
    "enqueued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estimated_minutes" SMALLINT NOT NULL,
    "room_id" UUID,
    "delayed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiting_room_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID,
    "appointment_id" UUID,
    "patient_name" VARCHAR(120) NOT NULL,
    "appointment_time" TIMESTAMPTZ(3),
    "checked_in_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "area" VARCHAR(80) NOT NULL,
    "status" "waiting_status" NOT NULL DEFAULT 'waiting',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "waiting_room_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_doctor_assignments_doctor_id_patient_id_idx" ON "patient_doctor_assignments"("doctor_id", "patient_id");

-- CreateIndex
CREATE INDEX "patient_doctor_assignments_patient_id_idx" ON "patient_doctor_assignments"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_public_id_key" ON "appointments"("public_id");

-- CreateIndex
CREATE INDEX "appointments_doctor_id_starts_at_idx" ON "appointments"("doctor_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_patient_id_starts_at_idx" ON "appointments"("patient_id", "starts_at" DESC);

-- CreateIndex
CREATE INDEX "appointments_status_starts_at_idx" ON "appointments"("status", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_department_id_idx" ON "appointments"("department_id");

-- CreateIndex
CREATE INDEX "appointments_deleted_at_idx" ON "appointments"("deleted_at");

-- CreateIndex
CREATE INDEX "appointment_events_appointment_id_occurred_at_idx" ON "appointment_events"("appointment_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "appointment_reschedule_proposals_appointment_id_idx" ON "appointment_reschedule_proposals"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_reschedule_proposals_status_idx" ON "appointment_reschedule_proposals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "satisfaction_surveys_appointment_id_key" ON "satisfaction_surveys"("appointment_id");

-- CreateIndex
CREATE INDEX "satisfaction_surveys_doctor_id_submitted_at_idx" ON "satisfaction_surveys"("doctor_id", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "satisfaction_surveys_patient_id_idx" ON "satisfaction_surveys"("patient_id");

-- CreateIndex
CREATE INDEX "queue_entries_enqueued_at_idx" ON "queue_entries"("enqueued_at");

-- CreateIndex
CREATE INDEX "queue_entries_deleted_at_idx" ON "queue_entries"("deleted_at");

-- CreateIndex
CREATE INDEX "waiting_room_entries_status_checked_in_at_idx" ON "waiting_room_entries"("status", "checked_in_at");

-- CreateIndex
CREATE INDEX "waiting_room_entries_deleted_at_idx" ON "waiting_room_entries"("deleted_at");

-- AddForeignKey
ALTER TABLE "patient_doctor_assignments" ADD CONSTRAINT "patient_doctor_assignments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_doctor_assignments" ADD CONSTRAINT "patient_doctor_assignments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_doctor_assignments" ADD CONSTRAINT "patient_doctor_assignments_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_visit_type_id_fkey" FOREIGN KEY ("visit_type_id") REFERENCES "visit_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedule_proposals" ADD CONSTRAINT "appointment_reschedule_proposals_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedule_proposals" ADD CONSTRAINT "appointment_reschedule_proposals_proposed_by_fkey" FOREIGN KEY ("proposed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiting_room_entries" ADD CONSTRAINT "waiting_room_entries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiting_room_entries" ADD CONSTRAINT "waiting_room_entries_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.6).

-- DB §9 — the constraint this milestone's verify step names.
--
-- A zero-length slot occupies no time, so it overlaps nothing: the
-- conflict check of ADR-005 §4 rule 4 would let it be booked on top of
-- any other appointment, and the calendar would render it as a hairline.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_duration_positive" CHECK ("duration_min" > 0);

-- DB §C1 — the `APT-` prefix the frontend already renders.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_public_id_prefix" CHECK ("public_id" LIKE 'APT-%');

-- P4 — "confirm with reason" on destructive actions. ADR-001's matrix
-- marks reject and cancel as reason-required, and DB §C1 types the column
-- "required when status=cancelled". Making it a constraint means a
-- cancellation with no reason is unrepresentable rather than merely
-- discouraged: the reason is what the patient is told and what the audit
-- review reads.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_cancelled_reason_required"
  CHECK ("status" <> 'cancelled' OR "cancelled_reason" IS NOT NULL);

-- DB §8 — the action queue. Partial on `pending`, which is the only
-- status the queue asks for and a small fraction of the table.
CREATE INDEX "appointments_pending_idx"
  ON "appointments" ("starts_at") WHERE "status" = 'pending';

-- DB §13.1 — the care-relationship vocabulary.
ALTER TABLE "patient_doctor_assignments"
  ADD CONSTRAINT "patient_doctor_assignments_role_check"
  CHECK ("role" IN ('primary', 'consulting'));

-- One live primary doctor per patient. Partial on *live* rows, because
-- a revoked primary assignment is history and a patient may have had
-- several over time — the constraint is about now, not about ever.
CREATE UNIQUE INDEX "patient_doctor_assignments_one_live_primary"
  ON "patient_doctor_assignments" ("patient_id")
  WHERE "role" = 'primary' AND "revoked_at" IS NULL;

-- The same doctor cannot hold two live assignments to one patient.
CREATE UNIQUE INDEX "patient_doctor_assignments_one_live_per_pair"
  ON "patient_doctor_assignments" ("patient_id", "doctor_id")
  WHERE "revoked_at" IS NULL;

-- The scope lookup RM M7.2 runs on every clinical request: "is this
-- doctor on this patient's care team *now*".
CREATE INDEX "patient_doctor_assignments_live_idx"
  ON "patient_doctor_assignments" ("doctor_id", "patient_id")
  WHERE "revoked_at" IS NULL;

-- DB §S3 — the proposal's own lifecycle, which ADR-001 §3 is explicit is
-- distinct from the appointment's status.
ALTER TABLE "appointment_reschedule_proposals"
  ADD CONSTRAINT "appointment_reschedule_proposals_status_check"
  CHECK ("status" IN ('pending', 'accepted', 'declined', 'expired'));

-- Up to three slots, and `chosen_slot` must name one of the slots that
-- was actually offered. Choosing slot 3 of a two-slot proposal would
-- reschedule the appointment to NULL.
ALTER TABLE "appointment_reschedule_proposals"
  ADD CONSTRAINT "appointment_reschedule_proposals_chosen_slot_offered"
  CHECK (
    "chosen_slot" IS NULL
    OR ("chosen_slot" = 1)
    OR ("chosen_slot" = 2 AND "slot_2" IS NOT NULL)
    OR ("chosen_slot" = 3 AND "slot_3" IS NOT NULL)
  );

-- A slot can only be chosen once the proposal is accepted, and an
-- accepted proposal must name one.
ALTER TABLE "appointment_reschedule_proposals"
  ADD CONSTRAINT "appointment_reschedule_proposals_chosen_iff_accepted"
  CHECK (("status" = 'accepted') = ("chosen_slot" IS NOT NULL));

-- A gap in the offered slots (slot 3 present, slot 2 absent) would render
-- as an empty radio option.
ALTER TABLE "appointment_reschedule_proposals"
  ADD CONSTRAINT "appointment_reschedule_proposals_slots_contiguous"
  CHECK ("slot_3" IS NULL OR "slot_2" IS NOT NULL);

-- DB §9, §S7 — `rating BETWEEN 1 AND 5`. This feeds `doctors.rating_avg`,
-- so an out-of-range value does not stay local: it moves a doctor's
-- published rating.
ALTER TABLE "satisfaction_surveys"
  ADD CONSTRAINT "satisfaction_surveys_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

-- DB §K8 — a queue estimate cannot be negative.
ALTER TABLE "queue_entries"
  ADD CONSTRAINT "queue_entries_estimated_minutes_non_negative"
  CHECK ("estimated_minutes" >= 0);

-- DB §K8 — "Unique: `ticket` (per day)". An expression index, because
-- the day is derived from `enqueued_at` rather than stored.
--
-- ⚠ Residual: the day is computed in **UTC**. ADR-005 §4 establishes
-- that civil-time comparisons use the clinic timezone from the platform
-- localization slice, and that slice does not exist until M5.10 — and an
-- index expression cannot read a row from another table in any case
-- (it must be IMMUTABLE). For a clinic whose local day differs from the
-- UTC day, ticket `A-014` could therefore be reissued across the local
-- midnight boundary. The ticket generator (M23) owns the actual "what is
-- today" decision; this index stops a same-day duplicate, which is the
-- failure that matters — two patients holding one ticket number.
CREATE UNIQUE INDEX "queue_entries_ticket_per_day"
  ON "queue_entries" ("ticket", (("enqueued_at" AT TIME ZONE 'UTC')::date))
  WHERE "deleted_at" IS NULL;
-- <<< END MIGRATION: 20260825165807_m5_6_scheduling


-- >>> BEGIN MIGRATION: 20260826122635_m5_7_medical_records
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
-- <<< END MIGRATION: 20260826122635_m5_7_medical_records


-- >>> BEGIN MIGRATION: 20260826123104_m5_8_labs_pharmacy
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
-- <<< END MIGRATION: 20260826123104_m5_8_labs_pharmacy


-- >>> BEGIN MIGRATION: 20260826123621_m5_9_communication_settings
-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "conversation_kind" NOT NULL DEFAULT 'direct',
    "topic" VARCHAR(200),
    "patient_id" UUID,
    "read_only" BOOLEAN NOT NULL DEFAULT false,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "draft" TEXT NOT NULL DEFAULT '',
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "last_read_at" TIMESTAMPTZ(3),
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "author_id" UUID,
    "kind" "message_kind" NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "message_status" NOT NULL DEFAULT 'sent',
    "edited_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "kind" "attachment_kind" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "scanned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_shared_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "url" TEXT NOT NULL,
    "shared_by" UUID,
    "shared_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_shared_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_flags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "flagged_by" UUID,
    "excerpt" VARCHAR(300) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "resolution" VARCHAR(30),
    "resolution_note" TEXT,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_access_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "justification_category" VARCHAR(40) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "approved_by" UUID,
    "granted_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "access_ref" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "communication_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "category" "notification_category" NOT NULL,
    "priority" "notification_priority" NOT NULL DEFAULT 'normal',
    "kind" "notification_kind" NOT NULL,
    "sender" VARCHAR(120) NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "patient_id" UUID,
    "record_id" UUID,
    "lab_order_id" UUID,
    "prescription_id" UUID,
    "appointment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "channel_email" BOOLEAN NOT NULL DEFAULT true,
    "channel_sms" BOOLEAN NOT NULL DEFAULT false,
    "channel_push" BOOLEAN NOT NULL DEFAULT true,
    "channel_desktop" BOOLEAN NOT NULL DEFAULT false,
    "channel_in_app" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
    "quiet_from" TIME(0) NOT NULL DEFAULT '22:00:00'::time without time zone,
    "quiet_to" TIME(0) NOT NULL DEFAULT '07:00:00'::time without time zone,
    "cat_appointments" BOOLEAN NOT NULL DEFAULT true,
    "cat_medical_records" BOOLEAN NOT NULL DEFAULT true,
    "cat_laboratory" BOOLEAN NOT NULL DEFAULT true,
    "cat_pharmacy" BOOLEAN NOT NULL DEFAULT true,
    "cat_patients" BOOLEAN NOT NULL DEFAULT true,
    "cat_ai" BOOLEAN NOT NULL DEFAULT true,
    "cat_system" BOOLEAN NOT NULL DEFAULT true,
    "cat_security" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "context_mode" "ai_context_mode" NOT NULL DEFAULT 'general',
    "patient_id" UUID,
    "ref_public_id" VARCHAR(20),
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "role" "ai_chat_role" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "ai_message_status" NOT NULL DEFAULT 'complete',
    "error" VARCHAR(300),
    "feedback" SMALLINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_user_settings" (
    "user_id" UUID NOT NULL,
    "temperature" DECIMAL(2,1) NOT NULL DEFAULT 0.3,
    "response_length" "ai_response_length" NOT NULL DEFAULT 'balanced',
    "language" "ai_language" NOT NULL DEFAULT 'en',
    "auto_context" BOOLEAN NOT NULL DEFAULT true,
    "streaming" BOOLEAN NOT NULL DEFAULT true,
    "favorite_prompt_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "saved_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" "report_category" NOT NULL,
    "date_range" "date_range_key" NOT NULL DEFAULT 'month',
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "last_viewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" "report_category" NOT NULL,
    "frequency" "schedule_frequency" NOT NULL,
    "format" "export_format" NOT NULL DEFAULT 'pdf',
    "recipients" CITEXT[],
    "status" "schedule_status" NOT NULL DEFAULT 'active',
    "next_run_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_report_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scheduled_report_id" UUID NOT NULL,
    "ran_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "run_status" NOT NULL,
    "error" TEXT,

    CONSTRAINT "scheduled_report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" UUID NOT NULL,
    "privacy_data_sharing" BOOLEAN NOT NULL DEFAULT true,
    "privacy_analytics" BOOLEAN NOT NULL DEFAULT true,
    "privacy_cookies" BOOLEAN NOT NULL DEFAULT true,
    "privacy_ai_data_usage" BOOLEAN NOT NULL DEFAULT true,
    "landing_page" "landing_page" NOT NULL DEFAULT 'overview',
    "default_patient_tab" "patient_tab" NOT NULL DEFAULT 'summary',
    "default_records_tab" "records_tab" NOT NULL DEFAULT 'all',
    "auto_save_drafts" BOOLEAN NOT NULL DEFAULT true,
    "date_format" VARCHAR(10) NOT NULL DEFAULT 'MM/DD/YYYY',
    "time_format" VARCHAR(3) NOT NULL DEFAULT '12h',
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_interface_preferences" (
    "user_id" UUID NOT NULL,
    "theme" VARCHAR(10) NOT NULL DEFAULT 'system',
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "sidebar_collapsed" BOOLEAN NOT NULL DEFAULT false,
    "density" VARCHAR(12) NOT NULL DEFAULT 'comfortable',
    "text_scale" SMALLINT NOT NULL DEFAULT 100,
    "reduce_motion" BOOLEAN NOT NULL DEFAULT false,
    "high_contrast" BOOLEAN NOT NULL DEFAULT false,
    "focus_rings" VARCHAR(8) NOT NULL DEFAULT 'default',
    "keyboard_nav" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_interface_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_integrations" (
    "user_id" UUID NOT NULL,
    "integration" "integration_id" NOT NULL,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "connected_at" TIMESTAMPTZ(3),
    "account_label" VARCHAR(120),
    "oauth_tokens_enc" BYTEA,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_integrations_pkey" PRIMARY KEY ("user_id","integration")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" UUID,
    "priority" "announcement_priority" NOT NULL DEFAULT 'normal',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(200) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "summary" TEXT NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "kind" "template_kind" NOT NULL,
    "description" VARCHAR(300),
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_last_activity_at_idx" ON "conversations"("last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_patient_id_idx" ON "conversations"("patient_id");

-- CreateIndex
CREATE INDEX "conversations_deleted_at_idx" ON "conversations"("deleted_at");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_archived_idx" ON "conversation_participants"("user_id", "archived");

-- CreateIndex
CREATE INDEX "messages_conversation_id_sent_at_idx" ON "messages"("conversation_id", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "messages_deleted_at_idx" ON "messages"("deleted_at");

-- CreateIndex
CREATE INDEX "messages_body_trgm_idx" ON "messages" USING GIN ("body" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "message_attachments_message_id_idx" ON "message_attachments"("message_id");

-- CreateIndex
CREATE INDEX "message_attachments_file_id_idx" ON "message_attachments"("file_id");

-- CreateIndex
CREATE INDEX "conversation_shared_links_conversation_id_idx" ON "conversation_shared_links"("conversation_id");

-- CreateIndex
CREATE INDEX "message_flags_status_created_at_idx" ON "message_flags"("status", "created_at");

-- CreateIndex
CREATE INDEX "message_flags_message_id_idx" ON "message_flags"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_access_requests_access_ref_key" ON "communication_access_requests"("access_ref");

-- CreateIndex
CREATE INDEX "communication_access_requests_status_created_at_idx" ON "communication_access_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "communication_access_requests_conversation_id_idx" ON "communication_access_requests"("conversation_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_created_at_idx" ON "notifications"("recipient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_conversations_owner_id_updated_at_idx" ON "ai_conversations"("owner_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "ai_conversations_patient_id_idx" ON "ai_conversations"("patient_id");

-- CreateIndex
CREATE INDEX "ai_conversations_deleted_at_idx" ON "ai_conversations"("deleted_at");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "saved_reports_owner_id_category_idx" ON "saved_reports"("owner_id", "category");

-- CreateIndex
CREATE INDEX "scheduled_reports_status_next_run_at_idx" ON "scheduled_reports"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "scheduled_report_runs_scheduled_report_id_ran_at_idx" ON "scheduled_report_runs"("scheduled_report_id", "ran_at" DESC);

-- CreateIndex
CREATE INDEX "announcements_pinned_created_at_idx" ON "announcements"("pinned", "created_at" DESC);

-- CreateIndex
CREATE INDEX "announcements_deleted_at_idx" ON "announcements"("deleted_at");

-- CreateIndex
CREATE INDEX "policies_deleted_at_idx" ON "policies"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "policies_title_version_key" ON "policies"("title", "version");

-- CreateIndex
CREATE INDEX "document_templates_kind_archived_idx" ON "document_templates"("kind", "archived");

-- CreateIndex
CREATE INDEX "document_templates_deleted_at_idx" ON "document_templates"("deleted_at");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_shared_links" ADD CONSTRAINT "conversation_shared_links_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_shared_links" ADD CONSTRAINT "conversation_shared_links_shared_by_fkey" FOREIGN KEY ("shared_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_flags" ADD CONSTRAINT "message_flags_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_flags" ADD CONSTRAINT "message_flags_flagged_by_fkey" FOREIGN KEY ("flagged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_flags" ADD CONSTRAINT "message_flags_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_access_requests" ADD CONSTRAINT "communication_access_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_access_requests" ADD CONSTRAINT "communication_access_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_access_requests" ADD CONSTRAINT "communication_access_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_user_settings" ADD CONSTRAINT "ai_user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_report_runs" ADD CONSTRAINT "scheduled_report_runs_scheduled_report_id_fkey" FOREIGN KEY ("scheduled_report_id") REFERENCES "scheduled_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interface_preferences" ADD CONSTRAINT "user_interface_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_integrations" ADD CONSTRAINT "user_integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.9).

-- DB §9, §G7 — "`notification_preferences.cat_security = true`". One of
-- the two constraints this milestone's verify step names.
--
-- DB §G7 says the rule is "enforced in UI" and then adds that it "must
-- also be a DB CHECK", and the second half is the one that matters: a
-- UI-only guarantee is one API client away from a user who never learns
-- their password was changed or a new device signed in. Security
-- notifications are not a preference.
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_security_always_on" CHECK ("cat_security" = true);

-- DB §9, §H1 — "`ai_conversations`: `context_mode='general' OR patient_id
-- IS NOT NULL`". The other constraint M5.9 verifies.
--
-- UX 2.5's rule is that "AI never has cross-patient context in a single
-- thread". A patient-, record-, labs- or pharmacy-mode thread with no
-- patient bound is exactly the row that would let one thread accumulate
-- context from two patients.
ALTER TABLE "ai_conversations"
  ADD CONSTRAINT "ai_conversations_context_requires_patient"
  CHECK ("context_mode" = 'general' OR "patient_id" IS NOT NULL);

-- DB §9, §H3 — `temperature BETWEEN 0 AND 1`.
ALTER TABLE "ai_user_settings"
  ADD CONSTRAINT "ai_user_settings_temperature_range"
  CHECK ("temperature" BETWEEN 0 AND 1);

-- DB §H2 — thumbs feedback is −1 or +1, never 0. A zero would be
-- indistinguishable from "rated neutral", which the UI cannot express.
ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_feedback_values"
  CHECK ("feedback" IS NULL OR "feedback" IN (-1, 1));

-- DB §H2 — an error message belongs only to a message that errored, and
-- a message that errored should say why.
ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_error_iff_error_status"
  CHECK (("status" = 'error') = ("error" IS NOT NULL));

-- DB §9, §J2 — `text_scale BETWEEN 90 AND 130`, plus the closed
-- appearance vocabularies DB §J2 types as varchar.
ALTER TABLE "user_interface_preferences"
  ADD CONSTRAINT "user_interface_preferences_text_scale_range"
  CHECK ("text_scale" BETWEEN 90 AND 130);
ALTER TABLE "user_interface_preferences"
  ADD CONSTRAINT "user_interface_preferences_theme_check"
  CHECK ("theme" IN ('light', 'dark', 'system'));
ALTER TABLE "user_interface_preferences"
  ADD CONSTRAINT "user_interface_preferences_density_check"
  CHECK ("density" IN ('comfortable', 'compact'));
ALTER TABLE "user_interface_preferences"
  ADD CONSTRAINT "user_interface_preferences_focus_rings_check"
  CHECK ("focus_rings" IN ('default', 'high'));

-- DB §J1 — the date and time formats are closed sets.
ALTER TABLE "user_settings"
  ADD CONSTRAINT "user_settings_date_format_check"
  CHECK ("date_format" IN ('MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'));
ALTER TABLE "user_settings"
  ADD CONSTRAINT "user_settings_time_format_check" CHECK ("time_format" IN ('12h', '24h'));

-- DB §G2 — an unread count cannot be negative.
ALTER TABLE "conversation_participants"
  ADD CONSTRAINT "conversation_participants_unread_non_negative"
  CHECK ("unread_count" >= 0);

-- DB §G1 — a group thread needs a topic; DB §G1 types it "required for
-- group threads". Without one the thread list renders a blank row.
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_group_needs_topic"
  CHECK ("kind" <> 'group' OR "topic" IS NOT NULL);

-- DB §S5 — the safety-flag vocabularies.
ALTER TABLE "message_flags"
  ADD CONSTRAINT "message_flags_category_check"
  CHECK ("category" IN ('emergency_language', 'harassment_abuse', 'phi_wrong_channel', 'prescription_solicitation'));
ALTER TABLE "message_flags"
  ADD CONSTRAINT "message_flags_source_check" CHECK ("source" IN ('auto', 'user'));
ALTER TABLE "message_flags"
  ADD CONSTRAINT "message_flags_status_check"
  CHECK ("status" IN ('open', 'under_review', 'resolved'));
ALTER TABLE "message_flags"
  ADD CONSTRAINT "message_flags_resolution_check"
  CHECK ("resolution" IS NULL OR "resolution" IN ('dismissed', 'warned', 'escalated'));

-- A resolved flag names its outcome, its resolver and when. An
-- unresolved one names none of them. UX §3.6's queue is filtered on
-- exactly this, and a half-resolved row would sit in both views.
ALTER TABLE "message_flags"
  ADD CONSTRAINT "message_flags_resolution_complete"
  CHECK (
    ("status" = 'resolved') = ("resolution" IS NOT NULL AND "resolved_at" IS NOT NULL)
  );

-- DB §S4, ADR-006 — the content-access vocabularies.
ALTER TABLE "communication_access_requests"
  ADD CONSTRAINT "communication_access_requests_category_check"
  CHECK ("justification_category" IN ('patient_complaint', 'safety_flag', 'legal_request', 'quality_audit'));
ALTER TABLE "communication_access_requests"
  ADD CONSTRAINT "communication_access_requests_status_check"
  CHECK ("status" IN ('pending', 'approved', 'denied', 'expired', 'terminated'));

-- ADR-006 §5 / ADR-017 §5 — "self-approval is still refused where two
-- people are the point". The second-administrator approval is about
-- distinct actors, so the database refuses to record the requester as
-- their own approver rather than trusting every future caller to check.
ALTER TABLE "communication_access_requests"
  ADD CONSTRAINT "communication_access_requests_no_self_approval"
  CHECK ("approved_by" IS NULL OR "approved_by" <> "requested_by");

-- A granted access must expire. ADR-006's grant is time-boxed, and a
-- grant with no expiry is a standing capability wearing a justification.
ALTER TABLE "communication_access_requests"
  ADD CONSTRAINT "communication_access_requests_grant_is_time_boxed"
  CHECK (
    "granted_at" IS NULL
    OR ("expires_at" IS NOT NULL AND "expires_at" > "granted_at")
  );

-- DB §K10 — an announcement that expires before it is posted is never
-- seen by anyone.
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_expires_after_creation"
  CHECK ("expires_at" IS NULL OR "expires_at" > "created_at");

-- DB §K12 — a usage counter cannot be negative.
ALTER TABLE "document_templates"
  ADD CONSTRAINT "document_templates_usage_count_non_negative"
  CHECK ("usage_count" >= 0);

-- DB §I2 — a schedule with no recipients emails nobody.
ALTER TABLE "scheduled_reports"
  ADD CONSTRAINT "scheduled_reports_has_recipients"
  CHECK (coalesce(array_length("recipients", 1), 0) > 0);

-- DB §8 — the unread badge count. Partial on exactly the predicate the
-- badge runs, which is a small fraction of a feed that grows forever.
CREATE INDEX "notifications_unread_idx"
  ON "notifications" ("recipient_id", "created_at" DESC)
  WHERE "read_at" IS NULL AND NOT "archived";
-- <<< END MIGRATION: 20260826123621_m5_9_communication_settings


-- >>> BEGIN MIGRATION: 20260826124528_m5_10_platform_audit_triggers
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
-- <<< END MIGRATION: 20260826124528_m5_10_platform_audit_triggers


-- >>> BEGIN MIGRATION: 20260826125022_m5_11_adr010_tables
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
-- <<< END MIGRATION: 20260826125022_m5_11_adr010_tables


-- >>> BEGIN MIGRATION: 20260826190000_m6_3_session_rotation
-- M6.3 — reuse detection for rotated refresh tokens.
--
-- `sessions.refresh_token_hash` is overwritten on every rotation, so a
-- replayed old token matches no row and cannot be told from a random
-- string. This column keeps one generation back, which is what makes the
-- canonical theft detectable: the attacker refreshes with the stolen
-- token, and the real client's next refresh presents the token it still
-- holds — landing here instead of nowhere.
--
-- Nullable by design: a session that has never been refreshed has no
-- previous hash, and a zero value would be a lie about that. Unique for
-- the same reason the current hash is; Postgres permits any number of
-- NULLs under a unique index, so the constraint costs nothing on rows
-- that have not rotated yet.
ALTER TABLE "sessions" ADD COLUMN "previous_token_hash" TEXT;

CREATE UNIQUE INDEX "sessions_previous_token_hash_key" ON "sessions"("previous_token_hash");
-- <<< END MIGRATION: 20260826190000_m6_3_session_rotation


-- >>> BEGIN MIGRATION: 20260901041917_fix_scheduled_report_recipients_text
-- `scheduled_reports.recipients`: citext[] -> text[] (ADR-028).
--
-- The column as typed is unreadable. Prisma 7.9.1 cannot read a citext
-- array at all: `node-postgres` registers no array parser for the citext
-- OID, so it hands back the unparsed literal `{a@b.com}` and the
-- client's data mapper calls `.map` on a string —
-- `TypeError: e.map is not a function`. A row inserted by raw SQL fails
-- identically, so the fault is on the read path, and `create()` fails
-- with it because it reads the row back.
--
-- The conversion is safe and needs no data migration. citext and text
-- share a representation, so the cast is a metadata change; and nothing
-- writes this table yet — M21 is unbuilt, and the only existing test
-- asserts that an *empty* recipient list is rejected, so no row has ever
-- been stored.
--
-- What the column type was for moves up a layer: recipients are stored
-- lower-cased by the endpoint that writes them (M21.5, RA-028.1). Every
-- scalar `@db.Citext` in the schema is untouched — the limitation is
-- arrays only, and this is the schema's only citext array.

-- AlterTable
ALTER TABLE "scheduled_reports" ALTER COLUMN "recipients" SET DATA TYPE TEXT[];
-- <<< END MIGRATION: 20260901041917_fix_scheduled_report_recipients_text


-- >>> BEGIN MIGRATION: 20260902190000_adr030_patient_user_link
-- ADR-030 — link a patient's clinical record to their platform account.
--
-- Amends ADR-018 §3 ("patients are records, not authenticated users") in
-- that clause only, by owner decision of 2026-09-02. Single-clinic,
-- billing-off and mobile-readiness are untouched.
--
-- ── Additive, and deliberately so ────────────────────────────────────
--
-- Three statements, no backfill, no data movement, no column dropped, no
-- type changed, no existing row rewritten. Every patient record in the
-- database keeps working exactly as it did, with `user_id` NULL, and no
-- doctor- or administrator-facing response changes shape. Rollback is
-- DROP CONSTRAINT + DROP COLUMN and loses only the links themselves.
--
-- ── Why nullable ─────────────────────────────────────────────────────
--
-- A patient is registered at the front desk by a clinician, and that
-- record must be complete and usable before the person has ever opened an
-- app — and for the many who never will. NOT NULL would make an account a
-- precondition for receiving care.
--
-- It would also force a backfill, and the backfill is the hazard rather
-- than the cost: filling this column for existing rows means matching an
-- account to a record, and the only column available to match on is
-- `patients.email` — a nullable, non-unique, clinician-typed contact
-- field. One typo or one shared family address discloses a stranger's
-- medical history. A nullable column has no backfill step at all, which
-- is precisely why this migration cannot mismatch a person to a record.
--
-- ── Why unique ───────────────────────────────────────────────────────
--
-- The mapping is one-to-at-most-one in both directions. Postgres permits
-- unlimited NULLs under a unique constraint, so this single index says
-- "every linked record is linked to a different account, and unlinked
-- records are unconstrained" exactly — no partial index, no trigger.
--
-- ── Why SET NULL and never CASCADE ───────────────────────────────────
--
-- DB §7: PHI is never hard-deleted. Users are deactivated rather than
-- deleted, but if a `users` row ever were removed, the clinical record
-- must survive it and revert to unlinked. CASCADE here would delete a
-- person's entire medical history because their app account went away,
-- which is the worst outcome this file could produce.
ALTER TABLE "patients" ADD COLUMN "user_id" UUID;

CREATE UNIQUE INDEX "patients_user_id_key" ON "patients"("user_id");

ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
-- <<< END MIGRATION: 20260902190000_adr030_patient_user_link


-- >>> BEGIN MIGRATION: 20260906120000_adr035_admin_invitations
-- ADR-035 — administrators are invited; doctors declare a register.
--
-- Two independent additions, both purely additive. No column is dropped,
-- no type changed, no existing row rewritten, and no backfill runs. Every
-- `doctors` row keeps working with `professional_category` NULL, and a
-- database with no invitations behaves exactly as it did.
--
-- ── 1. `doctors.professional_category` ───────────────────────────────
--
-- The register a practitioner's number is listed on. Nullable, because
-- every row that predates this migration has no value for it and there is
-- no honest way to derive one — a category is regulatory data, and
-- guessing "physician" for the five seeded demo doctors would be
-- fabricating it. New registrations supply it; old rows say "unknown" by
-- saying nothing, which is true.
--
-- `varchar(40)` and not a native enum. Medora is specified to be
-- internationally extensible, and the category vocabulary belongs to
-- whichever register a jurisdiction runs — SCFHS names five, another
-- regulator names a different set. An enum would freeze one country's
-- list into the schema and make every additional jurisdiction a
-- migration; the validated vocabulary lives in the DTO instead, where
-- adding a register is an ordinary code change. ADR-023 already records
-- that not every constrained string in this schema is an enum, and this
-- is that case rather than an oversight.
--
-- ── 2. `admin_invitations` ───────────────────────────────────────────
--
-- A new table rather than a nullable `user_id` on `verification_tokens`,
-- because an invitation is not a token about an account — it is the
-- authority to create one, and it exists before any account does. Making
-- `verification_tokens.user_id` nullable to fit it would weaken a NOT NULL
-- that is load-bearing for every existing consumer of that table.
--
-- ON DELETE, one clause at a time:
--   · `role_id`    RESTRICT — matches `users.role_id`. A role with
--                  invitations outstanding must not vanish under them.
--   · `invited_by` CASCADE  — the FK is to the inviting administrator.
--   · `user_id`    SET NULL — the invitation record is the audit trail of
--                  how a privileged account came to exist, and it must
--                  survive that account being removed. CASCADE here would
--                  delete the evidence along with the subject.
--
-- `token_hash` is UNIQUE, like `verification_tokens.token_hash`: the
-- lookup is by hash, and two invitations sharing one is not a reachable
-- state. The raw token lives in the emailed link and nowhere else, so a
-- disclosure of this table cannot be replayed into an admin account.

-- 1 ──────────────────────────────────────────────────────────────────
ALTER TABLE "doctors" ADD COLUMN "professional_category" VARCHAR(40);

-- 2 ──────────────────────────────────────────────────────────────────
CREATE TABLE "admin_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "invited_by" UUID NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_invitations_token_hash_key" ON "admin_invitations"("token_hash");
CREATE INDEX "admin_invitations_email_idx" ON "admin_invitations"("email");
CREATE INDEX "admin_invitations_expires_at_idx" ON "admin_invitations"("expires_at");

ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_invited_by_fkey"
  FOREIGN KEY ("invited_by") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
-- <<< END MIGRATION: 20260906120000_adr035_admin_invitations


-- >>> BEGIN MIGRATION: 20260911090000_m7_4_permission_matrix_state
-- M7.4 — the permission matrix gains a revision (API §15.2–15.3).
--
-- Purely additive: one new table, one seeded row, nothing dropped and no
-- existing row rewritten. A database that never reads it behaves exactly
-- as it did.
--
-- ── Why a table and not a `platform_settings` key ────────────────────
--
-- `platform_settings` was the obvious home and is the wrong one.
-- `platform_settings_key_check` restricts that table to DB §L1's eleven
-- slice keys, and its own comment says why: a twelfth key "would be a
-- settings panel with nothing reading it, or a typo silently shadowing a
-- real slice". Widening the CHECK to admit a matrix revision would have
-- spent the property the constraint exists for, on a value that is not a
-- settings slice — nobody edits it in a panel; it is authorization state
-- the save path maintains.
--
-- ── Why the matrix itself is not in here ─────────────────────────────
--
-- `role_permissions` stays the authoritative grid. It is what
-- `PermissionResolver` reads on every cache miss, and a second copy of
-- the matrix would be a second thing to keep in step with it. What that
-- join table cannot hold is an aggregate identity — a set of rows has no
-- version — so API §15.3's concurrent-edit 409 has nothing to compare
-- against. This table is that identity and carries nothing else.
--
-- ── The singleton guard ──────────────────────────────────────────────
--
-- There is one permission matrix, so `id` is pinned to 1 by a CHECK
-- rather than left to convention. Without it, "the revision" is a query
-- that can return two answers, and a compare-and-set against the wrong
-- row silently overwrites somebody's save — which is precisely the
-- failure the revision was added to prevent.
--
-- `revision` starts at 1 to match the frontend's
-- `DEFAULT_PERMISSION_STATE.revision`, so an editor opened against a
-- freshly seeded platform quotes back a number the server recognises.
--
-- `updated_by` is SET NULL on delete, like every other attribution
-- column in this schema: who last changed the matrix outlives their
-- account, and CASCADE here would delete the record of a privileged
-- change along with the administrator who made it.

CREATE TABLE "permission_matrix_state" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID,
    -- No DB default: `@updatedAt` is maintained by Prisma, like every
    -- other `updated_at` in this schema. The baseline row below supplies
    -- its own value.
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "permission_matrix_state_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "permission_matrix_state"
  ADD CONSTRAINT "permission_matrix_state_id_check" CHECK ("id" = 1);

-- A revision only ever moves forward; a negative one would be a bug
-- that made every compare-and-set fail and froze the matrix.
ALTER TABLE "permission_matrix_state"
  ADD CONSTRAINT "permission_matrix_state_revision_check" CHECK ("revision" >= 1);

ALTER TABLE "permission_matrix_state" ADD CONSTRAINT "permission_matrix_state_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The baseline row, so a read never has to create one and a save never
-- races two callers into inserting it.
INSERT INTO "permission_matrix_state" ("id", "revision", "updated_at")
  VALUES (1, 1, CURRENT_TIMESTAMP)
  ON CONFLICT ("id") DO NOTHING;
-- <<< END MIGRATION: 20260911090000_m7_4_permission_matrix_state


-- >>> BEGIN MIGRATION: 20260911100000_m10_patient_identity_sequence
-- M10.2 — the `PT-…` handle gets a sequence (API §4.2).
--
-- Purely additive: one sequence, no table touched, no row rewritten.
--
-- ── Why a sequence and not a random suffix ───────────────────────────
--
-- `users.public_id` is random (`usr_<12 random bytes>`), and its own
-- comment gives the reason: `usr_1`, `usr_2` would tell anyone holding
-- one id how many accounts exist and let them guess the others.
--
-- `patients.public_id` is deliberately the other choice, and the
-- difference is that the value is *read aloud*. A `PT-…` handle is
-- quoted on a wristband, over a phone and across a reception desk; it is
-- the identifier a clinic uses to mean "this person" in conversation,
-- and the seeded data is already `PT-1001`…`PT-1005`. A base64url suffix
-- would be unreadable in exactly the situations the handle exists for.
--
-- The enumerability that buys is already accounted for rather than
-- newly accepted: `shared/phi/masked-identity.ts` says so in as many
-- words — "`patientId` is not an identifier in the PHI sense — it says
-- nothing about the person — and the care-scoping of
-- `PatientScopeService` is what stops it being enumerated". Walking
-- `PT-1000`, `PT-1001`, … against this API returns 404 for every chart
-- the caller has no care relationship with, byte-identically to a chart
-- that does not exist (ADR-022).
--
-- ── Why it starts at 2000 ────────────────────────────────────────────
--
-- The seed occupies PT-1001 through PT-1005 and `public_id` is UNIQUE.
-- Starting at 1 would make the first five registrations on a seeded
-- database fail on the constraint, which is a confusing first
-- experience for something with an obvious fix. 2000 leaves room for
-- the demo set to grow without ever meeting the live range.
--
-- ── The MRN is NOT drawn from this sequence ──────────────────────────
--
-- Deliberately, and it is the one thing here worth getting right.
-- Administrators see an MRN masked to its last four digits (UX §1.5.6,
-- `maskMrn`). If the MRN were derivable from the `PT-…` handle — which
-- is never masked, because every subsequent request is keyed by it —
-- then the mask would protect nothing: anyone holding the handle could
-- compute the digits it hides. The MRN is generated randomly in the
-- service, with the UNIQUE index and a retry as the collision handler.

CREATE SEQUENCE IF NOT EXISTS "patient_identity_seq"
  AS BIGINT
  START WITH 2000
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;
-- <<< END MIGRATION: 20260911100000_m10_patient_identity_sequence


-- >>> BEGIN MIGRATION: 20260913120000_m11_appointment_reference_sequence
-- M11.2 — the `APT-…` reference gets a sequence (API §5.3).
--
-- Purely additive: one sequence, no table touched, no row rewritten.
--
-- ── Why a sequence, and why it is not a secret ───────────────────────
--
-- The same reasoning M10.2 records for `patient_identity_seq`, and the
-- same conclusion. `APT-3007` is read aloud on the phone, quoted in a
-- toast, and printed on a reminder — it is a *handle*, not a
-- capability. The API contract's own example (API §5.5) is `APT-3007`,
-- and the frontend's oversight model calls it "the handle this
-- appointment is known by in logs, toasts and exports — so an
-- administrator can talk about a case without naming the patient".
--
-- Guessability is not the control here. Walking `APT-3000`, `APT-3001`,
-- … against this API returns 404 for every appointment the caller is
-- not the doctor on: the book is scoped by `doctorId` in the WHERE
-- clause, and the oversight surface needs an admin capability. An
-- unguessable reference would add nothing to that and would cost the
-- one property the handle exists for.
--
-- ── Starting at 3000 ─────────────────────────────────────────────────
--
-- So the first appointment this platform books is `APT-3000`, one below
-- the contract's worked example rather than colliding with it. Nothing
-- in the seed occupies the range, and `public_id` is UNIQUE, so a
-- collision is a constraint error rather than a silently shared
-- reference.

CREATE SEQUENCE IF NOT EXISTS "appointment_reference_seq"
  AS BIGINT
  START WITH 3000
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;
-- <<< END MIGRATION: 20260913120000_m11_appointment_reference_sequence


-- >>> BEGIN MIGRATION: 20260913140000_m12_record_versions
-- M12 — record versioning, the one-primary rule, and the `MR-…` sequence.
--
-- Three additions, none of which rewrites an existing row.
--
-- ══ 1. The `MR-…` sequence (API §6.3) ════════════════════════════════
--
-- Same reasoning as `patient_identity_seq` (M10.2) and
-- `appointment_reference_seq` (M11.2): the handle is read aloud, quoted
-- in a toast and printed on a referral, and guessability is not the
-- control — every read is care-scoped, so walking `MR-10001`,
-- `MR-10002`, … returns 404 for every chart the caller is not on.
--
-- Starting at 10001 because that is the range the frontend's own mock
-- renders (`mock-data.ts`), and `medical_records_public_id_prefix`
-- already constrains the shape to `MR-%`.

CREATE SEQUENCE IF NOT EXISTS "medical_record_reference_seq"
  AS BIGINT
  START WITH 10001
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

-- ══ 2. One primary diagnosis per record (API §6.4) ═══════════════════
--
-- API §6.4 says "one-primary-diagnosis enforced (partial unique)" and
-- M5.7 did not add the index — `@@unique([record_id, icd_code_id])`
-- stops the same code twice and says nothing about how many of them are
-- primary. Two primaries is not a cosmetic problem: `primaryDiagnosis()`
-- on the frontend returns `find(...)`, so the record's headline
-- diagnosis would silently become whichever row the database happened
-- to return first, and could differ between two loads of the same page.
--
-- Partial, matching the shape M5.3 and M5.4 already use for
-- `doctor_specialties` and `patient_emergency_contacts`: a record may
-- have any number of secondary diagnoses, and at most one primary.
--
-- Deliberately allows **zero** primaries. A draft being typed up has
-- diagnoses before one of them has been chosen as the headline, and a
-- constraint that required one would make the intermediate state
-- unrepresentable.

CREATE UNIQUE INDEX IF NOT EXISTS "record_diagnoses_one_primary"
  ON "record_diagnoses" ("record_id") WHERE "is_primary";

-- ══ 3. `record_versions` (API §6.8, RM M12.6) ════════════════════════
--
-- Every update stores a before/after diff. The requirement comes from
-- two directions — UX 1.5.3's version history and the logs diff viewer
-- of module 14 — and both want the same thing: what changed, who
-- changed it, and when.
--
-- ── Why a diff and not a full snapshot ───────────────────────────────
--
-- A snapshot per update would copy the whole clinical document,
-- children included, on every keystroke-sized save. The diff is what
-- both consumers actually render, and it is bounded by the size of the
-- change rather than the size of the record.
--
-- ── Why `jsonb` and not a column per field ───────────────────────────
--
-- The document has eight scalar fields and five child collections, and
-- a change may touch any subset. Fifty nullable columns would encode
-- the same information less legibly and would need a migration every
-- time the record gains a field.
--
-- ── INSERT-only, like the audit trail ────────────────────────────────
--
-- No `updated_at`, no `deleted_at`. A version row that can be edited is
-- not a version history, and a version row that can be deleted is worse
-- than none — it makes the absence of a change indistinguishable from
-- its removal. The soft-delete client extension therefore never touches
-- this table, which is correct: it has no `deleted_at` to filter on.
--
-- `version` is per record and dense from 1, so "version 3" means the
-- same thing to a clinician and to a query. It is assigned inside the
-- update's transaction from a `MAX(version) + 1` over the record's own
-- rows, and the unique index below is what makes two concurrent updates
-- collide rather than silently share a number.

CREATE TABLE "record_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,
    -- The display name as it was, on the same reasoning ADR-003 §4 gives
    -- for `appointment_events.actor_name`: the FK may go null when an
    -- account is removed, and a later rename must not rewrite history.
    "actor_name" VARCHAR(120),
    -- `{ field: { before, after } }` for the scalars that changed, plus
    -- a `children` key naming collections that were replaced. Never the
    -- whole document.
    "changes" JSONB NOT NULL,
    "summary" VARCHAR(300),

    CONSTRAINT "record_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "record_versions_record_id_version_key"
  ON "record_versions" ("record_id", "version");

CREATE INDEX "record_versions_record_id_changed_at_idx"
  ON "record_versions" ("record_id", "changed_at" DESC);

ALTER TABLE "record_versions"
  ADD CONSTRAINT "record_versions_record_id_fkey"
  FOREIGN KEY ("record_id") REFERENCES "medical_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "record_versions"
  ADD CONSTRAINT "record_versions_changed_by_fkey"
  FOREIGN KEY ("changed_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Version numbers are dense from 1 (DB §9's positive-integer house style).
ALTER TABLE "record_versions"
  ADD CONSTRAINT "record_versions_version_positive" CHECK ("version" > 0);
-- <<< END MIGRATION: 20260913140000_m12_record_versions


-- >>> BEGIN MIGRATION: 20260913160000_m13_prescription_reference_sequence
-- M13.3 — the `RX-…` reference gets a sequence (API §7.6).
--
-- Purely additive: one sequence, no table touched, no row rewritten.
--
-- ── Why a sequence, and why it is not a secret ───────────────────────
--
-- The same reasoning M10.2 records for `patient_identity_seq` and M11.2
-- for `appointment_reference_seq`, and the same conclusion. `RX-200003`
-- is read aloud to a pharmacy, quoted in a toast, and printed on a
-- prescription — it is a *handle*, not a capability. The API contract's
-- own worked example (API §7.7) is `RX-200003`.
--
-- Guessability is not the control here. Walking `RX-200000`,
-- `RX-200001`, … against this API returns 404 for every prescription
-- the caller is not the prescriber on, and every read is additionally
-- scoped by the care relationship `PatientScopeService` resolves. An
-- unguessable reference would add nothing to that and would cost the
-- one property the handle exists for.
--
-- ── Starting at 200000 ───────────────────────────────────────────────
--
-- So the first prescription this platform writes is `RX-200000`, below
-- the contract's worked example rather than colliding with it. Nothing
-- in the seed occupies the range — the seed writes no prescriptions at
-- all — and `public_id` is UNIQUE, so a collision is a constraint error
-- rather than a silently shared reference.
--
-- The `prescriptions_public_id_prefix` CHECK from M5.8 already requires
-- the `RX-` prefix, so a reference minted any other way is refused by
-- the database rather than by convention.

CREATE SEQUENCE IF NOT EXISTS "prescription_reference_seq"
  AS BIGINT
  START WITH 200000
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;
-- <<< END MIGRATION: 20260913160000_m13_prescription_reference_sequence


-- >>> BEGIN MIGRATION: 20260915090000_m14_lab_order_reference_sequence
-- M14.2 — the `LAB-…` reference gets a sequence (API §8.4).
--
-- Purely additive: one sequence, no table touched, no row rewritten.
--
-- ── Why a sequence, and why it is not a secret ───────────────────────
--
-- The same reasoning M10.2 records for `patient_identity_seq`, M11.2 for
-- `appointment_reference_seq` and M13.3 for `prescription_reference_seq`,
-- and the same conclusion. `LAB-100004` is read aloud to a phlebotomist,
-- printed on a specimen label and quoted in a result call — it is a
-- *handle*, not a capability. The frontend's own corpus mints
-- `LAB-100004` (`record-attachments/attachability.test.ts`), so the
-- shape is already the one clients expect.
--
-- Guessability is not the control here. Walking `LAB-100000`,
-- `LAB-100001`, … against this API returns 404 for every order outside
-- the caller's care relationship, which `PatientScopeService` resolves
-- on every read, and 404 rather than 403 precisely so the walk discloses
-- nothing (ADR-022). An unguessable reference would add nothing to that
-- and would cost the one property the handle exists for.
--
-- ── Starting at 100000 ───────────────────────────────────────────────
--
-- So the first order this platform writes is `LAB-100000`, below the
-- frontend corpus's `LAB-100004` rather than colliding with it. Nothing
-- in the seed occupies the range — the seed writes no lab orders at all
-- — and `public_id` is UNIQUE, so a collision is a constraint error
-- rather than a silently shared reference.
--
-- The `lab_orders_public_id_prefix` CHECK from M5.8 already requires the
-- `LAB-` prefix, so a reference minted any other way is refused by the
-- database rather than by convention.

CREATE SEQUENCE IF NOT EXISTS "lab_order_reference_seq"
  AS BIGINT
  START WITH 100000
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;
-- <<< END MIGRATION: 20260915090000_m14_lab_order_reference_sequence


-- >>> BEGIN MIGRATION: 20260918120000_m19_1_domain_events_outbox
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
-- <<< END MIGRATION: 20260918120000_m19_1_domain_events_outbox


-- >>> BEGIN MIGRATION: 20260918130000_m19_5_delivery_sending_state
-- M19.5 — `notification_deliveries` gains an in-flight state.
--
-- The channel worker claims pending rows with FOR UPDATE SKIP LOCKED and
-- moves them out of `pending` in the same statement, so two backend
-- instances cannot both send one email. That claim needs a state to move
-- them *to*: without one, a claimed row is indistinguishable from an
-- unclaimed one the moment the lock is released, and the worker would be
-- back to a read-modify-write race.
--
-- `sending` is deliberately not terminal. A row left in it by a crashed
-- worker is a delivery whose outcome is unknown — which is the truth,
-- and is what M30.1's retry policy and dead-letter queue will act on.
-- Marking such a row `sent` would be a lie an administrator could not
-- detect, and `failed` would send someone to look at a healthy relay.
--
-- The four other values are unchanged. `frontend`'s `DeliveryStatus`
-- union is already a subset of this vocabulary (it has no `skipped`),
-- and no endpoint projects this column today, so nothing on the wire
-- changes.

ALTER TABLE "notification_deliveries"
  DROP CONSTRAINT "notification_deliveries_status_check";

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_status_check"
  CHECK ("status" IN ('pending', 'sending', 'sent', 'delivered', 'failed', 'skipped'));
-- <<< END MIGRATION: 20260918130000_m19_5_delivery_sending_state


-- >>> BEGIN MIGRATION: 20261024090000_br_dec_004_record_version_reason
-- BR-DEC-004 (DEC-004) — a medical-record edit carries a reason, persisted
-- with the version row it explains.
--
-- On the version row and nowhere else: the reason belongs to one edit, and
-- `record_versions` is already the insert-only history `GET …/versions`
-- serves. A column on `medical_records` would hold only the latest reason
-- and overwrite the one before it, which is the loss the decision exists
-- to prevent.
--
-- Nullable. Every version written before this migration has no reason, and
-- whether a reason is mandatory is a rule DEC-004 does not state ("accepted
-- and persisted"), so the application accepts one and the column does not
-- invent a requirement the owner has not made. 300 characters, the same
-- ceiling the other P4 reasons on this schema use.

ALTER TABLE "record_versions" ADD COLUMN "reason" VARCHAR(300);
-- <<< END MIGRATION: 20261024090000_br_dec_004_record_version_reason


-- >>> BEGIN MIGRATION: 20261024150000_br_dec_003_removal_reasons
-- BR-DEC-003 (DEC-003) — the reason for removing a history event, removing
-- an emergency contact or resolving a clinical alert, persisted with the
-- row it explains rather than only in a log line.
--
-- Nullable on all three. Rows removed or resolved before this migration have
-- no reason, and the application — not the column — decides when one is
-- required: mandatory for a history removal (DEC-003 point 2, "each with a
-- mandatory reason"), optional for a contact removal and an alert
-- resolution ("optional-or-mandatory"; the client that calls those routes
-- today sends no body). 300 characters, the ceiling the other P4 reasons on
-- this schema use (`record_versions.reason`, BR-DEC-004).
--
-- Additive only: no existing column, index or constraint changes.

ALTER TABLE "patient_medical_history" ADD COLUMN "removal_reason" VARCHAR(300);
ALTER TABLE "patient_emergency_contacts" ADD COLUMN "removal_reason" VARCHAR(300);
ALTER TABLE "patient_clinical_alerts" ADD COLUMN "resolution_reason" VARCHAR(300);
-- <<< END MIGRATION: 20261024150000_br_dec_003_removal_reasons


-- >>> BEGIN MIGRATION: 20261030090000_admin_bootstrap_invitation
-- The first-administrator bootstrap (ADR-035 "the first administrator of a
-- deployment must be seeded"; RM M38.4).
--
-- `invited_by` becomes nullable. NULL means exactly one thing: the
-- invitation was issued by an operator running `npm run admin:bootstrap`
-- on the server, when no administrator existed to send it. Every invitation
-- sent through `POST /auth/admin-invitations` still names its sender.
--
-- Additive: no row is rewritten, and the foreign key and its ON DELETE
-- CASCADE are unchanged.

-- AlterTable
ALTER TABLE "admin_invitations" ALTER COLUMN "invited_by" DROP NOT NULL;
-- <<< END MIGRATION: 20261030090000_admin_bootstrap_invitation


-- >>> BEGIN MIGRATION: 20261030120000_spec_scalar_lists_not_null
-- DB §B1, §B2, §F1, §I2, §K2, §K3 — the scalar-list columns the dictionary
-- declares NOT NULL, made NOT NULL.
--
-- Prisma has no way to say it. `String[]` is a required field in the client
-- (it types as `string[]`, never `string[] | null`), yet `migrate dev`
-- emits the column as plain `TEXT[]`, nullable, and `migrate diff` ignores
-- the nullability of a list column in both directions. So the dictionary's
-- "Null: no" was lost in M5.3/M5.5/M5.9 without `db:check` noticing, and
-- adding it here does not create drift either. Found by the comparison
-- against the Database branch's `database/medora.dbml`, which declares
-- `medications.frequencies` and `durations_days` NOT NULL as the dictionary
-- does (backend/docs/DATABASE_BRANCH_RECONCILIATION.md §5).
--
-- A NULL in one of these columns reaches the application as `null` where
-- the generated type promises an array, so `row.languages.length` throws.
-- The client never writes one — every column but `days` has a database
-- default of `'{}'`, and the shift DTO requires `days` — so a NULL can only
-- come from hand-written SQL. The backfill below is therefore expected to
-- touch no rows; it exists so the migration cannot fail on a database where
-- someone did write one.
--
-- `'{}'` is the value the column default would have produced, so the
-- backfill invents nothing. `staff_shift_assignments.days` is different: it
-- has no default and no neutral value (an empty mask fails DB §K3's
-- "boolean[7]"; an all-false mask asserts a schedule nobody chose), so a
-- NULL there stops the migration instead of being guessed at.
--
-- `scheduled_reports.recipients` already rejects NULL through
-- `scheduled_reports_has_recipients` (`coalesce(...) > 0`); it is set
-- NOT NULL so the column says what the constraint enforces.
--
-- Columns the dictionary leaves nullable or does not specify are untouched:
-- `lab_analyte_specs.qualitative_options` (§E2, "yes"),
-- `ai_user_settings.favorite_prompt_ids` (§H3, no nullability stated),
-- `incident_bookmarks.event_ids` (§13, inferred table) and
-- `admin_invitations.permissions` (ADR-035, not in the dictionary).
--
-- Wrapped in an explicit transaction: `migrate deploy` does not make a
-- migration atomic on its own (verified — a statement that fails part-way
-- leaves the earlier ones applied), and a half-tightened set of columns
-- would be worse than either state. The guard runs first regardless, so a
-- NULL shift mask stops the migration before anything has changed.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "staff_shift_assignments" WHERE "days" IS NULL) THEN
    RAISE EXCEPTION 'staff_shift_assignments has rows with a NULL days mask; '
      'set each to the seven-element mask it should have, then re-run this migration';
  END IF;
END
$$;

UPDATE "doctors" SET "languages" = '{}' WHERE "languages" IS NULL;
UPDATE "doctors" SET "education" = '{}' WHERE "education" IS NULL;
UPDATE "doctors" SET "certifications" = '{}' WHERE "certifications" IS NULL;
UPDATE "doctors" SET "skills" = '{}' WHERE "skills" IS NULL;
UPDATE "admin_profiles" SET "education" = '{}' WHERE "education" IS NULL;
UPDATE "admin_profiles" SET "certifications" = '{}' WHERE "certifications" IS NULL;
UPDATE "admin_profiles" SET "experience" = '{}' WHERE "experience" IS NULL;
UPDATE "staff_members" SET "permissions" = '{}' WHERE "permissions" IS NULL;
UPDATE "medications" SET "frequencies" = '{}' WHERE "frequencies" IS NULL;
UPDATE "medications" SET "durations_days" = '{}' WHERE "durations_days" IS NULL;

ALTER TABLE "doctors"
  ALTER COLUMN "languages" SET NOT NULL,
  ALTER COLUMN "education" SET NOT NULL,
  ALTER COLUMN "certifications" SET NOT NULL,
  ALTER COLUMN "skills" SET NOT NULL;

ALTER TABLE "admin_profiles"
  ALTER COLUMN "education" SET NOT NULL,
  ALTER COLUMN "certifications" SET NOT NULL,
  ALTER COLUMN "experience" SET NOT NULL;

ALTER TABLE "staff_members" ALTER COLUMN "permissions" SET NOT NULL;

ALTER TABLE "staff_shift_assignments" ALTER COLUMN "days" SET NOT NULL;

ALTER TABLE "medications"
  ALTER COLUMN "frequencies" SET NOT NULL,
  ALTER COLUMN "durations_days" SET NOT NULL;

ALTER TABLE "scheduled_reports" ALTER COLUMN "recipients" SET NOT NULL;

COMMIT;
-- <<< END MIGRATION: 20261030120000_spec_scalar_lists_not_null


-- >>> BEGIN MIGRATION: 20261030130000_db_branch_additive_columns
-- The Database branch's design (`database/medora.dbml`), integrated where it
-- adds to this schema without contradicting it.
--
-- `medora.dbml` was compared table by table and column by column against
-- the database these migrations build (backend/docs/
-- DATABASE_BRANCH_RECONCILIATION.md). All 97 of its tables already exist
-- here. This migration adds the columns, widths and links it has that this
-- schema lacks. Where the two disagree about something both define — a
-- column's name, a table's shape — nothing is changed here; those are
-- listed in §7 of that document for the owners.
--
-- **Additive only.** No column, table, index or constraint is dropped or
-- renamed, and the four `varchar` changes only widen. On PostgreSQL,
-- widening a `varchar` needs no table rewrite and keeps every index.
--
-- NOT NULL in the design, nullable here, because existing rows have no
-- value and inventing one would be a business decision:
-- `visit_types.code`, `chronic_conditions.code`, `insurance_providers.code`,
-- `policies.body`, `policies.effective_date`, `document_templates.title`,
-- `document_templates.body`.
--
-- The one exception is `appointments.ends_at`. It is computable for every
-- row, so it is backfilled and then enforced by CHECK. A CHECK rather than
-- NOT NULL keeps the Prisma field optional, so `create` does not demand a
-- value the trigger below overwrites anyway.
--
-- One explicit transaction, because `migrate deploy` does not provide one:
-- a failure part-way must not leave columns without their backfill or the
-- triggers that maintain them.

BEGIN;

-- ══ 1. Columns (generated by `prisma migrate diff`) ═════════════════════

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN     "cancelled_by" UUID,
ADD COLUMN     "checked_in_at" TIMESTAMPTZ(3),
ADD COLUMN     "completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "no_show_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "chronic_conditions" ADD COLUMN     "code" VARCHAR(30),
ADD COLUMN     "description" TEXT,
ALTER COLUMN "name" SET DATA TYPE VARCHAR(200);

-- AlterTable
ALTER TABLE "document_templates" ADD COLUMN     "author_id" UUID,
ADD COLUMN     "body" TEXT,
ADD COLUMN     "title" VARCHAR(200);

-- AlterTable
ALTER TABLE "icd_codes" ADD COLUMN     "description" TEXT,
ALTER COLUMN "code" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "label" SET DATA TYPE VARCHAR(255);

-- AlterTable
ALTER TABLE "insurance_providers" ADD COLUMN     "code" VARCHAR(30),
ADD COLUMN     "phone" VARCHAR(30),
ADD COLUMN     "website" TEXT,
ALTER COLUMN "name" SET DATA TYPE VARCHAR(200);

-- AlterTable
ALTER TABLE "policies" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "author_id" UUID,
ADD COLUMN     "body" TEXT,
ADD COLUMN     "effective_date" DATE;

-- AlterTable
ALTER TABLE "resources" ADD COLUMN     "department_id" UUID;

-- AlterTable
ALTER TABLE "visit_types" ADD COLUMN     "code" VARCHAR(30),
ADD COLUMN     "default_duration_min" SMALLINT,
ADD COLUMN     "description" TEXT,
ALTER COLUMN "name" SET DATA TYPE VARCHAR(120);

-- CreateIndex
CREATE UNIQUE INDEX "chronic_conditions_code_key" ON "chronic_conditions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_providers_code_key" ON "insurance_providers"("code");

-- CreateIndex
CREATE INDEX "resources_department_id_idx" ON "resources"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_types_code_key" ON "visit_types"("code");

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ══ 2. What Prisma cannot express ═══════════════════════════════════════

-- DB §9's `duration_min > 0` means a positive default is the only kind that
-- can ever be booked.
ALTER TABLE "visit_types"
  ADD CONSTRAINT "visit_types_default_duration_positive"
  CHECK ("default_duration_min" IS NULL OR "default_duration_min" > 0);

-- ── 2.1 Backfill the appointment lifecycle columns ─────────────────────
--
-- From the evidence that already exists: the slot for `ends_at`,
-- `appointment_events` for the three terminal timestamps and the
-- canceller, and `waiting_room_entries` for the check-in. A terminal row
-- with no matching event keeps NULL: the time it ended is unknown, and
-- `updated_at` is only when it was last touched.

UPDATE "appointments"
SET "ends_at" = "starts_at" + make_interval(mins => "duration_min");

UPDATE "appointments" a
SET "completed_at" = e."at"
FROM (
  SELECT "appointment_id", max("occurred_at") AS "at"
  FROM "appointment_events" WHERE "to_status" = 'completed' GROUP BY 1
) e
WHERE a."id" = e."appointment_id" AND a."status" = 'completed';

UPDATE "appointments" a
SET "no_show_at" = e."at"
FROM (
  SELECT "appointment_id", max("occurred_at") AS "at"
  FROM "appointment_events" WHERE "to_status" = 'no-show' GROUP BY 1
) e
WHERE a."id" = e."appointment_id" AND a."status" = 'no-show';

UPDATE "appointments" a
SET "cancelled_at" = e."occurred_at", "cancelled_by" = e."actor_id"
FROM (
  SELECT DISTINCT ON ("appointment_id") "appointment_id", "occurred_at", "actor_id"
  FROM "appointment_events" WHERE "to_status" = 'cancelled'
  ORDER BY "appointment_id", "occurred_at" DESC
) e
WHERE a."id" = e."appointment_id" AND a."status" = 'cancelled';

UPDATE "appointments" a
SET "checked_in_at" = w."at"
FROM (
  SELECT "appointment_id", max("checked_in_at") AS "at"
  FROM "waiting_room_entries"
  WHERE "appointment_id" IS NOT NULL AND "deleted_at" IS NULL
  GROUP BY 1
) w
WHERE a."id" = w."appointment_id";

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_ends_at_present" CHECK ("ends_at" IS NOT NULL);

-- ── 2.2 Keep them derived ──────────────────────────────────────────────
--
-- Triggers rather than service code, for the reason the transition matrix
-- (M5.10) is one: every writer — the appointments module, the oversight
-- routes, a seed, a hand-written fix — gets the same answer, and no caller
-- can store an `ends_at` that disagrees with the slot.

-- `ends_at` on every write. The terminal timestamps only on a *transition*:
-- an appointment inserted already completed (an import) has no known
-- completion time, so one supplied by the caller is kept and none is
-- invented. The terminal states cannot be left (M5.10), so each is set
-- once.
CREATE FUNCTION derive_appointment_columns() RETURNS trigger AS $$
BEGIN
  NEW.ends_at := NEW.starts_at + make_interval(mins => NEW.duration_min);

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'completed' THEN
      NEW.completed_at := coalesce(NEW.completed_at, now());
    ELSIF NEW.status = 'cancelled' THEN
      NEW.cancelled_at := coalesce(NEW.cancelled_at, now());
    ELSIF NEW.status = 'no-show' THEN
      NEW.no_show_at := coalesce(NEW.no_show_at, now());
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointments_derive_columns
  BEFORE INSERT OR UPDATE ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION derive_appointment_columns();

-- The canceller is the event's actor, not `appointments.updated_by`. A
-- transition by a non-user actor leaves `updated_by` holding whoever wrote
-- the row last, so it would name the wrong person.
CREATE FUNCTION record_appointment_canceller() RETURNS trigger AS $$
BEGIN
  IF NEW.to_status = 'cancelled' AND NEW.actor_id IS NOT NULL THEN
    UPDATE "appointments"
    SET "cancelled_by" = NEW.actor_id
    WHERE "id" = NEW.appointment_id
      AND "status" = 'cancelled'
      AND "cancelled_by" IS NULL;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointment_events_record_canceller
  AFTER INSERT ON "appointment_events"
  FOR EACH ROW EXECUTE FUNCTION record_appointment_canceller();

-- The latest live check-in, recomputed for every appointment a write
-- touches, both before and after it. Recomputing rather than copying
-- means a soft-deleted entry (checked in by mistake) or a moved one
-- leaves the old appointment correct too.
CREATE FUNCTION mirror_appointment_check_in() RETURNS trigger AS $$
DECLARE
  affected uuid[] := ARRAY[]::uuid[];
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.appointment_id IS NOT NULL THEN
    affected := affected || NEW.appointment_id;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.appointment_id IS NOT NULL THEN
    affected := affected || OLD.appointment_id;
  END IF;

  UPDATE "appointments" a
  SET "checked_in_at" = (
    SELECT max(w."checked_in_at") FROM "waiting_room_entries" w
    WHERE w."appointment_id" = a."id" AND w."deleted_at" IS NULL
  )
  WHERE a."id" = ANY(affected);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER waiting_room_entries_mirror_check_in
  AFTER INSERT OR DELETE OR UPDATE OF "appointment_id", "checked_in_at", "deleted_at"
  ON "waiting_room_entries"
  FOR EACH ROW EXECUTE FUNCTION mirror_appointment_check_in();

COMMIT;
-- <<< END MIGRATION: 20261030130000_db_branch_additive_columns


-- >>> BEGIN MIGRATION: 20261030140000_trusted_device_push_token
-- Push-device registration (RM M41.2; patient mobile contract P5.8,
-- `POST /me/devices (push token)`).
--
-- An optional push token on the device a user already registers at
-- `POST /me/devices`. Nullable: a trusted device need not accept push, and
-- every existing row has none. Indexed because registering a token clears
-- it from any other device first (one device holds a given token).
--
-- Additive only.

-- AlterTable
ALTER TABLE "trusted_devices" ADD COLUMN     "push_token" VARCHAR(1024);

-- CreateIndex
CREATE INDEX "trusted_devices_push_token_idx" ON "trusted_devices"("push_token");
-- <<< END MIGRATION: 20261030140000_trusted_device_push_token


-- >>> BEGIN MIGRATION: 20261105100000_idempotency_records
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
-- <<< END MIGRATION: 20261105100000_idempotency_records


-- >>> BEGIN MIGRATION: 20261113090000_index_review
-- Index review (database re-engineering, 2026-11-13).
--
-- Every foreign key without a supporting index, and every index that
-- duplicates another, was listed from the live catalog of a database
-- migrated from zero. Each was then checked against the queries the
-- backend actually issues. Indexing all 75 unindexed foreign keys would
-- add write cost to every clinical insert for lookups nothing performs.
-- Most of them are `*_by` audit columns pointing at `users`, which are
-- soft-deleted and never filtered on. Two changes survived that check.
--
-- 1. `doctor_availability (doctor_id, weekday)` is a leading prefix of the
--    unique `(doctor_id, weekday, start_time)`. Postgres serves every
--    lookup the smaller one served from the unique index, so the smaller
--    one cost a write and bought nothing.
--
-- 2. `scheduled_reports (owner_id, created_at DESC)` is new.
--    `SavedReportRepository.listScheduled` reads exactly
--    `WHERE owner_id = $1 ORDER BY created_at DESC`. Deleting a user
--    cascades into this table through the same column. Both were
--    sequential scans.
--
-- Generated by `prisma migrate diff`; neither statement touches row data.

-- DropIndex
DROP INDEX "doctor_availability_doctor_id_weekday_idx";

-- CreateIndex
CREATE INDEX "scheduled_reports_owner_id_created_at_idx" ON "scheduled_reports"("owner_id", "created_at" DESC);
-- <<< END MIGRATION: 20261113090000_index_review


-- >>> BEGIN MIGRATION: 20261113100000_appointment_no_overlap
-- No double booking, enforced by the database (DR-11; ADR-005 §4 rule 4).
--
-- Until now the overlap rule was a read followed by a write.
-- `SlotConflictChecker.assertBookable` reads the doctor's live bookings,
-- then `AppointmentRepository.create` or `transition` inserts or moves
-- the row, with no transaction or lock between the two. Two requests for
-- the same doctor and slot can both read an empty book and both write.
-- The pre-check cannot see a row that is not committed yet, so only a
-- constraint closes the gap. The same reasoning is why e-mail uniqueness
-- is a unique index and not a pre-check (`shared/database/prisma-errors.ts`).
--
-- The constraint enforces the hard invariant: two live, non-deleted
-- appointments of one doctor never share an instant. The buffer between
-- appointments (`bufferMin`) stays a scheduling rule in the checker.
-- It is a doctor preference that can change after bookings exist, so
-- freezing today's value into a constraint would be wrong.
--
-- "Live" is `LIVE_STATUSES` in `appointment.repository.ts`, in the
-- database's spelling. A cancelled, completed or no-show appointment
-- occupies no slot. `deleted_at IS NULL` matches the soft-delete filter
-- the checker reads through.
--
-- `ends_at` is maintained by the `derive_appointment_columns` BEFORE
-- trigger (migration 20261030130000). The constraint therefore sees the
-- derived end, never a value a caller supplied.
--
-- Upgrade safety: the preflight below refuses to proceed when existing
-- rows already overlap, and names the query that lists them. It never
-- cancels or moves an appointment, because which of two clashing bookings
-- wins is a clinical decision, not a migration's. On a database with no
-- overlaps the constraint is added in one transaction.
--
-- `btree_gist` provides the `=` operator class on `uuid` that a GiST
-- exclusion constraint needs. It ships with PostgreSQL contrib, and
-- `IF NOT EXISTS` mirrors 20260814120000_enable_extensions.
--
-- No explicit BEGIN/COMMIT. `migrate deploy` sends this file as one
-- multi-statement query, which PostgreSQL runs as one implicit
-- transaction: when the preflight raises, the extension is rolled back
-- too. With an explicit BEGIN the raise would leave the session in an
-- aborted transaction block. Prisma's own bookkeeping statement would then
-- fail with "current transaction is aborted", which hides the preflight's
-- message and leaves the migration's `logs` empty. Verified both ways
-- against PostgreSQL 16 while writing this migration.

CREATE EXTENSION IF NOT EXISTS "btree_gist";

DO $$
DECLARE
  clashes integer;
BEGIN
  SELECT count(*) INTO clashes
  FROM "appointments" a
  JOIN "appointments" b
    ON a."doctor_id" = b."doctor_id"
   AND a."id" < b."id"
   AND tstzrange(a."starts_at", a."ends_at", '[)') && tstzrange(b."starts_at", b."ends_at", '[)')
  WHERE a."deleted_at" IS NULL AND b."deleted_at" IS NULL
    AND a."status" IN ('scheduled', 'confirmed', 'pending', 'rescheduled', 'awaiting-patient')
    AND b."status" IN ('scheduled', 'confirmed', 'pending', 'rescheduled', 'awaiting-patient');

  IF clashes > 0 THEN
    RAISE EXCEPTION 'appointments_no_overlap: % pair(s) of live appointments already overlap', clashes
      USING HINT = 'Resolve them first (cancel or reschedule one of each pair), then re-run the migration. '
                || 'The pairs are listed by the SELECT in this migration''s preflight block.';
  END IF;
END $$;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "doctor_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE (
    "deleted_at" IS NULL
    AND "status" IN ('scheduled', 'confirmed', 'pending', 'rescheduled', 'awaiting-patient')
  );
-- <<< END MIGRATION: 20261113100000_appointment_no_overlap

