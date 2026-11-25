/**
 * Boot-time runtime-role check (multi-hospital §2.15, fix-list item 19).
 *
 * Row-Level Security binds only a role that is neither a superuser, nor
 * `BYPASSRLS`, nor the owner of the tables (no `FORCE ROW LEVEL SECURITY`
 * by design: migrations run as the owner). An application connected as the
 * owner would silently bypass every tenant policy. So in production the
 * service refuses to start on such a role; elsewhere it logs a warning,
 * because development and the e2e suites deliberately run as the owner.
 */

export interface RoleFacts {
  readonly role: string;
  readonly superuser: boolean;
  readonly bypassRls: boolean;
  readonly ownedTables: number;
}

/** The reasons `facts` would bypass RLS; empty when the role is enforced. */
export function bypassReasons(facts: RoleFacts): string[] {
  const reasons: string[] = [];
  if (facts.superuser) reasons.push('is a superuser');
  if (facts.bypassRls) reasons.push('has BYPASSRLS');
  if (facts.ownedTables > 0) reasons.push(`owns ${String(facts.ownedTables)} table(s)`);
  return reasons;
}

export const ROLE_FACTS_SQL = `
  SELECT current_user::text AS role,
         r.rolsuper AS superuser,
         r.rolbypassrls AS "bypassRls",
         (SELECT count(*)::int FROM pg_tables t
           WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS "ownedTables"
    FROM pg_roles r
   WHERE r.rolname = current_user`;
