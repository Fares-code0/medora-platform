import type { PrismaClient } from '../../generated/prisma/client';

/**
 * Soft delete, applied to every model that has a `deletedAt` (RM M4.2).
 *
 * Clinical data is not hard-deleted. ADR-007 fixes retention periods
 * measured in years, and a `DELETE` would destroy the row the audit
 * trail refers to — the retention policy would then be enforcing
 * nothing. So "delete" sets `deletedAt`, and reads filter it out.
 *
 * ## Why an extension and not middleware
 *
 * `$use` middleware was removed in Prisma 5. Client extensions replace
 * it and are better suited anyway: middleware ran untyped against every
 * operation, while an extension narrows to the operations it changes.
 *
 * ## The two clients
 *
 * `PrismaService.db` is wrapped in this extension and is what
 * repositories use. `PrismaService` itself is the plain client and sees
 * everything — that is the escape hatch for the few callers that must,
 * such as the retention sweeps of M30 and the audit exports of M28.
 *
 * Two clients rather than a per-query flag because `exactOptionalPropertyTypes`
 * is on: an "include deleted" flag would have to be an explicit
 * `deletedAt: undefined` in the `where`, and Prisma's generated input
 * types reject an explicit `undefined` under that compiler setting.
 * A second client is unambiguous and typechecks.
 *
 * ```ts
 * prisma.db.patient.findMany()                        // live rows only
 * prisma.db.patient.findMany({ where: ONLY_DELETED }) // only deleted
 * prisma.patient.findMany()                           // everything
 * ```
 *
 * ## Nested relation reads are NOT filtered — state it yourself
 *
 * The extension rewrites the **top-level** `where` of an operation. A
 * relation pulled through `select` or `include` has its own `where`, and
 * this never touches it:
 *
 * ```ts
 * prisma.db.patient.findFirst({
 *   where: { publicId },                 // filtered by this extension
 *   select: { allergies: { select: … } } // NOT filtered — add your own
 * })
 * ```
 *
 * So a nested selection over a soft-deletable model must carry
 * `where: { deletedAt: null }` explicitly. This is not a theoretical
 * gap: M10's patient projection embeds the allergy list, and without the
 * clause a withdrawn allergy kept appearing on the chart **and in the
 * derived `hasSevereAllergy` flag** — a safety-strip value computed from
 * a row a clinician had deliberately removed.
 *
 * Filtering nested reads automatically would mean rewriting arbitrarily
 * deep `select` trees on every query, guessing which levels are
 * soft-deletable, and silently changing the meaning of a `where` a
 * caller wrote by hand. An explicit clause at the handful of call sites
 * that embed a soft-deletable relation is the smaller cost and the
 * legible one.
 */

/** Spread into a `where` to query the soft-deleted rows specifically. */
export const ONLY_DELETED = { deletedAt: { not: null } } as const;

/**
 * Operations that read, and therefore must be filtered.
 *
 * `findUnique` is deliberately absent and cannot be included: its
 * `where` accepts only unique fields, so adding `deletedAt` is rejected
 * by both the types and the runtime. A caller looking a row up by id
 * gets it back whether or not it is deleted — usually what is wanted
 * when resolving an audit record, and the reason `findUniqueOrThrow` is
 * left alone too. Use `findFirst` when the distinction matters.
 */
const FILTERED_READS = ['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate'] as const;

/** The subset of a Prisma operation's arguments this cares about. */
interface ArgsWithWhere {
  where?: Record<string, unknown>;
}

/**
 * Adds `deletedAt: null` unless the caller already spoke about it.
 *
 * The check is key **presence**, not value: a caller who wrote
 * `deletedAt` into the `where` — to ask for only-deleted rows, say — is
 * handling it themselves, and layering `deletedAt: null` on top would
 * turn that into a query for rows that are both deleted and not.
 *
 * Exported for its own unit test. This predicate is the whole feature,
 * and it is worth testing without a database in the loop.
 */
export function applySoftDeleteFilter<T extends ArgsWithWhere>(args: T): T {
  const where = args.where ?? {};
  if ('deletedAt' in where) return args;

  // A new object every time: Prisma reuses argument objects across
  // retries, so mutating one would make a retry differ from the attempt.
  return { ...args, where: { ...where, deletedAt: null } };
}

/**
 * The models that actually have a `deletedAt`, read off the client.
 *
 * ## Why this is derived and not a list
 *
 * A hand-maintained list would silently stop protecting the next model
 * someone adds, which is the failure mode that matters: a model quietly
 * missing from soft-delete leaks deleted clinical rows into ordinary
 * reads. Deriving it keeps the guarantee automatic.
 *
 * ## Why it is not simply "every model"
 *
 * That was the original shape, and it was wrong in a way nothing caught
 * until M6 became the first milestone to query a model without the
 * column. Only 43 of the 107 models carry `deletedAt` — sessions, login
 * events, verification tokens and the join tables deliberately do not,
 * because a revoked session is revoked and a login attempt is history
 * (see `03-identity.prisma`). Adding `deletedAt: null` to a `where` for
 * one of those is not a stricter query, it is an invalid one: Prisma
 * rejects the unknown argument and the endpoint 500s.
 *
 * `_runtimeDataModel` is Prisma's own field metadata. It is internal, so
 * an upgrade could rename it — hence the fallback below and the test
 * that pins the result.
 */
function softDeletableModels(client: PrismaClient): ReadonlySet<string> | undefined {
  const runtime = (client as unknown as Record<string, unknown>)['_runtimeDataModel'];
  if (typeof runtime !== 'object' || runtime === null) return undefined;

  const models = (runtime as Record<string, unknown>)['models'];
  if (typeof models !== 'object' || models === null) return undefined;

  const names = new Set<string>();
  for (const [name, model] of Object.entries(models as Record<string, unknown>)) {
    if (typeof model !== 'object' || model === null) continue;
    const fields = (model as Record<string, unknown>)['fields'];
    if (!Array.isArray(fields)) continue;

    const hasColumn = fields.some(
      (field) =>
        typeof field === 'object' &&
        field !== null &&
        (field as Record<string, unknown>)['name'] === 'deletedAt',
    );
    if (hasColumn) names.add(name);
  }

  return names.size > 0 ? names : undefined;
}

/**
 * Wraps a client so every filtered read excludes soft-deleted rows.
 *
 * Applied to `$allModels`, and narrowed per call to the models that have
 * the column — see `softDeletableModels` for why it is neither a list
 * nor unconditional.
 *
 * If the metadata cannot be read at all the filter applies everywhere,
 * which is the older behaviour: of the two failure modes, "reads on
 * models without the column break loudly" is far better than "deleted
 * clinical rows silently reappear".
 */
export function withSoftDelete<TClient extends PrismaClient>(client: TClient) {
  const soft = softDeletableModels(client);

  const filter = ({
    model,
    args,
    query,
  }: {
    model: string;
    args: ArgsWithWhere;
    query: (args: ArgsWithWhere) => Promise<unknown>;
  }): Promise<unknown> => {
    if (soft !== undefined && !soft.has(model)) return query(args);
    return query(applySoftDeleteFilter(args));
  };

  return client.$extends({
    name: 'softDelete',
    query: {
      $allModels: {
        findMany: filter,
        findFirst: filter,
        findFirstOrThrow: filter,
        count: filter,
        aggregate: filter,
      },
    },
  });
}

/**
 * The set the extension computed, for the test that pins it.
 *
 * Exported rather than recomputed in the spec: a test that re-derived
 * the set would agree with a broken derivation just as happily.
 */
export function softDeletableModelsOf(client: PrismaClient): ReadonlySet<string> | undefined {
  return softDeletableModels(client);
}

export type SoftDeletedClient = ReturnType<typeof withSoftDelete<PrismaClient>>;

/** Exported so a test can assert the list has not silently shrunk. */
export const FILTERED_READ_OPERATIONS: readonly string[] = FILTERED_READS;
