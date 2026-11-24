-- ════════════════════════════════════════════════════════════════════════
-- Runtime database role — provisioning TEMPLATE (not a migration).
-- ════════════════════════════════════════════════════════════════════════
--
-- Run once per environment by an operator, as the migration/owner role,
-- AFTER `npm run db:deploy`. Replace the two tokens first, e.g.:
--
--   sed -e 's/__RUNTIME_ROLE__/medora_app/g' -e 's/__OWNER_ROLE__/medora/g' \
--     provision-runtime-role.sql | psql "<owner connection>" -v ON_ERROR_STOP=1
--
-- Then give the role a password through the approved secret channel
-- (`ALTER ROLE medora_app LOGIN PASSWORD ...`, never committed) and point the
-- application's DATABASE_URL at it. Migrations and seeds keep using the
-- owner role. Design and verification: docs/multi-hospital/DATABASE_ROLES.md,
-- backend/test/database-roles.e2e-spec.ts.
--
-- The runtime role is NOT a superuser, does NOT own any table, has NO
-- BYPASSRLS, and gets data access only — no DDL. Idempotent: safe to re-run.

DO $create_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '__RUNTIME_ROLE__') THEN
    CREATE ROLE __RUNTIME_ROLE__ NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
END
$create_role$;

GRANT USAGE ON SCHEMA public TO __RUNTIME_ROLE__;

-- Data access on every table.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO __RUNTIME_ROLE__;

-- The audit ledger is append-only (ADR-007 R2, ADR-024): read and insert only.
REVOKE UPDATE, DELETE ON public.audit_events FROM __RUNTIME_ROLE__;
-- The grant above reaches every audit_events partition too, and a partition
-- is checked on its own when a query names it directly. Strip every
-- partition back to owner-only, with Row-Level Security and no policy
-- (migration 20261124130000 + 20261125090000, finding F-05). Access goes
-- through the parent, whose policies apply. Re-run this whenever the grant
-- above is re-run.
SELECT public.audit_events_secure_all_partitions();

-- Reference-number sequences used by defaults and triggers.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO __RUNTIME_ROLE__;

-- Functions in public are executable by PUBLIC by default; stated explicitly.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO __RUNTIME_ROLE__;
-- RLS context helpers (migration 20261124130000_rls_enforcement). The
-- policies call them as the runtime role.
GRANT USAGE ON SCHEMA app_rls TO __RUNTIME_ROLE__;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_rls TO __RUNTIME_ROLE__;

-- Tables, sequences and functions created by later migrations (as the owner)
-- are granted automatically. Note: the append-only rule above must be
-- repeated for any new append-only table.
ALTER DEFAULT PRIVILEGES FOR ROLE __OWNER_ROLE__ IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO __RUNTIME_ROLE__;
ALTER DEFAULT PRIVILEGES FOR ROLE __OWNER_ROLE__ IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO __RUNTIME_ROLE__;
ALTER DEFAULT PRIVILEGES FOR ROLE __OWNER_ROLE__ IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO __RUNTIME_ROLE__;

-- Not granted, on purpose: CREATE on the schema, TRUNCATE, REFERENCES,
-- TRIGGER, ownership, role management. The audit partition jobs need no DDL
-- right of their own: they call the owner-defined SECURITY DEFINER functions
-- create_audit_events_partition and drop_audit_events_partition (migration
-- 20261125090000, finding F-05), which validate their input.
