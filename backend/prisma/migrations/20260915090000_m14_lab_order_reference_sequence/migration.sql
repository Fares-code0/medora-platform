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
