import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, HospitalScope, NotPhi, PhiRead, Roles } from '../../../shared/authz';
import {
  approveExceptionalAccessSchema,
  approveInformationRequestSchema,
  categoryQuerySchema,
  createInformationRequestSchema,
  decisionSchema,
  grantQueueQuerySchema,
  listQuerySchema,
  requestExceptionalAccessSchema,
  requestQueueQuerySchema,
  reviewSchema,
  type ApproveExceptionalAccessInput,
  type ApproveInformationRequestInput,
  type CategoryQuery,
  type CreateInformationRequestInput,
  type DecisionInput,
  type GrantQueueQuery,
  type ListQuery,
  type RequestExceptionalAccessInput,
  type RequestQueueQuery,
  type ReviewInput,
} from '../dto/controlled-access.schema';
import {
  ControlledAccessService,
  type DataView,
  type GrantListItem,
  type GrantView,
  type InformationRequestListItem,
  type InformationRequestView,
  type PageView,
} from '../services/controlled-access.service';

/**
 * Exceptional Access / Emergency Override and cross-hospital information
 * requests (multi-hospital §2.11, §2.12).
 *
 * `@Authenticated()` rather than a matrix capability, on purpose: eligibility
 * for Break-Glass and every decision on it is a dedicated server-side rule in
 * `ControlledAccessService` (clinical standing, administrative scope, the
 * owning hospital's administrator, never self-approval). No permission-matrix
 * cell or override can grant it.
 *
 * The lists (XH-05) return metadata only — ids, kind, status, categories,
 * the requester's id and name, times; never the patient, the reason or any
 * clinical row — so they are `@NotPhi`. `…/mine` is the caller's own rows;
 * `…/queue` is the Hospital Admin's own hospital (its scope, not a
 * parameter), refused to a Platform Admin, who decides nothing here (F-11).
 */
@Controller()
export class ControlledAccessController {
  constructor(private readonly access: ControlledAccessService) {}

  @Authenticated()
  @Post('exceptional-access')
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(requestExceptionalAccessSchema)) body: RequestExceptionalAccessInput,
  ): Promise<GrantView> {
    return this.access.requestExceptional(user, body);
  }

  @Authenticated()
  @NotPhi('the caller’s own grants: ids, kind, status, categories and times, no patient or clinical data')
  @Get('exceptional-access/mine')
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(listQuerySchema)) query: ListQuery,
  ): Promise<PageView<GrantListItem>> {
    return this.access.myGrants(user, query);
  }

  @Roles('admin')
  @HospitalScope()
  @NotPhi('grant queue metadata for the admin’s own hospital: no patient, reason or clinical data')
  @Get('exceptional-access/queue')
  queue(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(grantQueueQuerySchema)) query: GrantQueueQuery,
  ): Promise<PageView<GrantListItem>> {
    return this.access.grantQueue(user, query);
  }

  @Authenticated()
  @Post('exceptional-access/:grantId/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('grantId') grantId: string,
    @Body(zodBody(approveExceptionalAccessSchema)) body: ApproveExceptionalAccessInput,
  ): Promise<GrantView> {
    return this.access.approveExceptional(user, grantId, body);
  }

  @Authenticated()
  @Post('exceptional-access/:grantId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('grantId') grantId: string,
    @Body(zodBody(decisionSchema)) body: DecisionInput,
  ): Promise<GrantView> {
    return this.access.rejectExceptional(user, grantId, body);
  }

  @Authenticated()
  @Post('exceptional-access/:grantId/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('grantId') grantId: string): Promise<GrantView> {
    return this.access.revokeExceptional(user, grantId);
  }

  @Authenticated()
  @Post('exceptional-access/:grantId/review')
  @HttpCode(HttpStatus.OK)
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('grantId') grantId: string,
    @Body(zodBody(reviewSchema)) body: ReviewInput,
  ): Promise<GrantView> {
    return this.access.reviewEmergency(user, grantId, body);
  }

  @Authenticated()
  @PhiRead('exceptional_access_data', { auditedByHandler: true })
  @Get('exceptional-access/:grantId/data')
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('grantId') grantId: string,
    @Query(zodQuery(categoryQuerySchema)) query: CategoryQuery,
  ): Promise<DataView> {
    return this.access.readUnderGrant(user, grantId, query);
  }

  @Authenticated()
  @Post('information-requests')
  createRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createInformationRequestSchema)) body: CreateInformationRequestInput,
  ): Promise<InformationRequestView> {
    return this.access.createInformationRequest(user, body);
  }

  @Authenticated()
  @NotPhi('the caller’s own information requests: ids, status, items and times, no patient or clinical data')
  @Get('information-requests/mine')
  myRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(listQuerySchema)) query: ListQuery,
  ): Promise<PageView<InformationRequestListItem>> {
    return this.access.myRequests(user, query);
  }

  @Roles('admin')
  @HospitalScope()
  @NotPhi('information-request queue metadata for the admin’s own hospital: no patient, reason or clinical data')
  @Get('information-requests/queue')
  requestQueue(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(requestQueueQuerySchema)) query: RequestQueueQuery,
  ): Promise<PageView<InformationRequestListItem>> {
    return this.access.requestQueue(user, query);
  }

  @Authenticated()
  @Post('information-requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  approveRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Body(zodBody(approveInformationRequestSchema)) body: ApproveInformationRequestInput,
  ): Promise<InformationRequestView> {
    return this.access.approveInformationRequest(user, requestId, body);
  }

  @Authenticated()
  @Post('information-requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  rejectRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Body(zodBody(decisionSchema)) body: DecisionInput,
  ): Promise<InformationRequestView> {
    return this.access.rejectInformationRequest(user, requestId, body);
  }

  @Authenticated()
  @Post('information-requests/:requestId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ): Promise<InformationRequestView> {
    return this.access.revokeInformationRequest(user, requestId);
  }

  @Authenticated()
  @PhiRead('shared_information', { auditedByHandler: true })
  @Get('information-requests/:requestId/shared')
  readShared(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Query(zodQuery(categoryQuerySchema)) query: CategoryQuery,
  ): Promise<DataView> {
    return this.access.readShared(user, requestId, query);
  }
}
