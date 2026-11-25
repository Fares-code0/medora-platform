-- Audit retention runs under a maintenance role, never the application
-- runtime role (security remediation H1).
--
-- Migration 20261125090000 moved the retention `DROP TABLE` into the owner-
-- defined SECURITY DEFINER function `drop_audit_events_partition(text)`,
-- and the runtime-role template's blanket `GRANT EXECUTE ON ALL FUNCTIONS`
-- then handed it to the application role. The function only refused a
-- month that had not ended, so the application role — and anything that
-- compromised it — could drop any past month of the append-only ledger.
--
-- The fix is privilege separation, not a retention floor in SQL (the window
-- is `retention.auditLogDays`, an administrator's setting):
--
-- 1. `audit_retention_entitled()` says whether the *session* user — the
--    login that connected, which SET ROLE inside a SECURITY DEFINER body
--    cannot change — owns the ledger or belongs to the dedicated group role
--    `medora_audit_maintenance` (prisma/roles/provision-audit-maintenance-
--    role.sql). It is the single predicate both the database and the
--    application's sweep consult.
-- 2. `drop_audit_events_partition` refuses every caller that is not
--    entitled, whatever EXECUTE grants exist. A later broad grant can no
--    longer reopen this.
-- 3. EXECUTE on the maintenance functions is stripped from every grantee
--    except the owner and the maintenance group, so a database provisioned
--    with the old template is corrected by `db:deploy` alone. The runtime
--    role keeps `create_audit_events_partition` (it keeps future months
--    ready; creating an empty, secured partition destroys nothing) — the
--    template re-grants it explicitly.

CREATE OR REPLACE FUNCTION public.audit_retention_entitled() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
  SELECT pg_has_role(
           session_user,
           (SELECT c.relowner FROM pg_class c WHERE c.oid = 'public.audit_events'::regclass),
           'MEMBER')
      OR (to_regrole('medora_audit_maintenance') IS NOT NULL
          AND pg_has_role(session_user, 'medora_audit_maintenance', 'MEMBER'))
$fn$;

CREATE OR REPLACE FUNCTION public.drop_audit_events_partition(partition_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  rel regclass;
  upper_bound timestamptz;
BEGIN
  -- H1: only the ledger owner or the audit maintenance role, never the
  -- application runtime role, however EXECUTE was granted.
  IF NOT public.audit_retention_entitled() THEN
    RAISE EXCEPTION 'drop_audit_events_partition: % may not run audit retention', session_user
      USING ERRCODE = '42501';
  END IF;

  IF partition_name IS NULL OR partition_name !~ '^audit_events_[0-9]{4}_[0-9]{2}$' THEN
    RAISE EXCEPTION 'drop_audit_events_partition: "%" is not an audit_events month partition', partition_name
      USING ERRCODE = '22023';
  END IF;

  rel := to_regclass(format('public.%I', partition_name));
  IF rel IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_inherits WHERE inhrelid = rel AND inhparent = 'public.audit_events'::regclass
  ) THEN
    RAISE EXCEPTION 'drop_audit_events_partition: % is not a partition of audit_events', partition_name
      USING ERRCODE = '42809';
  END IF;

  SELECT substring(pg_get_expr(c.relpartbound, c.oid) FROM 'TO \(''([^'']+)''')::timestamptz
    INTO upper_bound
    FROM pg_class c WHERE c.oid = rel;
  IF upper_bound IS NULL OR upper_bound > now() THEN
    RAISE EXCEPTION 'drop_audit_events_partition: % still covers the current or a future month', partition_name
      USING ERRCODE = '22023';
  END IF;

  EXECUTE format('DROP TABLE public.%I', partition_name);
END
$fn$;

REVOKE ALL ON FUNCTION public.drop_audit_events_partition(text) FROM PUBLIC;

-- Strip EXECUTE on the owner-only functions from every grantee but the
-- owner and the maintenance group (correcting databases provisioned with
-- the old template's blanket grant).
DO $strip$
DECLARE
  fn regprocedure;
  grantee record;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.drop_audit_events_partition(text)'::regprocedure,
    'public.audit_events_secure_partition(regclass)'::regprocedure,
    'public.audit_events_secure_all_partitions()'::regprocedure,
    'public.platform_admin_count()'::regprocedure,
    'public.assert_platform_admin_survives()'::regprocedure
  ] LOOP
    FOR grantee IN
      SELECT DISTINCT a.grantee
        FROM pg_proc p, LATERAL aclexplode(p.proacl) a
       WHERE p.oid = fn
         AND a.grantee <> 0
         AND a.grantee <> p.proowner
         AND a.grantee IS DISTINCT FROM to_regrole('medora_audit_maintenance')
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', fn, pg_get_userbyid(grantee.grantee));
    END LOOP;
  END LOOP;
END
$strip$;
