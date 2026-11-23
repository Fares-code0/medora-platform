-- Owner decision 2026-11-23 (Decision 2, option A): MRD-05 (a) — one active
-- employment for non-doctor staff, enforced in the database the way DR-02 is
-- for doctors (doctor_employments_one_active_per_doctor_key).
--
-- The existing per-hospital key hospital_staff_affiliations_one_active_per_hospital_key
-- is kept. This adds a global one-active-per-staff key.
--
-- An affiliation is never ended or changed here. If any staff member already
-- has more than one active affiliation, the migration stops with a clear
-- error and creates nothing; which affiliation ends is an owner decision, and
-- ending one revokes the role assignments it sourced
-- (revoke_ended_hospital_affiliation_roles).

BEGIN;

DO $one_active_staff$
DECLARE
  offenders integer;
BEGIN
  SELECT count(*) INTO offenders FROM (
    SELECT staff_id
      FROM public.hospital_staff_affiliations
     WHERE ended_at IS NULL
     GROUP BY staff_id
    HAVING count(*) > 1
  ) duplicate_staff;

  IF offenders > 0 THEN
    RAISE EXCEPTION 'MRD-05 (a): % staff member(s) have more than one active hospital affiliation; resolve them before applying this migration', offenders
      USING ERRCODE = '23505',
            HINT = 'SELECT staff_id, count(*) FROM public.hospital_staff_affiliations WHERE ended_at IS NULL GROUP BY staff_id HAVING count(*) > 1; — ending an affiliation is an owner decision and is never done automatically.';
  END IF;
END
$one_active_staff$;

CREATE UNIQUE INDEX hospital_staff_affiliations_one_active_per_staff_key
  ON public.hospital_staff_affiliations (staff_id)
  WHERE ended_at IS NULL;

COMMIT;
