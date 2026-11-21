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
