-- ════════════════════════════════════════════════════════════════════════
-- Audit maintenance role — provisioning TEMPLATE (not a migration).
-- ════════════════════════════════════════════════════════════════════════
--
-- Audit retention (dropping monthly audit_events partitions older than the
-- administrator's `retention.auditLogDays`) is the one operation the
-- application runtime role must never perform (security remediation H1;
-- docs/multi-hospital/DATABASE_ROLES.md §4). It runs under this role, from
-- an operator-controlled process: `npm run audit:retention` (src/cli/
-- audit-retention.ts), scheduled by operations, not by the application.
--
-- Run as the migration/owner role, AFTER `npm run db:deploy`. Replace the
-- token first, e.g.:
--
--   sed -e 's/__MAINTENANCE_LOGIN__/medora_audit_retention/g' \
--     provision-audit-maintenance-role.sql | psql "<owner connection>" -v ON_ERROR_STOP=1
--
-- then set the login's password through the approved secret channel and
-- give its URL to the retention process as AUDIT_MAINTENANCE_DATABASE_URL.
-- Never give it to the application.
--
-- `medora_audit_maintenance` is a fixed name: `audit_retention_entitled()`
-- (migration 20261125100000) recognises membership of exactly this group.
-- Neither role is a superuser, owns a table, bypasses RLS or holds DDL; the
-- login can read the retention setting and call the two partition
-- functions, nothing else. Idempotent: safe to re-run.

DO $create_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medora_audit_maintenance') THEN
    CREATE ROLE medora_audit_maintenance NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '__MAINTENANCE_LOGIN__') THEN
    CREATE ROLE __MAINTENANCE_LOGIN__ NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
  END IF;
END
$create_roles$;

GRANT medora_audit_maintenance TO __MAINTENANCE_LOGIN__;

GRANT USAGE ON SCHEMA public TO medora_audit_maintenance;
GRANT USAGE ON SCHEMA app_rls TO medora_audit_maintenance;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_rls TO medora_audit_maintenance;

-- The retention window (`retention.auditLogDays`) and nothing else to read.
GRANT SELECT ON public.platform_settings TO medora_audit_maintenance;

-- The two partition operations: keep future months ready, drop expired ones.
GRANT EXECUTE ON FUNCTION public.create_audit_events_partition(date) TO medora_audit_maintenance;
GRANT EXECUTE ON FUNCTION public.drop_audit_events_partition(text) TO medora_audit_maintenance;

-- Not granted, on purpose: any table other than platform_settings (the
-- maintenance role reads no audit event, patient or clinical row), INSERT /
-- UPDATE / DELETE anywhere, CREATE, TRUNCATE, ownership, role management.
