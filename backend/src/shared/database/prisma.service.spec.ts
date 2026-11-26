import { describe, expect, it } from 'vitest';

import { pgPoolConfig } from './prisma.service';

describe('pgPoolConfig (OPS-03)', () => {
  it('maps the validated environment onto node-postgres pool options', () => {
    expect(
      pgPoolConfig({
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        DATABASE_POOL_MAX: 7,
        DATABASE_CONNECTION_TIMEOUT_MS: 1_500,
        DATABASE_IDLE_TIMEOUT_MS: 20_000,
        DATABASE_STATEMENT_TIMEOUT_MS: 4_000,
        DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: 9_000,
      }),
    ).toEqual({
      connectionString: 'postgresql://u:p@localhost:5432/db',
      max: 7,
      connectionTimeoutMillis: 1_500,
      idleTimeoutMillis: 20_000,
      statement_timeout: 4_000,
      idle_in_transaction_session_timeout: 9_000,
    });
  });
});
