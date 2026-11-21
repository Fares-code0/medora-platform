import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Controller, Post, UploadedFile, type Type } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import {
  GLOBAL_PREFIX,
  buildOpenApiDocument,
  collectControllers,
  diffSpecs,
  operationKeys,
  renderDocument,
} from '../src/openapi/openapi.generator';

import { type AuthHarness, createAuthHarness } from './support/auth-app';
import { moduleCoverage, parseContractModules } from './support/contract-modules';

/**
 * RM M33.2 — the generated OpenAPI document against the code and against
 * `BACKEND_API_CONTRACT.md`.
 *
 * ## What is asserted
 *
 * 1. **The committed `docs/openapi.json` is what the code generates.** A
 *    route added, removed, re-guarded or re-validated without running
 *    `npm run openapi:generate` fails here, naming the operations.
 * 2. **Discovery is complete.** The generator reads controllers from the
 *    `@Module` graph (so the CLI needs no database); this suite proves
 *    that is the same set `ModulesContainer` holds in a booted
 *    application, that the operations equal the routes Express serves,
 *    and that their number equals the rows of the committed route × role
 *    table (`authz-route-matrix.snapshot.txt`).
 * 3. **All 20 contract modules are covered.** Each numbered module of the
 *    contract has literal endpoints, and at least one is served. The
 *    endpoints the contract names and the code does not serve are
 *    enumerated in `KNOWN_UNSERVED` — a new gap, or a gap closed, fails
 *    until the list is updated, so a module cannot be silently dropped
 *    (the failure RM M33.2 names for modules 11/13/16/18/19).
 * 4. **The check is shown to fail.** The comparison functions are run
 *    against a document with an endpoint removed — the roadmap's
 *    "removing an endpoint fails CI".
 */
const root = resolve(__dirname, '..');
const committed = JSON.parse(readFileSync(resolve(root, 'docs', 'openapi.json'), 'utf8')) as Record<
  string,
  unknown
>;
const version = (
  JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
).version;

/**
 * Contract endpoints with no operation, as of 2026-11-14. Each is a real
 * difference between `BACKEND_API_CONTRACT.md` and the code, recorded here
 * rather than resolved by this check. Remove an entry when its endpoint
 * ships (or the contract is corrected); do not add one to make a failure go
 * away without deciding which side is wrong.
 */
const KNOWN_UNSERVED = [
  'GET /admin/patients',
  'GET /admin/patients/{}',
  'GET /contacts',
  'POST /admin/users',
  'POST /conversations/{}/attachments',
];

let harness: AuthHarness;
let generated: Record<string, unknown>;

beforeAll(async () => {
  harness = await createAuthHarness('openapi-contract');
  generated = buildOpenApiDocument(collectControllers(AppModule), { version });
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe('generated OpenAPI document', () => {
  it('equals the committed docs/openapi.json (run `npm run openapi:generate` after a route change)', () => {
    const diff = diffSpecs(committed, generated);
    expect(
      {
        added: diff.addedOperations,
        removed: diff.removedOperations,
        changed: diff.changedOperations,
      },
      'docs/openapi.json is stale — run `npm run openapi:generate` and commit it',
    ).toEqual({ added: [], removed: [], changed: [] });
    expect(renderDocument(generated)).toBe(
      readFileSync(resolve(root, 'docs', 'openapi.json'), 'utf8'),
    );
  });

  it('finds the controllers a booted application holds', () => {
    const booted = new Set<Type>();
    for (const module of harness.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        if (wrapper.metatype !== null) booted.add(wrapper.metatype as Type);
      }
    }
    expect(new Set(collectControllers(AppModule))).toEqual(booted);
  });

  it('has one operation per route Express serves', () => {
    const express = harness.app.getHttpAdapter().getInstance() as {
      _router: {
        stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
      };
    };
    const mounted = new Set<string>();
    for (const layer of express._router.stack) {
      if (layer.route === undefined || /[*$]/.test(layer.route.path)) continue;
      for (const [verb, on] of Object.entries(layer.route.methods)) {
        if (on && verb !== '_all') mounted.add(`${verb.toUpperCase()} ${layer.route.path}`);
      }
    }

    const documented = new Set(
      operationKeys(generated).map((key) => key.replace(/\{([^}]+)\}/g, ':$1')),
    );
    expect(documented).toEqual(mounted);
  });

  it('has as many operations as the committed authorization table has rows', () => {
    const rows = readFileSync(resolve(__dirname, 'authz-route-matrix.snapshot.txt'), 'utf8')
      .split('\n')
      .filter((line) => /^(GET|POST|PUT|PATCH|DELETE) /.test(line));
    expect(operationKeys(generated)).toHaveLength(rows.length);
  });

  it('states an authorization rule on every operation, and none on a public route', () => {
    const paths = generated['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    for (const [path, item] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const rule = operation['x-medora-authz'] as {
          public: boolean;
          authenticated: boolean;
          roles: string[];
          can: string[];
        };
        const label = `${method.toUpperCase()} ${path}`;
        expect(rule, label).toBeDefined();
        if (rule.public) {
          expect(operation['security'], label).toEqual([]);
        } else {
          expect(operation['security'], label).toEqual([{ bearerAuth: [] }]);
          expect(rule.authenticated || rule.roles.length > 0 || rule.can.length > 0, label).toBe(
            true,
          );
        }
      }
    }
  });

  it('reports its own request-schema coverage consistently', () => {
    const coverage = generated['x-medora-coverage'] as Record<string, number>;
    expect(coverage['operations']).toBe(operationKeys(generated).length);
    expect(coverage['withAnyRequestSchema']! + coverage['withoutRequestSchema']!).toBe(
      coverage['operations'],
    );
    // A body the route reads but does not validate would be a route taking
    // unvalidated input; none exists today, and one appearing is news.
    expect(coverage['withRequestBodyWithoutSchema']).toBe(0);
  });
});

describe('contract module coverage', () => {
  const modules = parseContractModules(
    readFileSync(resolve(root, 'docs', 'BACKEND_API_CONTRACT.md'), 'utf8'),
  );

  it('parses all 20 contract modules, each naming literal endpoints', () => {
    expect(modules.map((module) => module.number)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    for (const module of modules) {
      expect(
        module.literals.length,
        `module ${String(module.number)} ${module.title}`,
      ).toBeGreaterThan(0);
    }
  });

  it('serves at least one endpoint of every module', () => {
    for (const row of moduleCoverage(modules, operationKeys(generated), GLOBAL_PREFIX)) {
      expect(row.matched, `module ${String(row.number)} ${row.title}`).toBeGreaterThan(0);
    }
  });

  it('leaves exactly the recorded contract endpoints unserved', () => {
    const unserved = moduleCoverage(modules, operationKeys(generated), GLOBAL_PREFIX)
      .flatMap((row) => row.unmatched)
      .sort();
    expect(unserved).toEqual([...KNOWN_UNSERVED].sort());
  });
});

describe('multipart uploads are documented as multipart', () => {
  type Operation = Record<string, unknown>;
  const operation = (path: string, method: string): Operation =>
    (generated['paths'] as Record<string, Record<string, Operation>>)[`${GLOBAL_PREFIX}${path}`]![
      method
    ]!;
  const bodyOf = (op: Operation) =>
    (op['requestBody'] as { content: Record<string, { schema?: Record<string, unknown> }> })
      .content;

  it('POST /files is multipart/form-data with `kind` and a required binary `file` part', () => {
    // `files.controller.ts`: `FileInterceptor('file')` reads the bytes and
    // `kind` rides as a text field. It used to be documented as JSON.
    const content = bodyOf(operation('/files', 'post'));
    expect(Object.keys(content)).toEqual(['multipart/form-data']);
    const schema = content['multipart/form-data']!.schema!;
    expect(schema['required']).toEqual(expect.arrayContaining(['kind', 'file']));
    const properties = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['file']).toEqual({
      type: 'string',
      contentMediaType: 'application/octet-stream',
    });
    expect(properties['kind']?.['enum']).toContain('patient_document');
  });

  it('PUT /me/profile/photo documents its `photo` part (it had no request body at all)', () => {
    const content = bodyOf(operation('/me/profile/photo', 'put'));
    expect(Object.keys(content)).toEqual(['multipart/form-data']);
    expect(content['multipart/form-data']!.schema!['required']).toEqual(['photo']);
  });

  it('refuses a route that reads an @UploadedFile() without declaring @FileUpload', () => {
    @Controller('synthetic')
    class UndeclaredUploadController {
      @Post()
      upload(@UploadedFile() _file: unknown): void {}
    }
    expect(() => buildOpenApiDocument([UndeclaredUploadController], { version })).toThrow(
      /UndeclaredUploadController\.upload reads an @UploadedFile\(\)/,
    );
  });
});

describe('drift detection (demonstrated on a synthetic removal)', () => {
  const clone = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(generated)) as Record<string, unknown>;
  const modules = parseContractModules(
    readFileSync(resolve(root, 'docs', 'BACKEND_API_CONTRACT.md'), 'utf8'),
  );

  it('reports an endpoint removed from the code', () => {
    const doc = clone();
    delete (doc['paths'] as Record<string, Record<string, unknown>>)[
      `${GLOBAL_PREFIX}/auth/login`
    ]!['post'];

    const diff = diffSpecs(committed, doc);
    expect(diff.identical).toBe(false);
    expect(diff.removedOperations).toEqual([`POST ${GLOBAL_PREFIX}/auth/login`]);
  });

  it('reports an endpoint added to the code', () => {
    const doc = clone();
    (doc['paths'] as Record<string, unknown>)[`${GLOBAL_PREFIX}/demo`] = { get: {} };
    expect(diffSpecs(committed, doc).addedOperations).toEqual([`GET ${GLOBAL_PREFIX}/demo`]);
  });

  it('reports a loosened authorization rule as a changed operation', () => {
    const doc = clone();
    const operation = (doc['paths'] as Record<string, Record<string, Record<string, unknown>>>)[
      `${GLOBAL_PREFIX}/roles/matrix`
    ]!['put']!;
    operation['x-medora-authz'] = { public: false, authenticated: true, roles: [], can: [] };
    expect(diffSpecs(committed, doc).changedOperations).toEqual([
      `PUT ${GLOBAL_PREFIX}/roles/matrix`,
    ]);
  });

  it('reports a contract endpoint that loses its operation as a new unserved endpoint', () => {
    const keys = operationKeys(generated).filter((key) => key !== `GET ${GLOBAL_PREFIX}/ready`);
    const unserved = moduleCoverage(modules, keys, GLOBAL_PREFIX).flatMap((row) => row.unmatched);
    expect(unserved).toContain('GET /ready');
    expect(unserved).not.toContain('GET /health');
  });
});
