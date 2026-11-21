-- ADR-035 — administrators are invited; doctors declare a register.
--
-- Two independent additions, both purely additive. No column is dropped,
-- no type changed, no existing row rewritten, and no backfill runs. Every
-- `doctors` row keeps working with `professional_category` NULL, and a
-- database with no invitations behaves exactly as it did.
--
-- ── 1. `doctors.professional_category` ───────────────────────────────
--
-- The register a practitioner's number is listed on. Nullable, because
-- every row that predates this migration has no value for it and there is
-- no honest way to derive one — a category is regulatory data, and
-- guessing "physician" for the five seeded demo doctors would be
-- fabricating it. New registrations supply it; old rows say "unknown" by
-- saying nothing, which is true.
--
-- `varchar(40)` and not a native enum. Medora is specified to be
-- internationally extensible, and the category vocabulary belongs to
-- whichever register a jurisdiction runs — SCFHS names five, another
-- regulator names a different set. An enum would freeze one country's
-- list into the schema and make every additional jurisdiction a
-- migration; the validated vocabulary lives in the DTO instead, where
-- adding a register is an ordinary code change. ADR-023 already records
-- that not every constrained string in this schema is an enum, and this
-- is that case rather than an oversight.
--
-- ── 2. `admin_invitations` ───────────────────────────────────────────
--
-- A new table rather than a nullable `user_id` on `verification_tokens`,
-- because an invitation is not a token about an account — it is the
-- authority to create one, and it exists before any account does. Making
-- `verification_tokens.user_id` nullable to fit it would weaken a NOT NULL
-- that is load-bearing for every existing consumer of that table.
--
-- ON DELETE, one clause at a time:
--   · `role_id`    RESTRICT — matches `users.role_id`. A role with
--                  invitations outstanding must not vanish under them.
--   · `invited_by` CASCADE  — the FK is to the inviting administrator.
--   · `user_id`    SET NULL — the invitation record is the audit trail of
--                  how a privileged account came to exist, and it must
--                  survive that account being removed. CASCADE here would
--                  delete the evidence along with the subject.
--
-- `token_hash` is UNIQUE, like `verification_tokens.token_hash`: the
-- lookup is by hash, and two invitations sharing one is not a reachable
-- state. The raw token lives in the emailed link and nowhere else, so a
-- disclosure of this table cannot be replayed into an admin account.

-- 1 ──────────────────────────────────────────────────────────────────
ALTER TABLE "doctors" ADD COLUMN "professional_category" VARCHAR(40);

-- 2 ──────────────────────────────────────────────────────────────────
CREATE TABLE "admin_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "invited_by" UUID NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_invitations_token_hash_key" ON "admin_invitations"("token_hash");
CREATE INDEX "admin_invitations_email_idx" ON "admin_invitations"("email");
CREATE INDEX "admin_invitations_expires_at_idx" ON "admin_invitations"("expires_at");

ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_invited_by_fkey"
  FOREIGN KEY ("invited_by") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
