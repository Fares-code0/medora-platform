-- ADR-045 — an idempotent refresh rotation inside a 30-second grace window.
--
-- A rotation whose response is lost, two tabs sharing one cookie, or two
-- concurrent refreshes all re-present the token the rotation just retired.
-- M6.3 matched it on `previous_token_hash` and revoked the session as a
-- replay — a false positive that signed out a user who did nothing wrong.
--
-- `rotated_at` starts the grace window, and `successor_token_ct` holds the
-- token the rotation issued, envelope-encrypted (AES-256-GCM,
-- `DATA_ENCRYPTION_KEY`), so the retry can be answered with that same
-- token instead of a revocation. Both are written by the conditional
-- UPDATE that rotates, overwritten by the next one, and nulled on
-- revocation.
--
-- Nullable, no default and no backfill: a session that has never rotated
-- has no successor, and every existing row keeps the M6.3 behaviour until
-- its next refresh. `bytea` for the reason `totp_secret_enc` is.
--
-- Additive only.

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "rotated_at" TIMESTAMPTZ(3),
ADD COLUMN     "successor_token_ct" BYTEA;

-- A revoked session holds no successor. A trigger rather than service code,
-- for the reason `derive_appointment_columns` is one: sessions are revoked
-- by direct UPDATEs in more than one module (logout, sign out everywhere, a
-- password reset, a 2FA change, an administrator's suspension, the admin
-- bootstrap, single-session sign-in), and every one of them — and the next
-- one written — must drop the ciphertext with the revocation rather than
-- leave a live token at rest on a row nobody will rotate again. `SessionService.revoke` and
-- `revokeAllFor` also null both columns themselves; this is the backstop.
CREATE FUNCTION clear_revoked_session_successor() RETURNS trigger AS $$
BEGIN
  NEW.successor_token_ct := NULL;
  NEW.rotated_at := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_clear_revoked_successor
  BEFORE INSERT OR UPDATE ON "sessions"
  FOR EACH ROW
  WHEN (NEW.revoked_at IS NOT NULL
        AND (NEW.successor_token_ct IS NOT NULL OR NEW.rotated_at IS NOT NULL))
  EXECUTE FUNCTION clear_revoked_session_successor();

-- RA-045.1: `auth.refresh-successor-sweep` nulls `successor_token_ct` once
-- `rotated_at` is past the 30-second window, every minute. Partial, so a
-- run reads only the handful of rows still holding a successor rather than
-- scanning a table that keeps every ended session. Not in the Prisma schema:
-- Prisma cannot express the predicate (as with `api_keys_live_idx`).
CREATE INDEX "sessions_successor_rotated_at_idx" ON "sessions" ("rotated_at")
  WHERE "successor_token_ct" IS NOT NULL;
