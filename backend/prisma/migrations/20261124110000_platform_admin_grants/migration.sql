-- Explicit Platform Admin scope (OD-07; multi-hospital §2.2).
-- Generated DDL first, then hand-written constraints Prisma cannot express.

-- CreateTable
CREATE TABLE "platform_admin_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "granted_by" UUID,
    "reason" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,

    CONSTRAINT "platform_admin_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_admin_grants_user_revoked_idx" ON "platform_admin_grants"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_grants_one_active_per_user_key" ON "platform_admin_grants"("user_id") WHERE (revoked_at IS NULL);

-- AddForeignKey
ALTER TABLE "platform_admin_grants" ADD CONSTRAINT "platform_admin_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_admin_grants" ADD CONSTRAINT "platform_admin_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_admin_grants" ADD CONSTRAINT "platform_admin_grants_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Hand-written ─────────────────────────────────────────────────────────

-- A grant states why it exists, and nobody grants platform scope to themselves.
ALTER TABLE "platform_admin_grants"
  ADD CONSTRAINT "platform_admin_grants_reason_check" CHECK (char_length(btrim(reason)) >= 12),
  ADD CONSTRAINT "platform_admin_grants_not_self_check" CHECK (granted_by IS NULL OR granted_by <> user_id),
  ADD CONSTRAINT "platform_admin_grants_revocation_check"
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NULL));

-- Platform scope and Hospital Admin scope are mutually exclusive (§2.2,
-- §2.3): an account may hold an active platform grant or an active
-- hospital `admin` assignment, never both. Enforced from both sides.
CREATE FUNCTION platform_admin_grants_exclusive() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NULL AND EXISTS (
    SELECT 1 FROM hospital_role_assignments hra
      JOIN roles r ON r.id = hra.role_id
     WHERE hra.user_id = NEW.user_id AND hra.revoked_at IS NULL AND r.code = 'admin'
  ) THEN
    RAISE EXCEPTION 'user % holds an active Hospital Admin assignment', NEW.user_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.revoked_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = NEW.user_id AND r.code = 'admin'
  ) THEN
    RAISE EXCEPTION 'platform scope requires the admin role (user %)', NEW.user_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER platform_admin_grants_exclusive
  BEFORE INSERT OR UPDATE ON platform_admin_grants
  FOR EACH ROW EXECUTE FUNCTION platform_admin_grants_exclusive();

CREATE FUNCTION hospital_admin_assignment_exclusive() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM roles r WHERE r.id = NEW.role_id AND r.code = 'admin')
     AND EXISTS (SELECT 1 FROM platform_admin_grants g
                  WHERE g.user_id = NEW.user_id AND g.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'user % holds an active Platform Admin grant', NEW.user_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER hospital_role_assignments_admin_exclusive
  BEFORE INSERT OR UPDATE ON hospital_role_assignments
  FOR EACH ROW EXECUTE FUNCTION hospital_admin_assignment_exclusive();

-- History is preserved: a grant is revoked, never deleted.
CREATE FUNCTION platform_admin_grants_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform_admin_grants rows are revoked, never deleted' USING ERRCODE = '42501';
END $$;

CREATE TRIGGER platform_admin_grants_no_delete
  BEFORE DELETE ON platform_admin_grants
  FOR EACH ROW EXECUTE FUNCTION platform_admin_grants_no_delete();

-- No existing account is granted platform scope here. Legacy unmapped
-- administrator accounts are left unchanged (owner decision); their
-- deletion is a mandatory pre-production cleanup step.
