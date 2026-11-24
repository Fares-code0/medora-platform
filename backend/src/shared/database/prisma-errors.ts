import { Prisma } from '../../generated/prisma/client';

/**
 * Reading a constraint violation out of a Prisma error (RM M6.1).
 *
 * A unique index is the only thing that makes "this email is already
 * taken" true under concurrency — a pre-check cannot see an uncommitted
 * row — so every flow that guards uniqueness has to be able to catch the
 * violation and answer with its own contract error rather than a 500.
 * That makes this a database concern shared by many modules, which under
 * M2.2's zone 1 means it belongs in the kernel and not in whichever
 * module needed it first.
 *
 * ## Why the error is read twice
 *
 * Prisma 7 connects through a **driver adapter** (ADR-021), and the
 * adapter reports a unique violation differently from the query engine
 * it replaced:
 *
 * ```
 * engine:        meta.target = ['email']
 * adapter ≤7.9:  meta.driverAdapterError.cause.constraint.fields = ['email']
 * adapter 7.10+: meta.driverAdapterError.cause.constraint.index = 'users_email_key'
 *                meta.driverAdapterError.cause.table = 'users'
 * ```
 *
 * All three shapes are read. The adapter moved from naming the columns to
 * naming the index in 7.10, and that is the failure this header warns
 * about made real: `P2002` still arrived, no field matched, and a
 * concurrent duplicate signup answered 500 instead of 409
 * (`auth-register.e2e-spec.ts`, "lets exactly one of two simultaneous
 * signups win"). Checking only one shape is a silent failure — the
 * `catch` simply never matches, under exactly the concurrent conditions
 * it exists for.
 *
 * The index name is read as Prisma names a default unique index,
 * `<table>_<column>[_<column>…]_key`, so the columns are what is left
 * between the table prefix and the suffix. Columns are **database** names
 * (`license_number`), which is why a caller may pass either spelling.
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  if (field === undefined) return true;

  const fields = conflictingFields(error);
  if (fields.includes(field)) return true;

  // The 7.10 shape names only the index; see the header.
  const columns = indexColumns(error);
  return columns !== undefined && columnsInclude(columns, field);
}

/** The columns the violated index covers, in whichever shape is present. */
export function conflictingFields(error: Prisma.PrismaClientKnownRequestError): readonly string[] {
  const meta: unknown = error.meta;
  if (typeof meta !== 'object' || meta === null) return [];

  const target: unknown = (meta as Record<string, unknown>)['target'];
  if (Array.isArray(target))
    return target.filter((value): value is string => typeof value === 'string');
  if (typeof target === 'string') return [target];

  const fields = readAdapterFields(meta as Record<string, unknown>);
  return fields ?? [];
}

function readAdapterFields(meta: Record<string, unknown>): string[] | undefined {
  const adapterError = meta['driverAdapterError'];
  if (typeof adapterError !== 'object' || adapterError === null) return undefined;

  const cause = (adapterError as Record<string, unknown>)['cause'];
  if (typeof cause !== 'object' || cause === null) return undefined;

  const constraint = (cause as Record<string, unknown>)['constraint'];
  if (typeof constraint !== 'object' || constraint === null) return undefined;

  const fields = (constraint as Record<string, unknown>)['fields'];
  if (!Array.isArray(fields)) return undefined;

  return fields.filter((value): value is string => typeof value === 'string');
}

/**
 * The column segment of a default unique index name — `email` out of
 * `users_email_key`, `record_id_version` out of
 * `record_versions_record_id_version_key` — or `undefined` when the error
 * names no index or the name is not in Prisma's default form.
 */
function indexColumns(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const meta: unknown = error.meta;
  if (typeof meta !== 'object' || meta === null) return undefined;

  const adapterError = (meta as Record<string, unknown>)['driverAdapterError'];
  if (typeof adapterError !== 'object' || adapterError === null) return undefined;

  const cause = (adapterError as Record<string, unknown>)['cause'];
  if (typeof cause !== 'object' || cause === null) return undefined;

  const table = (cause as Record<string, unknown>)['table'];
  const constraint = (cause as Record<string, unknown>)['constraint'];
  if (typeof table !== 'string' || typeof constraint !== 'object' || constraint === null) {
    return undefined;
  }

  const index = (constraint as Record<string, unknown>)['index'];
  if (typeof index !== 'string') return undefined;

  const prefix = `${table}_`;
  const suffix = '_key';
  if (!index.startsWith(prefix) || !index.endsWith(suffix)) return undefined;

  return index.slice(prefix.length, index.length - suffix.length);
}

/**
 * Whether `field` — in its model spelling (`licenseNumber`) or its column
 * spelling (`license_number`) — is one of the columns joined in `columns`.
 *
 * Matched on whole `_`-separated runs, so `email` matches `email` and
 * `mail` does not. A composite segment cannot be split
 * unambiguously (`record_id_version` also contains `id`), which is why
 * only the callers that name a single-column index pass a field.
 */
function columnsInclude(columns: string, field: string): boolean {
  const snake = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

  return [field, snake].some(
    (name) =>
      columns === name ||
      columns.startsWith(`${name}_`) ||
      columns.endsWith(`_${name}`) ||
      columns.includes(`_${name}_`),
  );
}

/**
 * SQLSTATEs meaning "the row lock this transaction asked for was not
 * granted": `55P03` lock_not_available (`lock_timeout` expired) and
 * `40P01` deadlock_detected. Both roll the transaction back and leave
 * nothing written, so the request can safely be tried again.
 */
const LOCK_NOT_GRANTED = new Set(['55P03', '40P01']);

/**
 * Whether `error` is a lock wait that gave up (BE-1).
 *
 * Read from the driver adapter's shape — `P2010` with the SQLSTATE in
 * `meta.driverAdapterError.cause.code` (`originalCode` as well), verified
 * against Prisma 7.10 — and `P2034`, the code Prisma itself uses for a
 * deadlock or write conflict. As with `isUniqueViolation`, reading only
 * one shape would be a `catch` that silently never matches.
 */
export function isLockNotGranted(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;

  const meta: unknown = error.meta;
  if (typeof meta !== 'object' || meta === null) return false;

  const adapterError = (meta as Record<string, unknown>)['driverAdapterError'];
  if (typeof adapterError !== 'object' || adapterError === null) return false;

  const cause = (adapterError as Record<string, unknown>)['cause'];
  if (typeof cause !== 'object' || cause === null) return false;

  const { code, originalCode } = cause as Record<string, unknown>;
  return [code, originalCode].some(
    (value) => typeof value === 'string' && LOCK_NOT_GRANTED.has(value),
  );
}

/**
 * The database refused a commit that would leave no effective Platform
 * Admin (`assert_platform_admin_survives`, migration
 * 20261125092000_platform_admin_invariant; audit F-10).
 *
 * Matched on the trigger's message rather than SQLSTATE 23514 alone, which
 * every CHECK constraint shares. The error can surface as a Prisma known
 * request error or, when it is raised at COMMIT, as the driver's own error,
 * so the whole cause chain is searched.
 */
export function isLastPlatformAdminViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > 6 || value === null || value === undefined || seen.has(value)) return false;
    if (typeof value === 'string') return value.includes('last_platform_admin');
    if (typeof value !== 'object') return false;
    seen.add(value);
    const record = value as Record<string, unknown>;
    return ['message', 'originalMessage', 'cause', 'meta', 'driverAdapterError'].some((key) =>
      visit(record[key], depth + 1),
    );
  };
  return visit(error, 0);
}
