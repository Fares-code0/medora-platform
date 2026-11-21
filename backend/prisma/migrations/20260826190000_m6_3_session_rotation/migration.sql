-- M6.3 — reuse detection for rotated refresh tokens.
--
-- `sessions.refresh_token_hash` is overwritten on every rotation, so a
-- replayed old token matches no row and cannot be told from a random
-- string. This column keeps one generation back, which is what makes the
-- canonical theft detectable: the attacker refreshes with the stolen
-- token, and the real client's next refresh presents the token it still
-- holds — landing here instead of nowhere.
--
-- Nullable by design: a session that has never been refreshed has no
-- previous hash, and a zero value would be a lie about that. Unique for
-- the same reason the current hash is; Postgres permits any number of
-- NULLs under a unique index, so the constraint costs nothing on rows
-- that have not rotated yet.
ALTER TABLE "sessions" ADD COLUMN "previous_token_hash" TEXT;

CREATE UNIQUE INDEX "sessions_previous_token_hash_key" ON "sessions"("previous_token_hash");
