import type { Prisma } from '../../generated/prisma/client';

/**
 * Tenant context for PostgreSQL (enforcement stage S7, GitHub #20).
 *
 * The contract (`docs/multi-hospital/RLS_BACKEND_CONTRACT.md`, Database-owned):
 *
 *  - one setting, {@link TENANT_HOSPITAL_SETTING}, holding the server-derived
 *    hospital id as UUID text, or `''` when the context is unresolved;
 *  - set **transaction-locally** (`set_config(…, true)`) as the first statement
 *    of an interactive transaction, so it ends at COMMIT or ROLLBACK and never
 *    survives on a pooled connection into another request;
 *  - every query it should scope runs inside that same transaction.
 *
 * Nothing in the application reads the setting yet: no table has RLS (#19).
 * This helper is the single place the setting is written, so that when the
 * policies are activated the Backend has exactly one wrapper to route
 * hospital-owned work through. The hospital id must come from the server-side
 * hospital context (`HospitalContextService`), never from client input.
 */
export const TENANT_HOSPITAL_SETTING = 'app.hospital_id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The subset of `PrismaService` this needs (keeps it unit-testable). */
export interface InteractiveTransactionRunner {
  $transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
}

export interface HospitalTenantTransactionOptions {
  readonly maxWait?: number;
  readonly timeout?: number;
}

/**
 * Runs `work` in one interactive transaction whose first statement sets the
 * tenant hospital. `null` means "no resolved context" and is written as `''`,
 * which the proposed policies read as NULL and therefore match no row: no
 * context never means "all hospitals".
 *
 * A value that is not a UUID is refused before any query runs. It can only
 * come from a programming error, and passing it through would make the
 * database, not the application, the first place to notice.
 */
export async function withHospitalTenantContext<T>(
  prisma: InteractiveTransactionRunner,
  hospitalId: string | null,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options: HospitalTenantTransactionOptions = {},
): Promise<T> {
  if (hospitalId !== null && !UUID.test(hospitalId)) {
    throw new Error('Tenant hospital id must be a UUID or null');
  }
  const value = hospitalId ?? '';
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.hospital_id', ${value}, true)`;
    return work(tx);
  }, options);
}
