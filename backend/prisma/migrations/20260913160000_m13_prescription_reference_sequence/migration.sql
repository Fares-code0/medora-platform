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
