-- Audit ledger partitions: no direct access for any non-owner role
-- (multi-hospital §2.13, §2.15; audit finding F-05).
--
-- Row-Level Security and the append-only revocations applied to the
-- `audit_events` parent only. PostgreSQL checks privileges and policies on
-- the relation a query names, so a role holding privileges on a partition
-- (`audit_events_2026_11`, `audit_events_default`, …) could read every
-- hospital's events, and UPDATE or DELETE them, by naming the partition.
-- The runtime role had exactly those privileges, through the provisioning
-- template's `GRANT … ON ALL TABLES` and its default privileges for new
-- tables.
--
-- Access through the parent is unaffected: a query on `audit_events` is
-- checked against the parent's privileges and policies, and PostgreSQL does
-- not check the partitions' own privileges or policies for it. So after this
-- migration the runtime role still appends to and reads the ledger through
-- `audit_events` (scoped by its policies), and can no longer address a
-- partition at all.
--
-- Every partition is therefore:
--   1. stripped of every privilege held by any role other than its owner;
--   2. given Row-Level Security with no policy, so that even a privilege
--      granted to it later by mistake returns no row to a non-owner.
-- The routine below does both. It runs for every existing partition now,
-- for every partition `create_audit_events_partition` creates from now on,
-- and from the runtime-role provisioning template.
--
-- Partition maintenance no longer needs table ownership in the application:
-- creation and the retention drop are SECURITY DEFINER functions with a
-- pinned search_path that validate their input. The application calls them;
-- it holds no DDL right itself.

CREATE OR REPLACE FUNCTION public.audit_events_secure_partition(partition regclass)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  owner_oid oid;
  grantee record;
BEGIN
  -- Only a partition of audit_events, never another table.
  IF NOT EXISTS (
    SELECT 1 FROM pg_inherits
     WHERE inhrelid = partition AND inhparent = 'public.audit_events'::regclass
  ) THEN
    RAISE EXCEPTION '% is not a partition of audit_events', partition
      USING ERRCODE = '42809';
  END IF;

  SELECT relowner INTO owner_oid FROM pg_class WHERE oid = partition;

  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC', partition);
  FOR grantee IN
    SELECT DISTINCT a.grantee
      FROM pg_class c, LATERAL aclexplode(c.relacl) a
     WHERE c.oid = partition AND a.grantee <> owner_oid AND a.grantee <> 0
  LOOP
    EXECUTE format('REVOKE ALL ON %s FROM %I', partition, pg_get_userbyid(grantee.grantee));
  END LOOP;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', partition);
END
$fn$;

CREATE OR REPLACE FUNCTION public.audit_events_secure_all_partitions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  partition record;
  secured integer := 0;
BEGIN
  FOR partition IN
    SELECT inhrelid::regclass AS rel FROM pg_inherits WHERE inhparent = 'public.audit_events'::regclass
  LOOP
    PERFORM public.audit_events_secure_partition(partition.rel);
    secured := secured + 1;
  END LOOP;
  RETURN secured;
END
$fn$;

-- Creation, now owner-run and self-securing. Same name and signature as the
-- M5.10 function, so the retention job's call is unchanged.
CREATE OR REPLACE FUNCTION public.create_audit_events_partition(month_start date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  partition_name text;
BEGIN
  IF month_start IS NULL OR month_start <> date_trunc('month', month_start)::date THEN
    RAISE EXCEPTION 'create_audit_events_partition: % is not the first day of a month', month_start
      USING ERRCODE = '22023';
  END IF;

  partition_name := 'audit_events_' || to_char(month_start, 'YYYY_MM');
  IF to_regclass(format('public.%I', partition_name)) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.audit_events FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      month_start,
      month_start + interval '1 month'
    );
  END IF;

  -- Secured whether it was just created or already existed: a partition made
  -- by hand, or before this migration, is brought into line on the next call.
  PERFORM public.audit_events_secure_partition(format('public.%I', partition_name)::regclass);
END
$fn$;

-- The retention drop. Only a monthly partition of audit_events whose whole
-- month has ended; never the DEFAULT partition, never another table. The
-- retention window itself is the service's (AuditRetentionService); this is
-- the floor the database will not go below whatever it is asked.
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

-- Nobody but the owner (and roles granted explicitly, below or by the
-- provisioning template) may run the maintenance functions.
REVOKE ALL ON FUNCTION public.audit_events_secure_partition(regclass) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_events_secure_all_partitions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_audit_events_partition(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.drop_audit_events_partition(text) FROM PUBLIC;

-- Every existing partition, the DEFAULT one included.
SELECT public.audit_events_secure_all_partitions();
