import type { ClientBase } from 'pg';

/**
 * Explicit Platform Admin designation for ONE named account (S5; OD-07,
 * M-13).
 *
 * Existing `admin` accounts are never assumed to be Platform Admins. This is
 * the reconciliation step the M-13 mapping list feeds: one reviewed entry,
 * one run, one account. It never selects accounts by role, never loops over
 * a set, and never infers anything from the absence of a hospital
 * assignment.
 *
 * Dry run by default (a read-only transaction that reports what it would
 * do). `apply` writes the grant only when every check passes, in a
 * serializable transaction, and is refused for APP_ENV=production: mapping
 * real administrators waits on the reviewed M-13 list and a separate
 * approval (docs/multi-hospital/MIGRATION_AND_COMPATIBILITY.md).
 *
 * The database enforces the same rules again (migration
 * 20261124100000_platform_admin_assignments): the admin role, one live grant
 * per account, and no live hospital admin assignment at the same time.
 */

export interface DesignationRequest {
  /** The account's sign-in email (citext, so case-insensitive). */
  readonly email: string;
  /** Why: the mapping-list entry or ticket. Stored on the grant. */
  readonly reason: string;
  /** Optional: the email of the administrator who approved the mapping. */
  readonly grantedByEmail?: string | undefined;
}

export interface DesignationOptions {
  readonly apply: boolean;
  readonly appEnv: string | undefined;
}

export type DesignationVerdict =
  | 'would_grant'
  | 'granted'
  | 'already_platform_admin'
  | 'account_not_found'
  | 'account_not_active'
  | 'not_admin_role'
  | 'holds_hospital_admin_assignment'
  | 'granter_not_found';

export interface DesignationReport {
  readonly mode: 'dry-run' | 'apply';
  readonly database: string;
  readonly email: string;
  readonly verdict: DesignationVerdict;
  readonly account: {
    readonly publicId: string;
    readonly role: string;
    readonly status: string;
  } | null;
  readonly liveHospitalAdminAssignments: number;
  readonly grantId: string | null;
}

const MAX_REASON = 300;

export function assertApplyPermitted(appEnv: string | undefined): void {
  if (appEnv === 'production') {
    throw new Error(
      'Refusing to apply a Platform Admin designation to a production database (APP_ENV=production); mapping existing administrators waits on the reviewed M-13 list and a separate approval.',
    );
  }
}

export function validateRequest(request: DesignationRequest): void {
  if (request.email.trim().length === 0 || !request.email.includes('@')) {
    throw new Error('--email must name one account by its sign-in email');
  }
  const reason = request.reason.trim();
  if (reason.length === 0) throw new Error('--reason is required (the mapping-list entry)');
  if (reason.length > MAX_REASON) throw new Error(`--reason is longer than ${MAX_REASON}`);
}

interface AccountRow {
  id: string;
  public_id: string;
  role: string;
  status: string;
  deleted: boolean;
  live_platform: string | null;
  live_hospital_admin: number;
}

/**
 * Runs the check, and with `apply` the grant, in one transaction on a
 * connected client that has no transaction open.
 */
export async function runPlatformAdminDesignation(
  client: ClientBase,
  request: DesignationRequest,
  options: DesignationOptions,
): Promise<DesignationReport> {
  validateRequest(request);
  if (options.apply) assertApplyPermitted(options.appEnv);

  await client.query(
    options.apply
      ? 'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE'
      : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  try {
    const identity = await client.query<{ database: string }>(
      'SELECT current_database() AS database',
    );
    const database = identity.rows[0]?.database ?? '';
    const base = {
      mode: options.apply ? ('apply' as const) : ('dry-run' as const),
      database,
      email: request.email,
    };

    const found = await client.query<AccountRow>(
      `SELECT u.id, u.public_id, r.code AS role, u.status::text AS status,
              u.deleted_at IS NOT NULL AS deleted,
              (SELECT p.id FROM public.platform_admin_assignments p
                WHERE p.user_id = u.id AND p.revoked_at IS NULL) AS live_platform,
              (SELECT count(*)::int FROM public.hospital_role_assignments h
                 JOIN public.roles hr ON hr.id = h.role_id
                WHERE h.user_id = u.id AND h.revoked_at IS NULL AND hr.code = 'admin')
                AS live_hospital_admin
         FROM public.users u JOIN public.roles r ON r.id = u.role_id
        WHERE u.email = $1`,
      [request.email.trim()],
    );
    const row = found.rows[0];

    const finish = async (
      verdict: DesignationVerdict,
      grantId: string | null = null,
      commit = false,
    ): Promise<DesignationReport> => {
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      return {
        ...base,
        verdict,
        account:
          row === undefined
            ? null
            : { publicId: row.public_id, role: row.role, status: row.status },
        liveHospitalAdminAssignments: row?.live_hospital_admin ?? 0,
        grantId,
      };
    };

    if (row === undefined || row.deleted) return finish('account_not_found');
    if (row.live_platform !== null) return finish('already_platform_admin', row.live_platform);
    if (row.role !== 'admin') return finish('not_admin_role');
    if (row.status !== 'active') return finish('account_not_active');
    if (row.live_hospital_admin > 0) return finish('holds_hospital_admin_assignment');

    let grantedBy: string | null = null;
    if (request.grantedByEmail !== undefined) {
      const granter = await client.query<{ id: string }>(
        'SELECT id FROM public.users WHERE email = $1 AND deleted_at IS NULL',
        [request.grantedByEmail.trim()],
      );
      grantedBy = granter.rows[0]?.id ?? null;
      if (grantedBy === null) return finish('granter_not_found');
    }

    if (!options.apply) return finish('would_grant');

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO public.platform_admin_assignments (user_id, grant_reason, granted_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [row.id, request.reason.trim(), grantedBy],
    );
    return finish('granted', inserted.rows[0]?.id ?? null, true);
  } catch (error) {
    // Keep the original error; a failed ROLLBACK would only hide it.
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
