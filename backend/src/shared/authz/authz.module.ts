import { Module } from '@nestjs/common';

import { ConfigService } from '../../config';
import { DatabaseModule } from '../database';

import { AuthorizationGuard } from './authorization.guard';
import { PatientScopeService } from './patient-scope.service';
import { PatientSelfScopeService } from './patient-self-scope.service';
import { PermissionResolver } from './permission-resolver.service';
import { PrismaPatientAssignmentRepository } from './prisma-patient-assignment.repository';
import { PrismaPatientSelfRepository } from './prisma-patient-self.repository';
import { PrismaRoleRepository } from './prisma-role.repository';
import { RedisPermissionCache } from './redis-permission-cache';
import {
  PATIENT_ASSIGNMENT_REPOSITORY,
  PATIENT_SELF_REPOSITORY,
  PERMISSION_CACHE,
  ROLE_REPOSITORY,
} from './authz.types';

/**
 * The authorization kernel (RM M7.1, M7.2).
 *
 * | Token | Bound to | State |
 * | --- | --- | --- |
 * | `ROLE_REPOSITORY` | `PrismaRoleRepository` | real, since M5.1 + M5.2 |
 * | `PATIENT_ASSIGNMENT_REPOSITORY` | `PrismaPatientAssignmentRepository` | real, since M5.6 |
 * | `PATIENT_SELF_REPOSITORY` | `PrismaPatientSelfRepository` | real, since ADR-030 |
 * | `PERMISSION_CACHE` | `RedisPermissionCache` | real, since the M7.1 swap |
 *
 * All three placeholders are gone. The cache was the last: until it moved
 * to Redis it was a per-process map, correct for one instance and wrong
 * for several — an invalidation on one left the others serving a stale
 * effective set until the TTL expired, a revocation that did not take.
 * It now shares `REDIS_URL` with the M30.1 job queue under its own key
 * prefix, keeps the same five-minute TTL, and degrades to a miss (a
 * database read), never a denial, when Redis is unreachable.
 * `InMemoryPermissionCache` remains as the resolver's unit-test double.
 *
 * ## The guard is exported here and registered in `auth.module.ts`
 *
 * Not here, and the reason is ordering. Nest runs global guards in the
 * order their providers are instantiated, which follows module import
 * order, and `SharedKernelModule` is imported before the domain modules
 * — so an `APP_GUARD` registered here would run *before*
 * `AccessTokenGuard`, when nothing has attached a principal to the
 * request yet. Every authenticated call would then be refused 401 by
 * this guard despite carrying a valid token.
 *
 * That was not theory: registering it here failed twenty-seven e2e cases
 * on exactly that. The two guards are a pipeline — authenticate, then
 * authorize — so they are registered adjacently in the module that owns
 * the first of them.
 *
 * It could not be registered until now: it denies routes that name no
 * capability, and until every existing route carried an annotation that
 * would have taken down M1's health probes and M6's whole auth surface
 * on the way in. Annotating them and mounting the guard is therefore one
 * change, not two.
 */
@Module({
  // Imported explicitly rather than relied on through `SharedKernelModule`'s
  // `@Global`: both repositories inject `PrismaService`, and a kernel that
  // declares what it needs can be mounted on its own — which is what the
  // exit-gate suite does.
  imports: [DatabaseModule],
  providers: [
    { provide: ROLE_REPOSITORY, useClass: PrismaRoleRepository },
    // `useFactory`, not `useClass`: the cache's constructor takes a TTL
    // and a clock with defaults, and Nest reads constructor metadata
    // rather than honouring defaults — it tries to inject `Number` and
    // fails at boot. The factory is also where the Redis connection is
    // built, from the one validated `REDIS_URL` (ADR-020).
    {
      provide: PERMISSION_CACHE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new RedisPermissionCache(config.redisUrl),
    },
    { provide: PATIENT_ASSIGNMENT_REPOSITORY, useClass: PrismaPatientAssignmentRepository },
    { provide: PATIENT_SELF_REPOSITORY, useClass: PrismaPatientSelfRepository },
    PermissionResolver,
    PatientScopeService,
    PatientSelfScopeService,
    AuthorizationGuard,
  ],
  exports: [
    PermissionResolver,
    PatientScopeService,
    PatientSelfScopeService,
    AuthorizationGuard,
    ROLE_REPOSITORY,
    PERMISSION_CACHE,
    PATIENT_ASSIGNMENT_REPOSITORY,
    PATIENT_SELF_REPOSITORY,
  ],
})
export class AuthzKernelModule {}
