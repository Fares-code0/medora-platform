import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AppException } from '../src/common/errors/app.exception';
import { DOMAIN_MODULES } from '../src/modules';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../src/shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../src/shared/audit';
import { FILE_STORAGE, type FileStoragePort } from '../src/shared/files';
import { OUTBOX, type OutboxPort } from '../src/shared/outbox';

/**
 * The M2 exit gate, executable: the skeleton boots with every module
 * registered and the shared kernel resolvable.
 *
 * The module names are written out rather than derived from
 * `DOMAIN_MODULES`, because a test that reads its expectations from the
 * thing under test passes just as happily when a module is deleted.
 * This list is M2.1's, transcribed.
 */
const EXPECTED_MODULES = [
  'auth',
  'users',
  'doctors',
  'patients',
  'appointments',
  'medical-records',
  'labs',
  'pharmacy',
  'messaging',
  'notifications',
  'ai',
  'reports',
  'settings',
  'administration',
  'platform-settings',
  'audit',
  'files',
  'search',
  'dashboard',
  // Multi-hospital §2.2–§2.6: staffing lifecycle and administrative scope.
  'hospitals',
  // Multi-hospital §2.11–§2.12: Exceptional Access and information requests.
  'controlled-access',
] as const;

const REQUIRED_SUBFOLDERS = ['controllers', 'services', 'dto', 'repositories'] as const;

/** Vitest runs from `backend/`, so the source tree is relative to cwd. */
const MODULES_DIR = join(process.cwd(), 'src', 'modules');

describe('module graph (RM M2)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers all twenty-one domain modules', () => {
    expect(DOMAIN_MODULES).toHaveLength(EXPECTED_MODULES.length);

    // `app.get(Module)` throws if the module is not in the graph, which
    // is the assertion — resolving it proves registration, not just
    // that the class was imported into the registry file.
    for (const module of DOMAIN_MODULES) {
      expect(app.get(module)).toBeDefined();
    }
  });

  it('registers exactly the modules M2.1 lists, by name', () => {
    const registered = DOMAIN_MODULES.map((module) => module.name).sort();
    const expected = EXPECTED_MODULES.map(toClassName).sort();

    expect(registered).toEqual(expected);
  });

  it('gives every module the four convention folders', () => {
    for (const module of EXPECTED_MODULES) {
      for (const folder of REQUIRED_SUBFOLDERS) {
        expect(existsSync(join(MODULES_DIR, module, folder))).toBe(true);
      }
      expect(existsSync(join(MODULES_DIR, module, `${module}.module.ts`))).toBe(true);
    }
  });

  it('has no module on disk that the registry omits', () => {
    // The failure this catches: someone adds a folder, forgets the
    // registry entry, and the module silently never loads. `health` is
    // M1 infrastructure and is imported by `app.module.ts` directly.
    const onDisk = readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== 'health')
      .sort();

    expect(onDisk).toEqual([...EXPECTED_MODULES].sort());
  });

  it('resolves the shared kernel tokens from the global module', () => {
    // Global registration is the reason no domain module has to import
    // the kernel; if it regressed, this is where it would show.
    expect(app.get<AuditDispatcher>(AUDIT_DISPATCHER)).toBeDefined();
    expect(app.get<OutboxPort>(OUTBOX)).toBeDefined();
    expect(app.get<FileStoragePort>(FILE_STORAGE)).toBeDefined();
    // Joined the kernel at M8.6: the six activity kinds are written from
    // six different modules, so the recorder has to sit below all of them.
    expect(app.get<ActivityRecorder>(ACTIVITY_RECORDER)).toBeDefined();
  });

  it('answers 503 from the file-storage stub rather than pretending to store', async () => {
    const storage = app.get<FileStoragePort>(FILE_STORAGE);

    let thrown: unknown;
    try {
      await storage.put({
        kind: 'record_attachment',
        name: 'scan.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from('x'),
      });
    } catch (error) {
      thrown = error;
    }

    // A stub that resolved would hand the caller an id for bytes that
    // do not exist; the failure has to happen at the call.
    expect(thrown).toBeInstanceOf(AppException);
    expect((thrown as AppException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect((thrown as AppException).code).toBe('service_unavailable');
  });
});

/** `medical-records` → `MedicalRecordsModule`; `ai` → `AiModule`. */
function toClassName(folder: string): string {
  const pascal = folder
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `${pascal}Module`;
}
