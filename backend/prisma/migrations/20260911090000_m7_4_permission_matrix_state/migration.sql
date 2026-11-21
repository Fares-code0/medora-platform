-- M7.4 — the permission matrix gains a revision (API §15.2–15.3).
--
-- Purely additive: one new table, one seeded row, nothing dropped and no
-- existing row rewritten. A database that never reads it behaves exactly
-- as it did.
--
-- ── Why a table and not a `platform_settings` key ────────────────────
--
-- `platform_settings` was the obvious home and is the wrong one.
-- `platform_settings_key_check` restricts that table to DB §L1's eleven
-- slice keys, and its own comment says why: a twelfth key "would be a
-- settings panel with nothing reading it, or a typo silently shadowing a
-- real slice". Widening the CHECK to admit a matrix revision would have
-- spent the property the constraint exists for, on a value that is not a
-- settings slice — nobody edits it in a panel; it is authorization state
-- the save path maintains.
--
-- ── Why the matrix itself is not in here ─────────────────────────────
--
-- `role_permissions` stays the authoritative grid. It is what
-- `PermissionResolver` reads on every cache miss, and a second copy of
-- the matrix would be a second thing to keep in step with it. What that
-- join table cannot hold is an aggregate identity — a set of rows has no
-- version — so API §15.3's concurrent-edit 409 has nothing to compare
-- against. This table is that identity and carries nothing else.
--
-- ── The singleton guard ──────────────────────────────────────────────
--
-- There is one permission matrix, so `id` is pinned to 1 by a CHECK
-- rather than left to convention. Without it, "the revision" is a query
-- that can return two answers, and a compare-and-set against the wrong
-- row silently overwrites somebody's save — which is precisely the
-- failure the revision was added to prevent.
--
-- `revision` starts at 1 to match the frontend's
-- `DEFAULT_PERMISSION_STATE.revision`, so an editor opened against a
-- freshly seeded platform quotes back a number the server recognises.
--
-- `updated_by` is SET NULL on delete, like every other attribution
-- column in this schema: who last changed the matrix outlives their
-- account, and CASCADE here would delete the record of a privileged
-- change along with the administrator who made it.

CREATE TABLE "permission_matrix_state" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID,
    -- No DB default: `@updatedAt` is maintained by Prisma, like every
    -- other `updated_at` in this schema. The baseline row below supplies
    -- its own value.
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "permission_matrix_state_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "permission_matrix_state"
  ADD CONSTRAINT "permission_matrix_state_id_check" CHECK ("id" = 1);

-- A revision only ever moves forward; a negative one would be a bug
-- that made every compare-and-set fail and froze the matrix.
ALTER TABLE "permission_matrix_state"
  ADD CONSTRAINT "permission_matrix_state_revision_check" CHECK ("revision" >= 1);

ALTER TABLE "permission_matrix_state" ADD CONSTRAINT "permission_matrix_state_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The baseline row, so a read never has to create one and a save never
-- races two callers into inserting it.
INSERT INTO "permission_matrix_state" ("id", "revision", "updated_at")
  VALUES (1, 1, CURRENT_TIMESTAMP)
  ON CONFLICT ("id") DO NOTHING;
