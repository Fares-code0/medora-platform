/**
 * The legacy ownership backfill dry run (multi-hospital §2.12, fix-list 17):
 * its decision rule never defaults a NULL, and it refuses production. Run
 * against PostgreSQL to prove the evidence SQL is valid for every table and
 * that the transaction is read-only.
 */

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  TABLES,
  assertNonProduction,
  decide,
  evidenceQuery,
} from '../prisma/backfill/ownership-dry-run';

describe('ownership backfill dry run — the decision rule', () => {
  it('proposes only when every applicable rule agrees on one hospital', () => {
    expect(
      decide('medical_records', { id: 'r1', employment_stamp: ['h1'], single_patient_record: ['h1'] }),
    ).toMatchObject({ status: 'proposed', hospitalId: 'h1', reason: 'employment_stamp+single_patient_record' });
  });

  it('leaves a row with no evidence unresolved (never defaulted)', () => {
    expect(decide('patient_allergies', { id: 'r2', record_stamp: [], single_patient_record: null })).toMatchObject({
      status: 'unresolved',
      hospitalId: null,
      reason: 'no_evidence',
    });
  });

  it('leaves conflicting or ambiguous evidence unresolved', () => {
    expect(decide('lab_orders', { id: 'r3', employment_stamp: ['h1'], record_stamp: ['h2'] })).toMatchObject({
      status: 'unresolved',
      reason: 'conflicting_evidence',
    });
    expect(decide('appointments', { id: 'r4', employment_at_time: ['h1', 'h2'] })).toMatchObject({
      status: 'unresolved',
      reason: 'ambiguous:employment_at_time',
    });
  });

  it('refuses production and requires the explicit non-production acknowledgement', () => {
    expect(() => assertNonProduction({ NODE_ENV: 'production', MEDORA_BACKFILL_DRY_RUN: 'non-production' })).toThrow(
      /production/,
    );
    expect(() => assertNonProduction({ NODE_ENV: 'test' })).toThrow(/MEDORA_BACKFILL_DRY_RUN/);
    expect(() => assertNonProduction({ NODE_ENV: 'test', MEDORA_BACKFILL_DRY_RUN: 'non-production' })).not.toThrow();
  });
});

describe('ownership backfill dry run — against PostgreSQL', () => {
  it('runs every table’s evidence query inside a read-only transaction that refuses writes', async () => {
    const client = new Client({ connectionString: process.env['DATABASE_URL'] });
    await client.connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      for (const rule of TABLES) {
        await expect(client.query(evidenceQuery(rule))).resolves.toBeDefined();
      }
      await expect(client.query('UPDATE medical_records SET hospital_id = NULL WHERE false')).rejects.toThrow(
        /read-only/,
      );
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
