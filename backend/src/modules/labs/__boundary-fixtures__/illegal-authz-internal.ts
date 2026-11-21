/**
 * Boundary fixture (RM M7.1) — **this file is supposed to fail lint.**
 *
 * The violation: reaching past `shared/authz`'s index to the concrete
 * role repository. A module holding a direct reference could construct
 * it with its own Prisma client and resolve permissions outside the
 * cache and the lock rules the resolver applies — which is the whole
 * reason authorization is reached through one token.
 */
import { PrismaRoleRepository } from '../../../shared/authz/prisma-role.repository';

export const leakedAuthzInternal = PrismaRoleRepository.name;
