import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PrismaAuditWriter } from './prisma-audit.writer';
import type { AuditDispatcher } from './audit.types';

/**
 * The ledger is INSERT-only (RM M28.1, ADR-007 R2).
 *
 * > ✅ Verify: no update/delete method exists.
 *
 * ## Why a source assertion rather than a type one
 *
 * "No update method exists" is not expressible as a type: a class can
 * satisfy `AuditDispatcher` and still call `auditEvent.update` inside
 * `record()`. What has to be true is that **no mutation of an existing
 * row is reachable from this file**, and the only way to assert that
 * without executing every branch is to read it.
 *
 * The check is deliberately blunt — any occurrence of a Prisma mutation
 * verb against `auditEvent` fails. A blunt check on an append-only
 * ledger is the right trade: the cost of a false positive is renaming a
 * local variable, and the cost of a false negative is a correctable
 * audit trail, which is not an audit trail.
 */
const WRITER = resolve(__dirname, 'prisma-audit.writer.ts');

describe('the writer can only insert', () => {
  it('exposes exactly one method', () => {
    const methods = Object.getOwnPropertyNames(PrismaAuditWriter.prototype).filter(
      (name) => name !== 'constructor',
    );

    // `AuditDispatcher` declares `record` and nothing else; a second
    // public method here would be a second way to reach the table.
    expect(methods).toEqual(['record']);
  });

  it('satisfies the dispatcher port and adds nothing to it', () => {
    // Structural: assigning to the port proves `record` matches, and the
    // assertion above proves there is nothing beside it.
    const port: AuditDispatcher = new PrismaAuditWriter({} as never);

    expect(typeof port.record).toBe('function');
  });

  it('never names a mutation verb against auditEvent', () => {
    const source = readFileSync(WRITER, 'utf8');

    for (const verb of ['update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
      expect(source, verb).not.toContain(`auditEvent.${verb}`);
    }
    // And it does reach the table, so the assertions above are about a
    // writer that writes rather than about an empty file.
    expect(source).toContain('auditEvent.create');
  });

  it('is the only file in the codebase that writes an audit row', () => {
    // M28.1's "single write choke point" means one. A repository in a
    // domain module able to insert here would be a second choke point,
    // and two choke points are none.
    const modules = resolve(__dirname, '../../modules');
    const offenders = grep(modules, /\bauditEvent\.(create|createMany|upsert)\b/);

    expect(offenders).toEqual([]);
  });
});

/** Files under `directory` whose source matches. */
function grep(directory: string, pattern: RegExp): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return grep(path, pattern);
    if (!path.endsWith('.ts')) return [];

    return pattern.test(readFileSync(path, 'utf8')) ? [path] : [];
  });
}
