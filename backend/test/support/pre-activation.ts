/**
 * Returns a throwaway database to its state before RLS enforcement
 * (migration 20261124130000_rls_enforcement): every policy in `public`
 * dropped and RLS disabled.
 *
 * Only for the Phase 22 *proposal* suites, which prove what the superseded
 * proposal did. They run inside a transaction that is always rolled back, on
 * an isolated database, so this never outlives a test. The enforced policies
 * themselves are proven by `rls-runtime-role.e2e-spec.ts`.
 */
export const RESET_TO_PRE_ACTIVATION = `
DO $reset$
DECLARE p record; t record;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relrowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END
$reset$;`;
