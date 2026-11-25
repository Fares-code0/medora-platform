import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { sendCsv } from '../../../common/http/csv-export';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, NotPhi, PhiRead } from '../../../shared/authz';
import { Idempotent } from '../../../shared/idempotency';
import type { LabOrderDetailView, LabSummaryView } from '../dto/lab-order.dto';
import {
  attachToRecordSchema,
  createLabOrderSchema,
  enterResultsSchema,
  labOrderExportSchema,
  labOrderListSchema,
  reviewLabOrderSchema,
  reviewLabOrdersSchema,
  transitionLabOrderSchema,
  uploadLabAttachmentSchema,
  type AttachToRecordInput,
  type CreateLabOrderInput,
  type EnterResultsInput,
  type LabOrderExportQuery,
  type LabOrderListQuery,
  type ReviewLabOrderInput,
  type ReviewLabOrdersInput,
  type TransitionLabOrderInput,
  type UploadLabAttachmentInput,
} from '../dto/lab-order.schema';
import {
  LabAttachmentService,
  type AttachToRecordResult,
} from '../services/lab-attachment.service';
import { LabOrderService, type PaginatedLabOrders } from '../services/lab-order.service';
import { LabResultService } from '../services/lab-result.service';
import { LabReviewService, type LabReviewResult } from '../services/lab-review.service';

/**
 * The lab order (RM M14.2–M14.7 — API §8.2–§8.11).
 *
 * ## One capability, and it is the only one the union has
 *
 * `labs.review` is the platform's single laboratory capability
 * (`permission-catalogue.ts` — 22 permissions, one of them a lab one).
 * It is held by `doctor` and `laboratory` and by neither `admin`,
 * `reception` nor `pharmacy`, which is the set §8 addresses. Splitting
 * reads from writes the way `RecordController` splits `records.view`
 * from `records.edit` is not available here: there is no second lab
 * capability to split with, and inventing a 23rd permission is a
 * frontend change first (`permission-catalogue.ts` says so in its
 * header, and `permission-catalogue.spec.ts` fails if this file invents
 * one).
 *
 * Holding the capability is still not a care relationship. Every route
 * resolves through `PatientScopeService`, and an order outside the
 * caller's care answers 404 — the same non-disclosing refusal a
 * genuinely missing one produces (ADR-022).
 *
 * ## Route ordering
 *
 * `GET /lab-orders/summary` and `POST /lab-orders/review` are declared
 * before any `:labOrderId` route. Nest matches in declaration order, so
 * the reverse would read `summary` as an order reference and answer 404
 * for every request.
 *
 * ## `POST …/transition` and not `PATCH { status }`
 *
 * The pipeline is a guarded machine with its own 409 and its own
 * specimen gate, not a field assignment. There is deliberately no
 * `PATCH` that accepts a status: a client that could set it directly
 * would bypass the machine, the specimen check and the timeline event
 * that makes the step reviewable — the same reasoning M12 records for
 * the record lifecycle.
 */
@Can('labs.review')
@Controller('lab-orders')
export class LabOrderController {
  constructor(
    private readonly orders: LabOrderService,
    private readonly results: LabResultService,
    private readonly review: LabReviewService,
    private readonly attachments: LabAttachmentService,
  ) {}

  /** API §8.2 — the worklist. */
  @PhiRead('lab_order_list')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(labOrderListSchema)) query: LabOrderListQuery,
  ): Promise<PaginatedLabOrders> {
    return this.orders.list(user, query);
  }

  /** API §8.11 — the filtered worklist as CSV. Before `:labOrderId`; a file, not an envelope. */
  @PhiRead('lab_order_export', { auditedByHandler: true })
  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(labOrderExportSchema)) query: LabOrderExportQuery,
    @Res() response: Response,
  ): Promise<void> {
    sendCsv(response, await this.orders.export(user, query));
  }

  /** API §8.10 — the cards, including `criticalUnreviewed`. Before `:id`. */
  @NotPhi('counts by status; no results')
  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser): Promise<LabSummaryView> {
    return this.orders.summary(user);
  }

  /**
   * API §8.7 — the bulk review. Declared before `:labOrderId` so
   * `review` is not read as an order reference.
   *
   * 200 rather than 201: it creates nothing, it marks existing rows.
   */
  @Post('review')
  @HttpCode(HttpStatus.OK)
  reviewMany(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(reviewLabOrdersSchema)) body: ReviewLabOrdersInput,
  ): Promise<LabReviewResult> {
    return this.review.reviewMany(user, body);
  }

  /** API §8.4 — place an order. 201, because it creates a resource. */
  @Post()
  @Idempotent()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createLabOrderSchema)) body: CreateLabOrderInput,
  ): Promise<LabOrderDetailView> {
    return this.orders.create(user, body);
  }

  /** API §8.3 — the full order. */
  @PhiRead('lab_order')
  @Get(':labOrderId')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('labOrderId') labOrderId: string,
  ): Promise<LabOrderDetailView> {
    return this.orders.detail(user, labOrderId);
  }

  /** API §8.5 — move along the pipeline. 200: the order already exists. */
  @Post(':labOrderId/transition')
  @HttpCode(HttpStatus.OK)
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('labOrderId') labOrderId: string,
    @Body(zodBody(transitionLabOrderSchema)) body: TransitionLabOrderInput,
  ): Promise<LabOrderDetailView> {
    return this.orders.transition(user, labOrderId, body);
  }

  /** API §8.6 — enter results. The flag is computed, never accepted. */
  @Post(':labOrderId/results')
  @HttpCode(HttpStatus.OK)
  enterResults(
    @CurrentUser() user: AuthenticatedUser,
    @Param('labOrderId') labOrderId: string,
    @Body(zodBody(enterResultsSchema)) body: EnterResultsInput,
  ): Promise<LabOrderDetailView> {
    return this.results.enter(user, labOrderId, body);
  }

  /** API §8.7 — review one result, with its critical acknowledgment. */
  @Post(':labOrderId/review')
  @HttpCode(HttpStatus.OK)
  reviewOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('labOrderId') labOrderId: string,
    @Body(zodBody(reviewLabOrderSchema)) body: ReviewLabOrderInput,
  ): Promise<LabOrderDetailView> {
    return this.review.reviewOne(user, labOrderId, body);
  }

  /** API §8.9 — file the report onto a record, identity-checked. */
  @Post(':labOrderId/attach-to-record')
  @HttpCode(HttpStatus.CREATED)
  attachToRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('labOrderId') labOrderId: string,
    @Body(zodBody(attachToRecordSchema)) body: AttachToRecordInput,
  ): Promise<AttachToRecordResult> {
    return this.attachments.attachToRecord(user, labOrderId, body);
  }

  /** API §8.11 — upload a report, addendum, external result or raw data. */
  @Post(':labOrderId/attachments')
  @HttpCode(HttpStatus.CREATED)
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('labOrderId') labOrderId: string,
    @Body(zodBody(uploadLabAttachmentSchema)) body: UploadLabAttachmentInput,
  ): Promise<LabOrderDetailView> {
    return this.attachments.upload(user, labOrderId, body);
  }
}
