-- Patient appointment actions (ADR-049): reschedule REQUESTS, and one live
-- booking per published slot.
--
-- 1. `appointment_reschedule_requests` — a patient's request to move a booked
--    appointment to another published slot of the same doctor at the same
--    hospital. Composite keys make that the only representable shape: the
--    request shares `hospital_id` with its appointment, and names the slot by
--    (id, hospital_id, doctor_employment_id). At most one PENDING request per
--    appointment (partial unique index). The requested slot is not reserved;
--    staff approval re-checks it inside the moving transaction.
-- 2. `appointments_one_live_booking_per_slot` — the phase-21 index
--    `appointments_one_active_booking_per_slot` excludes `rescheduled`, but a
--    rescheduled appointment is a live booking at its (new) time. This index
--    counts it. The older index is left in place (it is a subset).
-- 3. `appointments_id_hospital_key` — the target of the request's composite
--    foreign key (id is already unique; this adds no new constraint on data).
-- 4. Row-Level Security on the new table, a Direct hospital-owned table:
--    visible exactly when its appointment is visible AND belongs to the same
--    hospital; written only where the appointment is clinically writable
--    (own hospital, the patient themselves, or system).

-- CreateTable
CREATE TABLE "appointment_reschedule_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "hospital_id" UUID NOT NULL,
    "doctor_employment_id" UUID NOT NULL,
    "requested_slot_id" UUID NOT NULL,
    "requested_by" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "note" VARCHAR(300),
    "decision_reason" VARCHAR(300),
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_reschedule_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_reschedule_requests_appointment_idx" ON "appointment_reschedule_requests"("appointment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "appointment_reschedule_requests_hospital_status_idx" ON "appointment_reschedule_requests"("hospital_id", "status");

-- CreateIndex
CREATE INDEX "appointment_reschedule_requests_slot_idx" ON "appointment_reschedule_requests"("requested_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_reschedule_requests_one_pending" ON "appointment_reschedule_requests"("appointment_id") WHERE ((status)::text = 'pending'::text);

-- CreateIndex
CREATE UNIQUE INDEX "appointments_one_live_booking_per_slot" ON "appointments"("published_slot_id") WHERE (published_slot_id IS NOT NULL) AND (status <> ALL (ARRAY['cancelled'::appointment_status, 'completed'::appointment_status, 'no-show'::appointment_status]));

-- CreateIndex
CREATE UNIQUE INDEX "appointments_id_hospital_key" ON "appointments"("id", "hospital_id");

-- AddForeignKey
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_appointment_fkey" FOREIGN KEY ("appointment_id", "hospital_id") REFERENCES "appointments"("id", "hospital_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_slot_fkey" FOREIGN KEY ("requested_slot_id", "hospital_id", "doctor_employment_id") REFERENCES "published_slots"("id", "hospital_id", "doctor_employment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The closed status vocabulary.
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_status_check"
  CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'superseded'));
-- A decided request records when; a pending one has no decision.
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_decision_check"
  CHECK ((status = 'pending') = (decided_at IS NULL));
-- A rejection carries its reason (P4).
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_rejection_reason_check"
  CHECK (status <> 'rejected' OR decision_reason IS NOT NULL);

-- The tenant keys never move in place (as on every hospital-owned table).
CREATE TRIGGER hospitalscope_reschedule_requests_trg BEFORE UPDATE OF hospital_id, doctor_employment_id
  ON public.appointment_reschedule_requests FOR EACH ROW
  EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'doctor_employment_id');

-- Row-Level Security.
ALTER TABLE public.appointment_reschedule_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointment_reschedule_requests_read ON public.appointment_reschedule_requests FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.appointments a
                  WHERE a.id = appointment_reschedule_requests.appointment_id
                    AND a.hospital_id = appointment_reschedule_requests.hospital_id));
CREATE POLICY appointment_reschedule_requests_insert ON public.appointment_reschedule_requests FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.appointments a
                       WHERE a.id = appointment_reschedule_requests.appointment_id
                         AND a.hospital_id = appointment_reschedule_requests.hospital_id
                         AND app_rls.clinical_writable(a.hospital_id, a.patient_id)));
CREATE POLICY appointment_reschedule_requests_update ON public.appointment_reschedule_requests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.appointments a
                  WHERE a.id = appointment_reschedule_requests.appointment_id
                    AND a.hospital_id = appointment_reschedule_requests.hospital_id
                    AND app_rls.clinical_writable(a.hospital_id, a.patient_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.appointments a
                       WHERE a.id = appointment_reschedule_requests.appointment_id
                         AND a.hospital_id = appointment_reschedule_requests.hospital_id
                         AND app_rls.clinical_writable(a.hospital_id, a.patient_id)));
CREATE POLICY appointment_reschedule_requests_delete ON public.appointment_reschedule_requests FOR DELETE
  USING (app_rls.scope() = 'system');
