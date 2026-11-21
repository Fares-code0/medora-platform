/**
 * Who may reach the Administration Center — every route, every role, through
 * the real `AuthorizationGuard` reading the real `AdministrationController`'s
 * metadata.
 *
 * The controller is admin-only by its class-level `@Roles('admin')`. Exactly
 * two routes are wider: `GET queue` and `GET waiting-room` also admit
 * reception, whose workspace owns those screens. Their writes, and every other
 * route here, still admit the administrator alone. The route list is read off
 * the controller rather than typed out, so a route added later is covered
 * without anyone remembering to add it here.
 *
 * `test/authz-route-matrix.e2e-spec.ts` makes the same claim over HTTP
 * against a database; this one needs none.
 */

import 'reflect-metadata';

import { HttpStatus, RequestMethod, type ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';

import { AUTHENTICATED_USER } from '../../../common/auth/authenticated-user';
import { IS_PUBLIC_KEY } from '../../../common/auth/public.decorator';
import { AppException } from '../../../common/errors/app.exception';
import {
  AuthorizationGuard,
  NO_OVERRIDES,
  PermissionResolver,
  SEEDED_MATRIX,
  type PermissionCache,
  type RoleRepository,
} from '../../../shared/authz';
import { AdministrationController } from './administration.controller';

/** The catalogue's own bundles, no overrides: the guard is under test, not the database. */
const SEEDED_ROLES: RoleRepository = {
  currentMatrix: () => Promise.resolve(SEEDED_MATRIX),
  overridesFor: () => Promise.resolve(NO_OVERRIDES),
  userIdsWithRole: () => Promise.resolve([]),
};

/** Never holds anything, so every decision is resolved afresh from the matrix. */
const NO_CACHE: PermissionCache = {
  get: () => Promise.resolve(undefined),
  set: () => Promise.resolve(),
  forget: () => Promise.resolve(),
  forgetMany: () => Promise.resolve(),
  clear: () => Promise.resolve(),
};

/** Every role code a token can carry, matrix roles and the two outside it. */
const EVERY_ROLE = ['admin', 'doctor', 'reception', 'laboratory', 'pharmacy', 'patient', 'nurse'];

interface Route {
  readonly handler: string;
  readonly verb: string;
  readonly path: string;
}

const prototype = AdministrationController.prototype as unknown as Record<string, object>;

const ROUTES: readonly Route[] = Object.getOwnPropertyNames(AdministrationController.prototype)
  .filter((name) => name !== 'constructor')
  .filter((name) => Reflect.getMetadata(PATH_METADATA, prototype[name]!) !== undefined)
  .map((name) => {
    const handler = prototype[name]!;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
    return {
      handler: name,
      verb: RequestMethod[method],
      path: Reflect.getMetadata(PATH_METADATA, handler) as string,
    };
  });

const label = (route: Route) => `${route.verb} ${route.path}`;
const READS_FOR_RECEPTION = ['GET queue', 'GET waiting-room'];

function contextFor(handler: string, roleCode?: string): ExecutionContext {
  const request = { headers: {} } as unknown as Request & Record<symbol, unknown>;
  if (roleCode !== undefined) {
    request[AUTHENTICATED_USER] = {
      id: `u-${roleCode}`,
      publicId: `usr_u-${roleCode}`,
      role: roleCode,
      permissions: [],
      sessionId: 'sess-1',
    };
  }
  return {
    getHandler: () => prototype[handler],
    getClass: () => AdministrationController,
    switchToHttp: () => ({ getRequest: <T>() => request as T }),
  } as unknown as ExecutionContext;
}

describe('AdministrationController authorization', () => {
  let guard: AuthorizationGuard;

  beforeEach(() => {
    guard = new AuthorizationGuard(new Reflector(), new PermissionResolver(SEEDED_ROLES, NO_CACHE));
  });

  async function statusOf(handler: string, roleCode?: string): Promise<HttpStatus> {
    try {
      await guard.canActivate(contextFor(handler, roleCode));
      return HttpStatus.OK;
    } catch (error) {
      if (error instanceof AppException) return error.getStatus();
      throw error;
    }
  }

  async function admitted(route: Route): Promise<string[]> {
    const roles: string[] = [];
    for (const role of EVERY_ROLE) {
      if ((await statusOf(route.handler, role)) === HttpStatus.OK) roles.push(role);
    }
    return roles;
  }

  it('reads the whole route list off the controller', () => {
    // A sanity floor, so a broken discovery cannot pass every test vacuously.
    expect(ROUTES.length).toBeGreaterThan(40);
    expect(ROUTES.map(label)).toEqual(expect.arrayContaining(READS_FOR_RECEPTION));
  });

  it.each(READS_FOR_RECEPTION)('admits exactly admin and reception to %s', async (name) => {
    const route = ROUTES.find((entry) => label(entry) === name)!;
    expect(await admitted(route)).toEqual(['admin', 'reception']);
  });

  it.each(READS_FOR_RECEPTION)(
    'refuses doctor, laboratory, pharmacy, patient and nurse on %s with 403',
    async (name) => {
      const route = ROUTES.find((entry) => label(entry) === name)!;
      for (const role of ['doctor', 'laboratory', 'pharmacy', 'patient', 'nurse']) {
        expect(await statusOf(route.handler, role)).toBe(HttpStatus.FORBIDDEN);
      }
    },
  );

  it('keeps every other route admin-only — the queue and waiting-room writes included', async () => {
    const others = ROUTES.filter((route) => !READS_FOR_RECEPTION.includes(label(route)));
    expect(others.map(label)).toEqual(
      expect.arrayContaining([
        'POST queue/:id/advance',
        'POST queue/:id/assign-room',
        'POST queue/:id/remove',
        'POST waiting-room/:id/call',
        'POST waiting-room/:id/seat',
        'GET staff',
        'GET overview',
      ]),
    );
    for (const route of others) {
      expect({ route: label(route), admitted: await admitted(route) }).toEqual({
        route: label(route),
        admitted: ['admin'],
      });
    }
  });

  it('admits reception to these two reads and nothing else', async () => {
    const forReception: string[] = [];
    for (const route of ROUTES) {
      if ((await statusOf(route.handler, 'reception')) === HttpStatus.OK) {
        forReception.push(label(route));
      }
    }
    expect(forReception.sort()).toEqual([...READS_FOR_RECEPTION].sort());
  });

  it('answers 401 to an unauthenticated request on every route, the two reads included', async () => {
    for (const route of ROUTES) {
      expect({ route: label(route), status: await statusOf(route.handler) }).toEqual({
        route: label(route),
        status: HttpStatus.UNAUTHORIZED,
      });
    }
  });

  it('makes no route public', () => {
    for (const route of ROUTES) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, prototype[route.handler]!)).toBeUndefined();
    }
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdministrationController)).toBeUndefined();
  });
});
