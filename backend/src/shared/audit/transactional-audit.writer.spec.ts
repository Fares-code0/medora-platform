import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';

import { auditRowOf } from './audit-row';
import type { AuditEvent } from './audit.types';
import { TransactionalAuditWriter } from './transactional-audit.writer';

/**
 * The disclosure writer's contract (RM M7.3, ADR-006 §5).
 *
 * The behaviour against Postgres — a refused insert rolls the read back
 * and the client gets a 503 with nothing disclosed — is driven end to end
 * in `patients-reveal.e2e-spec.ts` and `messaging-oversight.e2e-spec.ts`.
 * This file holds the two properties that are about the class itself: it
 * writes on the transaction it is handed, and it fails closed without
 * repeating the provider's words.
 */
const WRITER = resolve(__dirname, 'transactional-audit.writer.ts');

const EVENT: AuditEvent = {
  action: 'patient_identity.reveal',
  actor: { userId: '0b0c3a3e-3d1e-4c43-9d55-0f2f0e1d2c3b', role: 'admin' },
  entityType: 'patient',
  entityId: 'PT-1001',
  occurredAt: new Date('2026-10-23T12:00:00Z'),
  metadata: { category: 'clinical-review' },
};

/** A transaction client whose `auditEvent.createMany` is the given function. */
function txWith(createMany: (args: unknown) => Promise<unknown>): Prisma.TransactionClient {
  return { auditEvent: { createMany } } as unknown as Prisma.TransactionClient;
}

describe('TransactionalAuditWriter', () => {
  it('inserts on the transaction it is handed, the row the dispatcher would file', async () => {
    const calls: unknown[] = [];
    const tx = txWith((args) => {
      calls.push(args);
      return Promise.resolve({});
    });

    await new TransactionalAuditWriter().recordWithin(tx, EVENT);

    // Through `auditRowOf`, so the same event files identically through
    // either writer and an investigator's filter reads one ledger.
    // Inserted without RETURNING (`createMany`), so Row-Level Security's
    // SELECT policy is never asked about the new row (F-04).
    expect(calls).toEqual([{ data: [auditRowOf(EVENT)] }]);
  });

  it('fails closed with a 503 that does not repeat the provider', async () => {
    const tx = txWith(() =>
      Promise.reject(new Error('invalid input syntax for type uuid at db.internal:5432')),
    );

    const failure = await new TransactionalAuditWriter()
      .recordWithin(tx, EVENT)
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppException);
    const exception = failure as AppException;
    expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(exception.code).toBe('audit_unavailable');
    expect(`${exception.message} ${exception.detail ?? ''}`).not.toMatch(/uuid|db\.internal|5432/);
  });

  it('exposes exactly one method, and it only creates', () => {
    const methods = Object.getOwnPropertyNames(TransactionalAuditWriter.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(methods).toEqual(['recordWithin']);

    const source = readFileSync(WRITER, 'utf8');
    for (const verb of ['update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
      expect(source, verb).not.toContain(`auditEvent.${verb}`);
    }
    expect(source).toContain('auditEvent.create');
  });
});
