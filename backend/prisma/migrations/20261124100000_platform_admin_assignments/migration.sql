-- Explicit Platform Admin designation (S5; OD-07, M-13; approved
-- implementation decisions 2026-11-23, docs/multi-hospital/OWNER_DECISIONS.md).
--
-- The `admin` role alone never makes an account a Platform Admin. An account
-- is one only while it holds a live row here (revoked_at IS NULL). The table is
-- the grant history: a revocation stamps revoked_at/revoked_by/revoke_reason,
-- and a grant is never rewritten or deleted while its account exists.
--
-- Additive: a new table, its indexes and triggers. No existing row, column or
-- constraint changes, and nothing is backfilled: existing `admin` accounts stay
-- unmapped (no administrative scope) until an explicit, reviewed mapping marks
-- them (prisma/backfill/run-platform-admin-designation.ts).

CREATE TABLE "platform_admin_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "grant_reason" VARCHAR(300) NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "revoke_reason" VARCHAR(300),

    CONSTRAINT "platform_admin_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_admin_assignments_grant_reason_check"
      CHECK (length(btrim("grant_reason")) > 0),
    CONSTRAINT "platform_admin_assignments_revocation_check"
      CHECK (("revoked_at" IS NULL AND "revoke_reason" IS NULL AND "revoked_by" IS NULL)
          OR ("revoked_at" IS NOT NULL AND "revoke_reason" IS NOT NULL
              AND length(btrim("revoke_reason")) > 0 AND "revoked_at" >= "granted_at"))
);

CREATE INDEX "platform_admin_assignments_user_granted_idx" ON "platform_admin_assignments"("user_id", "granted_at" DESC);

CREATE UNIQUE INDEX "platform_admin_assignments_one_live_per_user_key" ON "platform_admin_assignments"("user_id") WHERE (revoked_at IS NULL);

-- CASCADE: the history belongs to the account. Accounts are soft-deleted in
-- normal operation (the row and its history stay); only a hard delete of the
-- account itself (test teardown, the never-activated bootstrap invitation)
-- removes it. A direct DELETE is refused by the trigger below.
ALTER TABLE "platform_admin_assignments" ADD CONSTRAINT "platform_admin_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_admin_assignments" ADD CONSTRAINT "platform_admin_assignments_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_admin_assignments" ADD CONSTRAINT "platform_admin_assignments_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One transaction-scoped lock per account, taken by both exclusivity checks
-- below, so a Platform Admin grant and a hospital `admin` assignment for the
-- same account cannot commit concurrently without one seeing the other.
CREATE FUNCTION public.admin_scope_lock(target uuid)
RETURNS void LANGUAGE sql SET search_path = pg_catalog, public AS $lock$
  SELECT pg_advisory_xact_lock(hashtextextended('admin-scope:' || target::text, 0));
$lock$;

-- A live Platform Admin row requires the `admin` role and no live hospital
-- `admin` assignment. A grant is never rewritten; a revoked row is immutable
-- (only the foreign keys' own SET NULL of a deleted granter/revoker applies).
CREATE FUNCTION public.validate_platform_admin_assignment()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $pa$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id
       OR NEW.grant_reason <> OLD.grant_reason OR NEW.granted_at <> OLD.granted_at
       OR (NEW.granted_by IS DISTINCT FROM OLD.granted_by AND NEW.granted_by IS NOT NULL) THEN
      RAISE EXCEPTION 'A Platform Admin grant cannot be rewritten; revoke it and grant again'
        USING ERRCODE = '23514', CONSTRAINT = 'platform_admin_assignments_history_check';
    END IF;
    IF OLD.revoked_at IS NOT NULL AND (
         NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
         OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason
         OR (NEW.revoked_by IS DISTINCT FROM OLD.revoked_by AND NEW.revoked_by IS NOT NULL)) THEN
      RAISE EXCEPTION 'A revoked Platform Admin assignment is immutable history'
        USING ERRCODE = '23514', CONSTRAINT = 'platform_admin_assignments_history_check';
    END IF;
  END IF;

  IF NEW.revoked_at IS NULL THEN
    PERFORM public.admin_scope_lock(NEW.user_id);
    IF NOT EXISTS (
      SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id
       WHERE u.id = NEW.user_id AND r.code = 'admin'
    ) THEN
      RAISE EXCEPTION 'A Platform Admin must hold the admin role'
        USING ERRCODE = '23514', CONSTRAINT = 'platform_admin_assignments_admin_role_check';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.hospital_role_assignments h JOIN public.roles r ON r.id = h.role_id
       WHERE h.user_id = NEW.user_id AND h.revoked_at IS NULL AND r.code = 'admin'
    ) THEN
      RAISE EXCEPTION 'An account cannot be a Platform Admin and a Hospital Admin at once'
        USING ERRCODE = '23514', CONSTRAINT = 'platform_admin_assignments_exclusive_scope_check';
    END IF;
  END IF;
  RETURN NEW;
END
$pa$;

CREATE TRIGGER platform_admin_assignment_validate_trg
  BEFORE INSERT OR UPDATE ON public.platform_admin_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_platform_admin_assignment();

-- History is not deleted while its account exists. The cascade from a hard
-- delete of the account runs after the account row is gone, so it passes.
CREATE FUNCTION public.prevent_platform_admin_assignment_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $pad$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id) THEN
    RAISE EXCEPTION 'Platform Admin assignments are history; revoke instead of deleting'
      USING ERRCODE = '23514', CONSTRAINT = 'platform_admin_assignments_history_check';
  END IF;
  RETURN OLD;
END
$pad$;

CREATE TRIGGER platform_admin_assignment_no_delete_trg
  BEFORE DELETE ON public.platform_admin_assignments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_admin_assignment_delete();

-- The other direction: a live hospital `admin` assignment is refused for an
-- account that is a live Platform Admin.
CREATE FUNCTION public.validate_hospital_admin_not_platform_admin()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $hp$
BEGIN
  IF NEW.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM public.roles r WHERE r.id = NEW.role_id AND r.code = 'admin') THEN
    PERFORM public.admin_scope_lock(NEW.user_id);
    IF EXISTS (
      SELECT 1 FROM public.platform_admin_assignments p
       WHERE p.user_id = NEW.user_id AND p.revoked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'An account cannot be a Platform Admin and a Hospital Admin at once'
        USING ERRCODE = '23514', CONSTRAINT = 'platform_admin_assignments_exclusive_scope_check';
    END IF;
  END IF;
  RETURN NEW;
END
$hp$;

CREATE TRIGGER hospital_admin_not_platform_admin_trg
  BEFORE INSERT OR UPDATE OF user_id, role_id, revoked_at ON public.hospital_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_hospital_admin_not_platform_admin();

-- A role change away from `admin` ends the designation in the same
-- transaction (as 20261123150000 ends the sessions): a demoted account never
-- keeps a live grant that would apply again if it were promoted later.
CREATE FUNCTION public.users_role_change_revokes_platform_admin()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $rc$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.id = NEW.role_id AND r.code = 'admin') THEN
    UPDATE public.platform_admin_assignments
       SET revoked_at = GREATEST(CURRENT_TIMESTAMP, granted_at),
           revoke_reason = 'role_changed'
     WHERE user_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END
$rc$;

CREATE TRIGGER users_role_change_revokes_platform_admin
  AFTER UPDATE OF role_id ON public.users
  FOR EACH ROW
  WHEN (OLD.role_id IS DISTINCT FROM NEW.role_id)
  EXECUTE FUNCTION public.users_role_change_revokes_platform_admin();
