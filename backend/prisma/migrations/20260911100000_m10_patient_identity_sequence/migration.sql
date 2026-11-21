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
