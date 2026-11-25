-- `prevent_tenant_scope_reassignment` became SECURITY DEFINER in migration
-- 20261125102000 (M2) so its evidence lookup is not hidden by the evidence
-- table's own RLS. A new function is executable by PUBLIC by default, so any
-- role able to create a table (a temporary one included) could attach it as
-- a trigger and use its error as an oracle on `ownership_assignments`, which
-- that role cannot read. Only trigger attachment needs EXECUTE: PostgreSQL
-- checks it at CREATE TRIGGER, which migrations run as the owner, so the
-- existing triggers keep firing for every writer.

REVOKE ALL ON FUNCTION public.prevent_tenant_scope_reassignment() FROM PUBLIC;
