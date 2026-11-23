-- Issue #21 — hospital ownership for the two operational queue tables.
--
-- `queue_entries` and `waiting_room_entries` are hospital operations but had
-- no hospital column. Their only parents are optional (`room_id`,
-- `appointment_id`; walk-ins have neither) and may themselves be unowned
-- legacy rows, so ownership cannot be derived: a direct, nullable
-- `hospital_id` is added, following the Phase 21 pattern.
--
-- Additive only. Nothing is dropped, rewritten or backfilled: existing rows
-- keep `hospital_id IS NULL` until an owner-approved mapping exists (#17).
-- Rules for hospital-owned rows:
--   * `hospital_id` references `hospitals` (ON DELETE RESTRICT);
--   * once assigned it cannot change in place (prevent_tenant_scope_reassignment);
--   * a hospital-owned row whose room / appointment is set must belong to the
--     same hospital as that parent. Legacy rows (hospital_id NULL) are not
--     checked, so existing operations on them behave exactly as before.
-- Small tables; the FK validation and index builds scan them once.

BEGIN;

ALTER TABLE public.queue_entries ADD COLUMN hospital_id uuid;
ALTER TABLE public.waiting_room_entries ADD COLUMN hospital_id uuid;

ALTER TABLE public.queue_entries
  ADD CONSTRAINT queue_entries_hospital_id_fkey FOREIGN KEY (hospital_id)
  REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.waiting_room_entries
  ADD CONSTRAINT waiting_room_entries_hospital_id_fkey FOREIGN KEY (hospital_id)
  REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX queue_entries_hospital_enqueued_idx
  ON public.queue_entries(hospital_id, enqueued_at);
CREATE INDEX waiting_room_entries_hospital_status_idx
  ON public.waiting_room_entries(hospital_id, status, checked_in_at);

-- One function per table: a shared function naming NEW.room_id and
-- NEW.appointment_id would fail on the table lacking one of them (the defect
-- 20261123100000 corrected for validate_scoped_clinical_links).
CREATE FUNCTION public.validate_queue_entry_hospital()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $queue_hospital$
DECLARE parent_hospital uuid;
BEGIN
  IF NEW.hospital_id IS NULL OR NEW.room_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT hospital_id INTO parent_hospital FROM public.rooms WHERE id = NEW.room_id;
  IF parent_hospital IS DISTINCT FROM NEW.hospital_id THEN
    RAISE EXCEPTION 'Queue entry room must belong to the queue entry hospital'
      USING ERRCODE = '23514', CONSTRAINT = 'queue_entries_room_hospital_check';
  END IF;
  RETURN NEW;
END
$queue_hospital$;

CREATE FUNCTION public.validate_waiting_room_entry_hospital()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $waiting_hospital$
DECLARE parent_hospital uuid;
BEGIN
  IF NEW.hospital_id IS NULL OR NEW.appointment_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT hospital_id INTO parent_hospital FROM public.appointments WHERE id = NEW.appointment_id;
  IF parent_hospital IS DISTINCT FROM NEW.hospital_id THEN
    RAISE EXCEPTION 'Waiting-room entry appointment must belong to the entry hospital'
      USING ERRCODE = '23514', CONSTRAINT = 'waiting_room_entries_appointment_hospital_check';
  END IF;
  RETURN NEW;
END
$waiting_hospital$;

CREATE TRIGGER queue_entries_hospital_link_trg
  BEFORE INSERT OR UPDATE OF hospital_id, room_id ON public.queue_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_queue_entry_hospital();
CREATE TRIGGER waiting_room_entries_hospital_link_trg
  BEFORE INSERT OR UPDATE OF hospital_id, appointment_id ON public.waiting_room_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_waiting_room_entry_hospital();

CREATE TRIGGER hospitalscope_queue_entries_trg
  BEFORE UPDATE OF hospital_id ON public.queue_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_waiting_room_entries_trg
  BEFORE UPDATE OF hospital_id ON public.waiting_room_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');

COMMIT;
