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
