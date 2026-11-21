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
