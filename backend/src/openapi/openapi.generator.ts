import 'reflect-metadata';

import { RequestMethod, type Type } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Reflector } from '@nestjs/core';
import { z, type ZodType } from 'zod';

import { IS_PUBLIC_KEY } from '../common/auth/public.decorator';
import { FILE_UPLOAD_FIELD_METADATA } from '../common/http/file-upload.decorator';
import {
  AUTHENTICATED_METADATA,
  CAN_METADATA,
  ROLES_METADATA,
} from '../shared/authz/authz.decorators';

/**
 * OpenAPI 3.1 generation from the application's own controller metadata
 * (RM M33.1, dependency-free half).
 *
 * Nothing here is hand-written per route. The document is read off the same
 * metadata the framework serves from — `@Controller`/`@Get` paths, the
 * authorization decorators the guard reads, and the Zod schemas that
 * `@Body(zodBody(schema))` / `@Query(zodQuery(schema))` install as pipes —
 * so a route change changes the document, and
 * `test/openapi-contract.e2e-spec.ts` fails until the committed copy is
 * regenerated.
 *
 * ## What is deliberately absent
 *
 * - **Response schemas.** Handlers return TypeScript types that do not exist
 *   at runtime; inventing JSON Schema for them would be fiction. Each
 *   operation carries the success status Nest will answer with and a
 *   `default` entry pointing at the contract's envelopes. Response schemas
 *   and error-envelope examples are RM M33.1b and need annotation tooling
 *   that has not been authorised.
 * - **Path-parameter formats.** `@Param('id')` carries no schema; each is
 *   `string`.
 * - **A body schema where the route does not validate with Zod.** The
 *   operation is emitted without one and counted in `x-medora-coverage`.
 */

const ROUTE_PARAM_BODY: number = RouteParamtypes.BODY;
const ROUTE_PARAM_QUERY: number = RouteParamtypes.QUERY;
const ROUTE_PARAM_FILE: number = RouteParamtypes.FILE;

export const GLOBAL_PREFIX = '/api/v1';

export interface Rule {
  readonly isPublic: boolean;
  readonly authenticated: boolean;
  readonly roles: readonly string[];
  readonly capabilities: readonly string[];
}

export interface DiscoveredRoute {
  readonly method: string;
  /** Express-style, with the global prefix: `/api/v1/patients/:patientId`. */
  readonly path: string;
  readonly controller: Type;
  readonly handlerName: string;
  readonly handler: (...args: unknown[]) => unknown;
  readonly rule: Rule;
}

/* ── Controller discovery without booting the application ───────── */

interface DynamicModuleLike {
  readonly module: Type;
  readonly imports?: readonly unknown[];
  readonly controllers?: readonly Type[];
}

function isDynamic(value: unknown): value is DynamicModuleLike {
  return typeof value === 'object' && value !== null && 'module' in value;
}

/**
 * Every controller reachable from `root` through `@Module({ imports })`,
 * in discovery order, each once.
 *
 * This reads decorator metadata only, so it needs no database, cache or
 * network — which is what lets `npm run openapi:generate` run on a build
 * machine. `test/openapi-contract.e2e-spec.ts` proves it finds the same
 * controllers as `ModulesContainer` does in a booted application, which is
 * the discovery `authz-route-matrix.e2e-spec.ts` is built on.
 */
export function collectControllers(root: Type): Type[] {
  const seenModules = new Set<unknown>();
  const seenControllers = new Set<Type>();
  const controllers: Type[] = [];

  const visit = (candidate: unknown): void => {
    // `forwardRef(() => X)` wraps the module in a thunk.
    const resolved =
      typeof candidate === 'object' &&
      candidate !== null &&
      'forwardRef' in candidate &&
      typeof candidate.forwardRef === 'function'
        ? (candidate as { forwardRef: () => unknown }).forwardRef()
        : candidate;

    const moduleClass = isDynamic(resolved) ? resolved.module : (resolved as Type | undefined);
    if (typeof moduleClass !== 'function') return;

    const key = isDynamic(resolved) ? resolved : moduleClass;
    if (seenModules.has(key)) return;
    seenModules.add(key);

    const own = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleClass) ??
      []) as readonly Type[];
    const extra = isDynamic(resolved) ? (resolved.controllers ?? []) : [];
    for (const controller of [...own, ...extra]) {
      if (seenControllers.has(controller)) continue;
      seenControllers.add(controller);
      controllers.push(controller);
    }

    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) ??
      []) as readonly unknown[];
    for (const imported of [...imports, ...(isDynamic(resolved) ? (resolved.imports ?? []) : [])]) {
      visit(imported);
    }
  };

  visit(root);
  return controllers;
}

/* ── Route discovery (same reading as authz-route-matrix) ───────── */

const reflector = new Reflector();

function joinPath(...segments: string[]): string {
  const joined = segments
    .flatMap((segment) => segment.split('/'))
    .filter((part) => part.length > 0)
    .join('/');
  return `/${joined}`;
}

function asList(value: unknown): string[] {
  if (value === undefined) return [''];
  return Array.isArray(value) ? (value as string[]) : [value as string];
}

function ruleOf(handler: (...args: unknown[]) => unknown, controller: Type): Rule {
  const targets = [handler, controller];
  return {
    isPublic: reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) === true,
    authenticated: reflector.getAllAndOverride<boolean>(AUTHENTICATED_METADATA, targets) === true,
    roles: reflector.getAllAndOverride<readonly string[]>(ROLES_METADATA, targets) ?? [],
    capabilities: reflector.getAllAndOverride<readonly string[]>(CAN_METADATA, targets) ?? [],
  };
}

export function routesOf(controller: Type, prefix: string = GLOBAL_PREFIX): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  const prototype = controller.prototype as Record<string, unknown>;
  const controllerPaths = asList(Reflect.getMetadata(PATH_METADATA, controller));

  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const handler = prototype[name];
    if (typeof handler !== 'function') continue;

    const methodPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
    if (methodPath === undefined) continue;

    const verb = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
    const fn = handler as (...args: unknown[]) => unknown;

    for (const base of controllerPaths) {
      for (const own of asList(methodPath)) {
        routes.push({
          method: verb,
          path: joinPath(prefix, base, own),
          controller,
          handlerName: name,
          handler: fn,
          rule: ruleOf(fn, controller),
        });
      }
    }
  }

  return routes;
}

export function discoverRoutes(controllers: readonly Type[]): DiscoveredRoute[] {
  return controllers
    .flatMap((controller) => routesOf(controller))
    .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

/* ── Argument → schema ──────────────────────────────────────────── */

interface ArgumentRecord {
  readonly index: number;
  readonly pipes?: readonly unknown[];
}

/** The Zod schema a `ZodValidationPipe` holds, or `undefined` for any other pipe. */
function schemaOfPipe(pipe: unknown): ZodType | undefined {
  if (typeof pipe !== 'object' || pipe === null) return undefined;
  // `ZodValidationPipe.schema` is `private readonly`; it is read here, at
  // runtime, rather than widened to public for the generator's sake.
  const schema = (pipe as { schema?: unknown }).schema;
  return typeof schema === 'object' && schema !== null && '_zod' in schema
    ? (schema as ZodType)
    : undefined;
}

interface ArgumentSummary {
  readonly hasBody: boolean;
  readonly hasQuery: boolean;
  readonly bodySchema: ZodType | undefined;
  readonly querySchema: ZodType | undefined;
  /** The multipart field the file arrives in (`FileUpload`), when the route takes one. */
  readonly uploadField: string | undefined;
}

function argumentsOf(route: DiscoveredRoute): ArgumentSummary {
  const metadata = (Reflect.getMetadata(ROUTE_ARGS_METADATA, route.controller, route.handlerName) ??
    {}) as Record<string, ArgumentRecord>;

  let hasBody = false;
  let hasQuery = false;
  let hasFile = false;
  let bodySchema: ZodType | undefined;
  let querySchema: ZodType | undefined;

  for (const [key, record] of Object.entries(metadata)) {
    const type = Number(key.split(':')[0]);
    if (type === ROUTE_PARAM_FILE) hasFile = true;
    const schema = (record.pipes ?? []).map(schemaOfPipe).find((s) => s !== undefined);
    if (type === ROUTE_PARAM_BODY) {
      hasBody = true;
      bodySchema ??= schema;
    } else if (type === ROUTE_PARAM_QUERY) {
      hasQuery = true;
      querySchema ??= schema;
    }
  }

  const uploadField = Reflect.getMetadata(FILE_UPLOAD_FIELD_METADATA, route.handler) as
    | string
    | undefined;
  // A file read without `FileUpload` would be documented as a JSON body (or
  // no body) — the drift this check exists to stop.
  if (hasFile && uploadField === undefined) {
    throw new Error(
      `${route.controller.name}.${route.handlerName} reads an @UploadedFile() but is not declared with @FileUpload(field), so its multipart body cannot be documented`,
    );
  }

  return {
    hasBody: hasBody || uploadField !== undefined,
    hasQuery,
    bodySchema,
    querySchema,
    uploadField,
  };
}

/**
 * The multipart body of a `FileUpload` route: the validated text fields
 * (if any) plus the binary part, which is always required.
 */
function multipartSchema(fields: Json | undefined, uploadField: string): Json {
  const properties = { ...((fields?.['properties'] ?? {}) as Record<string, Json>) };
  properties[uploadField] = { type: 'string', contentMediaType: 'application/octet-stream' };
  const required = [...new Set([...((fields?.['required'] ?? []) as string[]), uploadField])];
  return { ...(fields ?? {}), type: 'object', properties, required };
}

type Json = Record<string, unknown>;

/** Zod 4's own converter, in the dialect OpenAPI 3.1 uses (JSON Schema 2020-12). */
function toJsonSchema(schema: ZodType): Json | undefined {
  try {
    const converted = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'any',
      cycles: 'ref',
      reused: 'inline',
    }) as Json;
    const { $schema: _dialect, ...rest } = converted;
    return rest;
  } catch {
    return undefined;
  }
}

/* ── Document ───────────────────────────────────────────────────── */

export interface Coverage {
  readonly operations: number;
  readonly withRequestBody: number;
  readonly withRequestBodySchema: number;
  readonly withRequestBodyWithoutSchema: number;
  readonly withQuery: number;
  readonly withQuerySchema: number;
  readonly withQueryWithoutSchema: number;
  /** Operations with no Zod-derived request schema (body or query) to describe. */
  readonly withAnyRequestSchema: number;
  readonly withoutRequestSchema: number;
}

export interface OpenApiOptions {
  readonly version: string;
}

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function pathParametersOf(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]!);
}

function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeys) as T;
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Json)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortKeys(v)]),
  ) as T;
}

function successStatus(route: DiscoveredRoute): number {
  const declared = Reflect.getMetadata(HTTP_CODE_METADATA, route.handler) as number | undefined;
  if (declared !== undefined) return declared;
  return route.method === 'POST' ? 201 : 200;
}

export function buildOpenApiDocument(controllers: readonly Type[], options: OpenApiOptions): Json {
  const routes = discoverRoutes(controllers);
  const paths: Record<string, Record<string, Json>> = {};
  const componentSchemas: Record<string, Json> = {};

  let withBody = 0;
  let withBodySchema = 0;
  let withQuery = 0;
  let withQuerySchema = 0;
  let withAnySchema = 0;

  for (const route of routes) {
    const args = argumentsOf(route);
    const operationId = `${route.controller.name.replace(/Controller$/, '')}_${route.handlerName}`;
    const parameters: Json[] = pathParametersOf(route.path).map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    // `$defs` only appears for recursive schemas; they move to components
    // under a name that cannot collide with another operation's.
    const hoist = (schema: Json, suffix: string): Json => {
      const defs = schema['$defs'] as Record<string, Json> | undefined;
      if (defs === undefined) return schema;
      const { $defs: _defs, ...rest } = schema;
      const rename = (name: string): string => `${operationId}_${suffix}_${name}`;
      const rewrite = (value: unknown): Json =>
        JSON.parse(
          JSON.stringify(value).replace(
            /#\/\$defs\/([^"]+)/g,
            (_m, name: string) => `#/components/schemas/${rename(name)}`,
          ),
        ) as Json;
      for (const [name, def] of Object.entries(defs)) componentSchemas[rename(name)] = rewrite(def);
      return rewrite(rest);
    };

    let bodySchemaJson: Json | undefined;
    if (args.bodySchema !== undefined) {
      const converted = toJsonSchema(args.bodySchema);
      if (converted !== undefined) bodySchemaJson = hoist(converted, 'body');
    }
    if (args.uploadField !== undefined) {
      bodySchemaJson = multipartSchema(bodySchemaJson, args.uploadField);
    }
    const bodyMediaType =
      args.uploadField === undefined ? 'application/json' : 'multipart/form-data';

    let querySchemaJson: Json | undefined;
    if (args.querySchema !== undefined) {
      const converted = toJsonSchema(args.querySchema);
      if (converted !== undefined) querySchemaJson = hoist(converted, 'query');
    }

    if (querySchemaJson !== undefined) {
      const properties = (querySchemaJson['properties'] ?? {}) as Record<string, Json>;
      const required = new Set((querySchemaJson['required'] ?? []) as string[]);
      for (const [name, schema] of Object.entries(properties)) {
        parameters.push({ name, in: 'query', required: required.has(name), schema });
      }
    }

    const rule = route.rule;
    const operation: Json = {
      operationId,
      tags: [route.controller.name.replace(/Controller$/, '')],
      security: rule.isPublic ? [] : [{ bearerAuth: [] }],
      'x-medora-authz': {
        public: rule.isPublic,
        authenticated: rule.authenticated,
        roles: [...rule.roles],
        can: [...rule.capabilities],
      },
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(args.hasBody
        ? {
            requestBody: {
              required: true,
              content: {
                [bodyMediaType]: bodySchemaJson === undefined ? {} : { schema: bodySchemaJson },
              },
              ...(bodySchemaJson === undefined
                ? {
                    description:
                      'A request body is read, but the route does not validate it with a Zod schema, so none is derived.',
                  }
                : {}),
            },
          }
        : {}),
      responses: {
        [String(successStatus(route))]: {
          description:
            'Success status Nest answers with. The payload is the `{ "data": … }` envelope of BACKEND_API_CONTRACT.md §0.2; its shape is not derived from code.',
        },
        default: {
          description:
            'Error envelope of BACKEND_API_CONTRACT.md §0.3. Not modelled here (RM M33.1b).',
        },
      },
    };

    if (args.hasBody) {
      withBody += 1;
      if (bodySchemaJson !== undefined) withBodySchema += 1;
    }
    if (args.hasQuery) {
      withQuery += 1;
      if (querySchemaJson !== undefined) withQuerySchema += 1;
    }
    if (bodySchemaJson !== undefined || querySchemaJson !== undefined) withAnySchema += 1;

    const openApiPath = toOpenApiPath(route.path);
    (paths[openApiPath] ??= {})[route.method.toLowerCase()] = operation;
  }

  const coverage: Coverage = {
    operations: routes.length,
    withRequestBody: withBody,
    withRequestBodySchema: withBodySchema,
    withRequestBodyWithoutSchema: withBody - withBodySchema,
    withQuery,
    withQuerySchema,
    withQueryWithoutSchema: withQuery - withQuerySchema,
    withAnyRequestSchema: withAnySchema,
    withoutRequestSchema: routes.length - withAnySchema,
  };

  return sortKeys({
    openapi: '3.1.0',
    info: {
      title: 'Medora API',
      version: options.version,
      description:
        'Generated from the NestJS controller metadata by `npm run openapi:generate`. Do not edit by hand: `test/openapi-contract.e2e-spec.ts` fails when this file differs from what the code generates. Request schemas are derived from Zod; response schemas are not derived (RM M33.1b).',
    },
    // Paths carry the global prefix themselves, so the server is the origin.
    servers: [{ url: '/' }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      ...(Object.keys(componentSchemas).length > 0 ? { schemas: componentSchemas } : {}),
    },
    'x-medora-coverage': coverage,
  });
}

/* ── Drift comparison ───────────────────────────────────────────── */

/** `GET /api/v1/patients/{patientId}` for every operation in a document. */
export function operationKeys(document: Json): string[] {
  const keys: string[] = [];
  for (const [path, item] of Object.entries((document['paths'] ?? {}) as Json)) {
    for (const method of Object.keys(item as Json)) {
      keys.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return keys.sort();
}

export interface SpecDiff {
  readonly identical: boolean;
  readonly addedOperations: readonly string[];
  readonly removedOperations: readonly string[];
  /** Operations present in both whose content differs. */
  readonly changedOperations: readonly string[];
}

/** Compares a generated document with the committed one. */
export function diffSpecs(committed: Json, generated: Json): SpecDiff {
  const before = new Set(operationKeys(committed));
  const after = new Set(operationKeys(generated));
  const added = [...after].filter((key) => !before.has(key));
  const removed = [...before].filter((key) => !after.has(key));

  const operationOf = (doc: Json, key: string): unknown => {
    const [method, ...rest] = key.split(' ');
    const path = rest.join(' ');
    return ((doc['paths'] as Json | undefined)?.[path] as Json | undefined)?.[
      method!.toLowerCase()
    ];
  };
  const changed = [...after]
    .filter((key) => before.has(key))
    .filter(
      (key) =>
        JSON.stringify(operationOf(committed, key)) !== JSON.stringify(operationOf(generated, key)),
    );

  return {
    identical: JSON.stringify(committed) === JSON.stringify(generated),
    addedOperations: added,
    removedOperations: removed,
    changedOperations: changed,
  };
}

export function renderDocument(document: Json): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
