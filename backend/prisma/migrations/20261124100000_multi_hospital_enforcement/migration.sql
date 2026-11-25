-- Multi-hospital enforcement foundation (multi-hospital implementation
-- T2). Generated DDL from the Prisma schema first, then the constraints and
-- data changes Prisma cannot express. No existing row is reassigned to a
-- hospital: legacy NULL ownership stays NULL (§2.14).

-- AlterTable
ALTER TABLE "hospitals" ADD COLUMN     "exceptional_access_requires_approval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "hospital_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "authz_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "exceptional_access_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(20) NOT NULL,
    "requester_user_id" UUID NOT NULL,
    "hospital_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "hospital_medical_record_id" UUID NOT NULL,
    "categories" VARCHAR(40)[],
    "reason" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "requires_approval" BOOLEAN NOT NULL,
    "approver_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "reauthenticated_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_outcome" VARCHAR(20),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exceptional_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "information_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requester_user_id" UUID NOT NULL,
    "requester_hospital_id" UUID,
    "target_hospital_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "hospital_medical_record_id" UUID NOT NULL,
    "requested_items" VARCHAR(40)[],
    "reason" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "approved_items" VARCHAR(40)[] DEFAULT ARRAY[]::VARCHAR(40)[],
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "share_expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "information_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "table_name" VARCHAR(63) NOT NULL,
    "row_id" UUID NOT NULL,
    "hospital_id" UUID NOT NULL,
    "evidence_rule" VARCHAR(60) NOT NULL,
    "evidence" JSONB NOT NULL,
    "actor_id" UUID,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ownership_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exceptional_access_grants_requester_status_idx" ON "exceptional_access_grants"("requester_user_id", "status");

-- CreateIndex
CREATE INDEX "exceptional_access_grants_hospital_status_idx" ON "exceptional_access_grants"("hospital_id", "status");

-- CreateIndex
CREATE INDEX "exceptional_access_grants_patient_idx" ON "exceptional_access_grants"("patient_id");

-- CreateIndex
CREATE INDEX "information_requests_target_status_idx" ON "information_requests"("target_hospital_id", "status");

-- CreateIndex
CREATE INDEX "information_requests_requester_status_idx" ON "information_requests"("requester_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ownership_assignments_table_row_key" ON "ownership_assignments"("table_name", "row_id");

-- CreateIndex
CREATE UNIQUE INDEX "hospital_role_assignments_one_active_per_user_key" ON "hospital_role_assignments"("user_id") WHERE (revoked_at IS NULL);

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptional_access_grants" ADD CONSTRAINT "exceptional_access_grants_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptional_access_grants" ADD CONSTRAINT "exceptional_access_grants_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptional_access_grants" ADD CONSTRAINT "exceptional_access_grants_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptional_access_grants" ADD CONSTRAINT "exceptional_access_grants_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptional_access_grants" ADD CONSTRAINT "exceptional_access_grants_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptional_access_grants" ADD CONSTRAINT "exceptional_access_grants_record_scope_fkey" FOREIGN KEY ("hospital_medical_record_id", "hospital_id", "patient_id") REFERENCES "hospital_medical_records"("id", "hospital_id", "patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_requester_hospital_id_fkey" FOREIGN KEY ("requester_hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_target_hospital_id_fkey" FOREIGN KEY ("target_hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_record_scope_fkey" FOREIGN KEY ("hospital_medical_record_id", "target_hospital_id", "patient_id") REFERENCES "hospital_medical_records"("id", "hospital_id", "patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written constraints ─────────────────────────────────────────────

-- Custom roles are hospital-scoped; system roles never carry a hospital.
ALTER TABLE public.roles ADD CONSTRAINT roles_system_has_no_hospital_check
  CHECK (NOT is_system OR hospital_id IS NULL);

ALTER TABLE public.exceptional_access_grants
  ADD CONSTRAINT exceptional_access_grants_kind_check CHECK (kind IN ('EXCEPTIONAL', 'EMERGENCY')),
  ADD CONSTRAINT exceptional_access_grants_status_check
    CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED', 'REVOKED', 'EXPIRED')),
  ADD CONSTRAINT exceptional_access_grants_categories_check CHECK (cardinality(categories) > 0),
  ADD CONSTRAINT exceptional_access_grants_reason_check CHECK (length(btrim(reason)) >= 12),
  ADD CONSTRAINT exceptional_access_grants_duration_check CHECK (duration_minutes BETWEEN 1 AND 1440),
  -- Nobody approves their own request (§2.11).
  ADD CONSTRAINT exceptional_access_grants_independent_approver_check
    CHECK (approver_user_id IS NULL OR approver_user_id <> requester_user_id),
  ADD CONSTRAINT exceptional_access_grants_reviewer_check
    CHECK (reviewed_by IS NULL OR reviewed_by <> requester_user_id),
  -- An active grant always has a bounded window.
  ADD CONSTRAINT exceptional_access_grants_window_check
    CHECK (status <> 'ACTIVE' OR (starts_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at > starts_at)),
  -- Emergency overrides never wait for approval; exceptional access that
  -- needs approval cannot be ACTIVE without an approver.
  ADD CONSTRAINT exceptional_access_grants_approval_check
    CHECK (status <> 'ACTIVE' OR NOT requires_approval OR approver_user_id IS NOT NULL),
  ADD CONSTRAINT exceptional_access_grants_review_outcome_check
    CHECK (review_outcome IS NULL OR review_outcome IN ('JUSTIFIED', 'UNJUSTIFIED'));

ALTER TABLE public.information_requests
  ADD CONSTRAINT information_requests_status_check
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED')),
  ADD CONSTRAINT information_requests_items_check CHECK (cardinality(requested_items) > 0),
  ADD CONSTRAINT information_requests_reason_check CHECK (length(btrim(reason)) >= 12),
  -- Only requested items can be approved, and approval is time-bound.
  ADD CONSTRAINT information_requests_approved_subset_check CHECK (approved_items <@ requested_items),
  ADD CONSTRAINT information_requests_approval_window_check
    CHECK (status <> 'APPROVED' OR (cardinality(approved_items) > 0 AND share_expires_at IS NOT NULL)),
  -- The requester cannot decide their own request.
  ADD CONSTRAINT information_requests_independent_decider_check
    CHECK (decided_by IS NULL OR decided_by <> requester_user_id),
  -- Cross-hospital by definition.
  ADD CONSTRAINT information_requests_cross_hospital_check
    CHECK (requester_hospital_id IS NULL OR requester_hospital_id <> target_hospital_id);

-- The ownership evidence log is append-only.
CREATE OR REPLACE FUNCTION public.ownership_assignments_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'ownership_assignments is append-only' USING ERRCODE = '55000';
END
$fn$;
CREATE TRIGGER ownership_assignments_append_only_trg
  BEFORE UPDATE OR DELETE ON public.ownership_assignments
  FOR EACH ROW EXECUTE FUNCTION public.ownership_assignments_append_only();

-- §2.1 (no default PHI for administrators) is enforced by the server
-- policy overlay (src/shared/authz/authz-policy.ts), not by deleting
-- role_permissions rows: the matrix stays the shared display vocabulary.
