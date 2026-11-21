import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Can } from '../../../shared/authz';
import type {
  CapabilityCatalogueView,
  MatrixPreviewView,
  MatrixView,
  RoleView,
  UserPermissionsView,
} from '../dto/roles.dto';
import {
  createRoleSchema,
  matrixPreviewSchema,
  matrixUpdateSchema,
  userPermissionsSchema,
  type CreateRoleInput,
  type MatrixPreviewInput,
  type MatrixUpdateInput,
  type UserPermissionsInput,
} from '../dto/roles.schema';
import { RolesService } from '../services/roles.service';

/**
 * Roles & permissions (RM M7.4, API §15).
 *
 * Every route is `@Can('roles.manage')`, which is the contract's own
 * rule for all five and is also the most consequential capability in the
 * catalogue — it is locked **on** for `admin` and **off** for every
 * other role precisely because it is the one that can grant the rest.
 *
 * `@Can` at class level rather than per route: five routes that must all
 * carry the same guard are five chances to omit one, and the omission
 * would not fail — `AuthorizationGuard` denies an unannotated route, so
 * a *missing* decorator is caught, but a route annotated with something
 * weaker would not be. One decorator, one rule.
 *
 * ## Why this is in the users module
 *
 * §15 reads and writes `roles`, `role_permissions` and
 * `user_permissions` — the tables beside `users`, which this module
 * already owns. The *algebra* lives in `shared/authz` because the guard
 * needs it on every request; the HTTP surface over it does not belong
 * inside a kernel that must not depend on a controller.
 */
@Can('roles.manage')
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** API §15.1 — roles with member counts. */
  @Get('roles')
  list(): Promise<readonly RoleView[]> {
    return this.roles.list();
  }

  /** API §15.1 — the 22-capability catalogue, grouped by domain. */
  @Get('permissions')
  catalogue(): CapabilityCatalogueView {
    return this.roles.catalogue();
  }

  /**
   * API §15.2 — the grid and the revision a save must quote back.
   *
   * Declared before `POST /roles`, and the order is for a reader: Nest
   * matches `GET /roles/matrix` and `GET /roles` on different paths, so
   * there is no capture to worry about here — unlike the
   * `:notificationId` case at M19, which genuinely needed the ordering.
   */
  @Get('roles/matrix')
  matrix(): Promise<MatrixView> {
    return this.roles.matrix();
  }

  /**
   * API §15.3's dry run — `{ affectedUsers }` and the change set.
   *
   * `POST` for a read, which the contract specifies and which is right
   * here: the grid is the input and it does not fit in a query string.
   * 200 rather than 201 — nothing was created.
   */
  @Post('roles/matrix/preview')
  @HttpCode(HttpStatus.OK)
  preview(
    @Body(zodBody(matrixPreviewSchema)) body: MatrixPreviewInput,
  ): Promise<MatrixPreviewView> {
    return this.roles.preview(body);
  }

  /** API §15.3 — the save. 409 on a stale revision, a lock or an orphan. */
  @Put('roles/matrix')
  updateMatrix(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(matrixUpdateSchema)) body: MatrixUpdateInput,
  ): Promise<MatrixView> {
    return this.roles.updateMatrix(actor, body);
  }

  /** API §15.4 — a custom role from a base template. */
  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(createRoleSchema)) body: CreateRoleInput,
  ): Promise<RoleView> {
    return this.roles.createRole(actor, body);
  }

  /** API §15.5 — read one account's overrides and its effective set. */
  @Get('users/:userId/permissions')
  userPermissions(@Param('userId') userId: string): Promise<UserPermissionsView> {
    return this.roles.userPermissions(userId);
  }

  /** API §15.5 — replace them. The response is what the guard will see. */
  @Put('users/:userId/permissions')
  setUserPermissions(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body(zodBody(userPermissionsSchema)) body: UserPermissionsInput,
  ): Promise<UserPermissionsView> {
    return this.roles.setUserPermissions(actor, userId, body);
  }
}
