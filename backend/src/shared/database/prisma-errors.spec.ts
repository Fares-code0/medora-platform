import { describe, expect, it } from 'vitest';

import { Prisma } from '../../generated/prisma/client';

import { isLockNotGranted, isUniqueViolation } from './prisma-errors';

/**
 * The three shapes a unique violation has arrived in (RM M6.1).
 *
 * The 7.10 shape is the one this spec exists for: the adapter stopped
 * naming the columns and started naming the index, and a field-specific
 * catch that read only the older shapes stopped matching — a 409 became a
 * 500 under concurrency. The meta below is what Prisma 7.10.1 produced
 * against PostgreSQL 16 for a duplicate `departments.name`.
 */
function violation(meta: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta,
  });
}

const adapter710 = (table: string, index: string) =>
  violation({
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        kind: 'UniqueConstraintViolation',
        constraint: { index },
        table,
      },
    },
  });

describe('isUniqueViolation', () => {
  it('reads the query engine’s meta.target', () => {
    expect(isUniqueViolation(violation({ target: ['email'] }), 'email')).toBe(true);
  });

  it('reads the ≤7.9 adapter’s constraint.fields', () => {
    const error = violation({
      driverAdapterError: { cause: { constraint: { fields: ['email'] } } },
    });

    expect(isUniqueViolation(error, 'email')).toBe(true);
  });

  it('reads the 7.10 adapter’s index name, in either spelling of the field', () => {
    expect(isUniqueViolation(adapter710('users', 'users_email_key'), 'email')).toBe(true);

    const license = adapter710('doctors', 'doctors_license_number_key');
    expect(isUniqueViolation(license, 'license_number')).toBe(true);
    expect(isUniqueViolation(license, 'licenseNumber')).toBe(true);
  });

  it('does not match a different column on the same table', () => {
    expect(isUniqueViolation(adapter710('users', 'users_username_key'), 'email')).toBe(false);
    expect(isUniqueViolation(adapter710('doctors', 'doctors_employee_id_key'), 'license_number')).toBe(
      false,
    );
  });

  it('does not match a field that is only a substring of the column', () => {
    expect(isUniqueViolation(adapter710('users', 'users_email_key'), 'mail')).toBe(false);
  });

  it('matches any unique violation when no field is asked for', () => {
    expect(isUniqueViolation(adapter710('departments', 'departments_name_key'))).toBe(true);
  });

  it('is false for anything that is not P2002', () => {
    const notUnique = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: 'test',
    });

    expect(isUniqueViolation(notUnique)).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
  });
});

/**
 * The shapes a lock wait that gave up arrives in (BE-1). Prisma 7.10 with
 * `@prisma/adapter-pg` maps SQLSTATE `40P01` and `40001` to the adapter
 * kind `TransactionWriteConflict`: a model query surfaces that as `P2034`,
 * a raw query as `P2010`, and both keep the SQLSTATE in `originalCode`.
 * `55P03` has no kind of its own and arrives as a generic `postgres` cause.
 * The e2e spec raises real `55P03` and `40P01` errors; these pin the
 * branches one at a time.
 */
function knownError(code: string, cause?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('Query failed', {
    code,
    clientVersion: 'test',
    ...(cause === undefined
      ? {}
      : { meta: { driverAdapterError: { name: 'DriverAdapterError', cause } } }),
  });
}

describe('isLockNotGranted', () => {
  it('matches lock_timeout (55P03) on a raw query', () => {
    const error = knownError('P2010', { kind: 'postgres', code: '55P03', originalCode: '55P03' });

    expect(isLockNotGranted(error)).toBe(true);
  });

  it('matches a deadlock (40P01) on a raw query', () => {
    const error = knownError('P2010', { kind: 'TransactionWriteConflict', originalCode: '40P01' });

    expect(isLockNotGranted(error)).toBe(true);
  });

  it('matches P2034 on its code alone, whatever SQLSTATE it carries', () => {
    expect(isLockNotGranted(knownError('P2034'))).toBe(true);
    expect(
      isLockNotGranted(
        knownError('P2034', { kind: 'TransactionWriteConflict', originalCode: '40001' }),
      ),
    ).toBe(true);
  });

  it('does not match other database errors', () => {
    expect(
      isLockNotGranted(
        knownError('P2010', { kind: 'postgres', code: '57014', originalCode: '57014' }),
      ),
    ).toBe(false);
    expect(
      isLockNotGranted(
        knownError('P2002', { kind: 'UniqueConstraintViolation', originalCode: '23505' }),
      ),
    ).toBe(false);
  });

  it('does not match a Prisma transaction API error (P2028)', () => {
    expect(isLockNotGranted(knownError('P2028'))).toBe(false);
  });

  it('is false for anything that is not a Prisma known request error', () => {
    expect(isLockNotGranted(new Error('55P03'))).toBe(false);
    expect(isLockNotGranted(undefined)).toBe(false);
  });
});
