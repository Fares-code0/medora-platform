/**
 * The M7 exit gate — route × role × permission, table-driven.
 *
 * The roadmap words the gate as "table-driven authz matrix test (route ×
 * role × permission) green for all existing routes". Read literally that
 * is satisfiable today by asserting almost nothing: the only routes this
 * application has are `/api/v1/health` and `/api/v1/ready`, and both are
 * public. Satisfying it that way would be true and worthless.
 *
 * So the gate is met in the form that stays meaningful once M8 starts
 * adding real endpoints:
 *
 *  1. A harness that mounts controllers through a **real Nest app** with
 *     the **real guard** and drives every (route, role) pair over HTTP —
 *     supertest, the exception filter, the whole path a request takes.
 *     It ships with one fixture route per decorator shape, including the
 *     unmarked one.
 *  2. The full 5 × 22 resolver matrix asserted directly, which needs no
 *     routes to be meaningful and is the part that will not change when
 *     routes arrive.
 *
 * Real routes are not added here. `authz-route-matrix.e2e-spec.ts` (RM
 * M34.2) discovers every route the application mounts and drives each one
 * against every role, so this file keeps the fixture shapes and the
 * resolver matrix and nothing else.
 */

import {
  Controller,
  Get,
  Module,
  type INestApplication,
  type NestMiddleware,
  Injectable,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AllExceptionsFilter } from '../src/common/http/all-exceptions.filter';
import { ConfigModule } from '../src/config';
import {
  AUTHENTICATED_METADATA,
  AuthorizationGuard,
  AuthzKernelModule,
  CAN_METADATA,
  Can,
  IS_PUBLIC_KEY,
  ROLES_METADATA,
  PERMISSIONS,
  PLATFORM_ROLES,
  PermissionResolver,
  Public,
  Roles,
  SEEDED_MATRIX,
  type Permission,
  type PlatformRole,
} from '../src/shared/authz';
import { AUTHENTICATED_USER } from '../src/common/auth/authenticated-user';

/* ── Fixture routes, one per decorator shape ──────────────────── */

@Controller('fixture')
class FixtureController {
  /** The forgotten-annotation case. Must be refused. */
  @Get('unmarked')
  unmarked(): { ok: true } {
    return { ok: true };
  }

  @Get('public')
  @Public()
  open(): { ok: true } {
    return { ok: true };
  }

  @Get('patients')
  @Can('patients.view')
  patients(): { ok: true } {
    return { ok: true };
  }

  @Get('records')
  @Can('records.view', 'records.edit')
  records(): { ok: true } {
    return { ok: true };
  }

  @Get('admin-only')
  @Roles('admin')
  adminOnly(): { ok: true } {
    return { ok: true };
  }

  @Get('admin-export')
  @Roles('admin')
  @Can('logs.export')
  adminExport(): { ok: true } {
    return { ok: true };
  }
}

/**
 * Stands in for M6.2's authentication guard: reads `x-test-role` and
 * attaches a principal. Test-only, and it is the reason the fixture app
 * is built here rather than by importing `AppModule` — there is no way
 * to authenticate against this application yet.
 */
@Injectable()
class TestPrincipalMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers['x-test-role'];
    const role = Array.isArray(header) ? header[0] : header;

    if (typeof role === 'string' && role.length > 0) {
      (req as Request & Record<symbol, unknown>)[AUTHENTICATED_USER] = {
        id: userIdFor(role),
        publicId: `usr_${role}`,
        role,
        permissions: [],
        sessionId: 'sess-1',
      };
    }
    next();
  }
}

/**
 * A stable uuid per role.
 *
 * It must be a real uuid, not `u-admin`: `user_permissions.user_id` is a
 * `uuid` column, and Postgres answers a malformed literal with a type
 * error rather than an empty result — so a readable fake id turned every
 * capability check into a 500. The resolver was right to surface it
 * (it fails closed when overrides cannot be read); the ids were wrong.
 *
 * These users do not exist, which is the point: a user with no
 * `user_permissions` rows is the ordinary case, and the role bundle
 * alone should decide.
 */
function userIdFor(role: string): string {
  const index = Math.max(0, PLATFORM_ROLES.indexOf(role as PlatformRole)) + 1;

  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

/**
 * `AuthzKernelModule` brings its own `DatabaseModule`, so this suite
 * reads the **seeded** `roles` and `role_permissions` rows rather than
 * the catalogue's constants. That makes it a stronger test than it was:
 * it now fails if the seed and the matrix ever disagree, not merely if
 * the guard's logic breaks.
 */
@Module({
  imports: [ConfigModule, AuthzKernelModule],
  controllers: [FixtureController],
  providers: [
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class FixtureModule {}

/* ── The table ────────────────────────────────────────────────── */

type Expectation = 'allow' | 'forbid' | 'unauthenticated';

interface RouteRow {
  readonly path: string;
  readonly description: string;
  /** Roles that must reach it. Every other platform role must be refused. */
  readonly allowed: readonly PlatformRole[];
  /** What an unauthenticated request gets. */
  readonly anonymous: Expectation;
}

/**
 * Expectations are written by hand rather than derived from
 * `SEEDED_MATRIX`. A table that computed what it asserts from the thing
 * under test would pass just as happily if the matrix were wrong — the
 * same objection `module-graph.e2e-spec.ts` records about transcribing
 * the module list.
 */
const ROUTES: readonly RouteRow[] = [
  {
    path: '/fixture/unmarked',
    description: 'no decorator at all',
    allowed: [],
    anonymous: 'forbid',
  },
  {
    path: '/fixture/public',
    description: '@Public()',
    allowed: [...PLATFORM_ROLES],
    anonymous: 'allow',
  },
  {
    path: '/fixture/patients',
    description: "@Can('patients.view')",
    // Every seeded role holds patients.view.
    allowed: ['admin', 'doctor', 'reception', 'laboratory', 'pharmacy'],
    anonymous: 'unauthenticated',
  },
  {
    path: '/fixture/records',
    description: "@Can('records.view', 'records.edit') — both required",
    // laboratory has records.view but not records.edit; admin has neither.
    allowed: ['doctor'],
    anonymous: 'unauthenticated',
  },
  {
    path: '/fixture/admin-only',
    description: "@Roles('admin')",
    allowed: ['admin'],
    anonymous: 'unauthenticated',
  },
  {
    path: '/fixture/admin-export',
    description: "@Roles('admin') + @Can('logs.export')",
    allowed: ['admin'],
    anonymous: 'unauthenticated',
  },
];

const STATUS: Readonly<Record<Expectation, number>> = {
  allow: 200,
  forbid: 403,
  unauthenticated: 401,
};

describe('authorization matrix — route × role (RM M7 exit gate)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FixtureModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: Request, res: Response, next: NextFunction) => {
      new TestPrincipalMiddleware().use(req, res, next);
    });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  // The table itself: every route against every role.
  for (const route of ROUTES) {
    describe(`${route.path} — ${route.description}`, () => {
      for (const role of PLATFORM_ROLES) {
        const expected = route.allowed.includes(role) ? 200 : 403;

        it(`${role} → ${expected}`, async () => {
          await request(server).get(route.path).set('x-test-role', role).expect(expected);
        });
      }

      it(`anonymous → ${STATUS[route.anonymous]}`, async () => {
        await request(server).get(route.path).expect(STATUS[route.anonymous]);
      });
    });
  }
});

describe('every route in the application carries an authorization rule', () => {
  // The guard denies anything that names no rule, so this is the check
  // that nobody has added a route without thinking about who may call
  // it. It walks Nest's own route table rather than a hand-kept list —
  // a list would have to be remembered, and this is exactly the thing
  // that gets forgotten.
  let app: INestApplication;

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('leaves no handler unannotated', () => {
    const reflector = app.get(Reflector);
    const unannotated: string[] = [];

    for (const controller of controllersOf(app)) {
      for (const [name, handler] of handlersOf(controller)) {
        const targets = [handler, controller];
        const marked =
          reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) === true ||
          reflector.getAllAndOverride<boolean>(AUTHENTICATED_METADATA, targets) === true ||
          (reflector.getAllAndOverride<readonly string[]>(ROLES_METADATA, targets) ?? []).length >
            0 ||
          (reflector.getAllAndOverride<readonly string[]>(CAN_METADATA, targets) ?? []).length > 0;

        if (!marked) unannotated.push(`${controller.name}.${name}`);
      }
    }

    expect(unannotated).toEqual([]);
  });
});

describe('the gate holds on the routes that actually exist', () => {
  // These two are the whole surface of this application today
  // (API §20, RM M1.4). They must stay reachable without a session — a
  // deny-by-default guard that broke the readiness probe would take the
  // service down at deploy rather than at review. The prefix matches
  // `main.ts`'s `setGlobalPrefix('api/v1')`.
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves /api/v1/health unauthenticated', async () => {
    await request(server).get('/api/v1/health').expect(200);
  });

  it('serves /api/v1/ready unauthenticated', async () => {
    // 200 or 503 depending on whether the dependencies are up; what
    // matters here is that authorization does not turn it into 401/403.
    const response = await request(server).get('/api/v1/ready');

    expect([200, 503]).toContain(response.status);
  });
});

describe('authorization matrix — role × permission (RM M7.1)', () => {
  // The 5 × 22 grid, asserted against the resolver rather than over
  // HTTP, and now resolved from the seeded database.
  let resolver: PermissionResolver;
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthzKernelModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    resolver = app.get(PermissionResolver);
  });

  afterAll(async () => {
    await app.close();
  });

  it('covers every cell of the grid', () => {
    expect(PLATFORM_ROLES.length * PERMISSIONS.length).toBe(110);
  });

  for (const role of PLATFORM_ROLES) {
    describe(role, () => {
      for (const permission of PERMISSIONS) {
        const expected = SEEDED_MATRIX[role].includes(permission);

        it(`${expected ? 'holds' : 'does not hold'} ${permission}`, async () => {
          expect(await resolver.can({ userId: userIdFor(role), roleCode: role }, permission)).toBe(
            expected,
          );
        });
      }
    });
  }
});

describe('the resolver and the guard agree', () => {
  // The two halves above could drift: the grid could be right while the
  // guard consulted something else. This ties them together by checking
  // the guard's own answer against the resolver's for one capability
  // route across every role.
  let app: INestApplication;
  let server: Server;
  let resolver: PermissionResolver;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FixtureModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: Request, res: Response, next: NextFunction) => {
      new TestPrincipalMiddleware().use(req, res, next);
    });
    await app.init();
    server = app.getHttpServer() as Server;
    resolver = app.get(PermissionResolver);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([...PLATFORM_ROLES])('%s gets the same answer from both', async (role) => {
    const capability: Permission = 'patients.view';
    const fromResolver = await resolver.can(
      { userId: userIdFor(role), roleCode: role },
      capability,
    );
    const response = await request(server).get('/fixture/patients').set('x-test-role', role);

    expect(response.status === 200).toBe(fromResolver);
  });
});

/* ── Walking Nest's route table ───────────────────────────────── */

/** Every controller class the running application mounted. */
function controllersOf(app: INestApplication): readonly (new (...args: never[]) => object)[] {
  // `NestContainer` is internal, so this reaches for it deliberately and
  // in one place: the alternative is a hand-maintained list of
  // controllers, which is precisely the thing this test exists to catch
  // somebody forgetting to update.
  const container = (app as unknown as { container: NestContainerLike }).container;
  const found: (new (...args: never[]) => object)[] = [];

  for (const module of container.getModules().values()) {
    for (const wrapper of module.controllers.values()) {
      if (typeof wrapper.metatype === 'function') found.push(wrapper.metatype);
    }
  }

  return found;
}

interface NestContainerLike {
  getModules(): Map<
    string,
    { controllers: Map<unknown, { metatype?: (new (...args: never[]) => object) | null }> }
  >;
}

/** The request handlers on a controller — its own prototype methods. */
function handlersOf(
  controller: new (...args: never[]) => object,
): readonly (readonly [string, (...args: never[]) => unknown])[] {
  const prototype = controller.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => [name, prototype[name] as (...args: never[]) => unknown] as const)
    .filter(([, handler]) => typeof handler === 'function');
}
