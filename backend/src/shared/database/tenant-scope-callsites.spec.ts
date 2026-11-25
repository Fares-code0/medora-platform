/**
 * Who may choose an RLS scope (audit F-15).
 *
 * The tenant context is derived from the server's own records of the
 * authenticated caller (`TenantContextResolver`), never from request input.
 * `system` scope — which every policy admits — is selected only by code, at
 * the call sites listed here, each a trusted lookup of the caller's own
 * staffing or a platform job. A new call site fails this test until it is
 * reviewed and added: untrusted data cannot reach a `system` scope by a
 * path nobody looked at.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');

const REVIEWED: Readonly<Record<string, string>> = {
  'shared/authz/hospital-context.service.ts': "the caller's own employment / admin assignment",
  'shared/authz/patient-scope.service.ts': "DR-05: the doctor's own employment and the patient's records",
  'shared/authz/permission-resolver.service.ts': "the caller's own standing",
  'shared/authz/phi-read-audit.interceptor.ts': "the reader's own tenant, for audit attribution",
  'shared/authz/tenant-context.resolver.ts': "the caller's own staffing, deciding the request context",
  'shared/jobs/job-runner.service.ts': 'platform maintenance jobs (no request, no caller input)',
  'modules/patients/services/patient.service.ts': "the masked directory's reach, from the caller's tenant",
  'modules/appointments/services/appointment-oversight.service.ts': "the overseer's own hospital, from their staffing",
  'modules/medical-records/services/record-issue.service.ts': "the reviewer's own hospital, from their staffing",
  'modules/administration/services/operations.service.ts': "the operator's own hospital, from their staffing",
  'modules/pharmacy/repositories/safety.repository.ts':
    "the safety screen's legacy (unattributed) allergies and prescriptions of a patient the prescriber already reaches (H2)",
  'modules/doctors/repositories/patient-doctor.repository.ts':
    "the patient-facing directory's public profile projection, filtered to doctors holding an active employment (L6)",
  'modules/doctors/repositories/admin-doctor.repository.ts': 'per-doctor counts only (patients, appointments) for the doctor directory',
  'modules/controlled-access/services/controlled-access.service.ts':
    'whether the target hospital holds the record a grant or request names (ids only), and its admins to notify',
};

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === 'generated' ? [] : sources(path);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('RLS scope selection (F-15)', () => {
  it('chooses `system` or an explicit context only at reviewed call sites', () => {
    const found = sources(SRC)
      .filter((path) => !path.endsWith('shared/database/tenant-context.ts') && !path.endsWith('shared/database/index.ts'))
      .filter((path) => /\b(runAsSystem|runWithTenantContext|setTenantContext)\(/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path).split('\\').join('/'))
      .sort();

    expect(found).toEqual(Object.keys(REVIEWED).sort());
  });

  it('never builds a tenant context from request headers, query or body', () => {
    for (const path of sources(SRC)) {
      const text = readFileSync(path, 'utf8');
      if (!/\b(setTenantContext|runWithTenantContext)\(/.test(text)) continue;
      expect(text, path).not.toMatch(/req(uest)?\.(headers|query|body|params)\b[^;]*(scope|hospital)/i);
    }
  });
});
