import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { HospitalScope, NotPhi, PhiRead, Roles } from '../../../shared/authz';
import {
  announcementPatchSchema,
  announcementSchema,
  assignRoomSchema,
  departmentPatchSchema,
  departmentSchema,
  holidaySchema,
  pageQuerySchema,
  policyPatchSchema,
  policySchema,
  resourcePatchSchema,
  resourceSchema,
  roomPatchSchema,
  roomSchema,
  shiftSchema,
  staffPatchSchema,
  staffSchema,
  templatePatchSchema,
  templateSchema,
  workingWeekSchema,
  type AnnouncementBody,
  type AnnouncementPatchBody,
  type AssignRoomBody,
  type DepartmentBody,
  type DepartmentPatchBody,
  type HolidayBody,
  type PageQuery,
  type PolicyBody,
  type PolicyPatchBody,
  type ResourceBody,
  type ResourcePatchBody,
  type RoomBody,
  type RoomPatchBody,
  type ShiftBody,
  type StaffBody,
  type StaffPatchBody,
  type TemplateBody,
  type TemplatePatchBody,
  type WorkingWeekBody,
} from '../dto/administration.schema';
import { DirectoryService } from '../services/directory.service';
import { OperationsService } from '../services/operations.service';
import { OverviewService } from '../services/overview.service';

/**
 * The Administration Center — API §18, RM M23.
 *
 * ## Guarded by role, not by capability, and the roadmap says so
 *
 * M23's own header is "**All routes:** admin role". That is a coarser
 * guard than the capability checks the clinical modules use, and
 * deliberately so: these sixteen resource groups are clinic operations
 * rather than patient data, and the permission catalogue has no
 * `administration.*` capability to check. Inventing one would put a
 * permission on the wire that no seeded role holds — the same
 * reservation `AnalyticsController` records for §12.
 *
 * One narrow exception, by role for the same reason: `GET queue` and
 * `GET waiting-room` also admit **reception**, whose workspace owns those two
 * screens. Their writes, and every other route here, stay admin-only.
 *
 * ## `platform-status` is absent, and that is M23.6
 *
 * Its verify step requires "system health reads real probe data, not
 * constants", and the probes are **M38.1**'s. A route returning
 * hard-coded CPU and uptime would be the one thing that step forbids.
 * See RA-M23.1.
 */
@Roles('admin')
@Controller('administration')
export class AdministrationController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly operations: OperationsService,
    private readonly overview: OverviewService,
  ) {}

  /* ── M23.1 ─────────────────────────────────────────────────── */

  @NotPhi('hospital operations counts')

  @Get('overview')
  clinicOverview() {
    return this.overview.build();
  }

  /* ── M23.2 — staff ─────────────────────────────────────────── */

  @NotPhi('staff directory')

  @Get('staff')
  listStaff(@Query(zodQuery(pageQuerySchema)) query: PageQuery) {
    return this.directory.listStaff(query.page, query.pageSize);
  }

  @Post('staff')
  @HttpCode(HttpStatus.CREATED)
  createStaff(@Body(zodBody(staffSchema)) body: StaffBody) {
    return this.directory.createStaff(body);
  }

  @Patch('staff/:id')
  updateStaff(@Param('id') id: string, @Body(zodBody(staffPatchSchema)) body: StaffPatchBody) {
    return this.directory.updateStaff(id, body);
  }

  @Delete('staff/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteStaff(@Param('id') id: string): Promise<void> {
    return this.directory.deleteStaff(id);
  }

  /* ── M23.2 — departments ───────────────────────────────────── */

  @NotPhi('hospital configuration')

  @Get('departments')
  listDepartments() {
    return this.directory.listDepartments();
  }

  @Post('departments')
  @HttpCode(HttpStatus.CREATED)
  createDepartment(@Body(zodBody(departmentSchema)) body: DepartmentBody) {
    return this.directory.createDepartment(body);
  }

  @Patch('departments/:id')
  updateDepartment(
    @Param('id') id: string,
    @Body(zodBody(departmentPatchSchema)) body: DepartmentPatchBody,
  ) {
    return this.directory.updateDepartment(id, body);
  }

  @Delete('departments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDepartment(@Param('id') id: string): Promise<void> {
    return this.directory.deleteDepartment(id);
  }

  /* ── M23.2 — rooms ─────────────────────────────────────────── */

  @NotPhi('hospital configuration')

  @Get('rooms')
  listRooms() {
    return this.directory.listRooms();
  }

  @Post('rooms')
  @HttpCode(HttpStatus.CREATED)
  createRoom(@Body(zodBody(roomSchema)) body: RoomBody) {
    return this.directory.createRoom(body);
  }

  @Patch('rooms/:id')
  updateRoom(@Param('id') id: string, @Body(zodBody(roomPatchSchema)) body: RoomPatchBody) {
    return this.directory.updateRoom(id, body);
  }

  @Delete('rooms/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRoom(@Param('id') id: string): Promise<void> {
    return this.directory.deleteRoom(id);
  }

  /* ── M23.2 — resources ─────────────────────────────────────── */

  @NotPhi('hospital configuration')

  @Get('resources')
  listResources() {
    return this.directory.listResources();
  }

  @Post('resources')
  @HttpCode(HttpStatus.CREATED)
  createResource(@Body(zodBody(resourceSchema)) body: ResourceBody) {
    return this.directory.createResource(body);
  }

  @Patch('resources/:id')
  updateResource(
    @Param('id') id: string,
    @Body(zodBody(resourcePatchSchema)) body: ResourcePatchBody,
  ) {
    return this.directory.updateResource(id, body);
  }

  @Delete('resources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteResource(@Param('id') id: string): Promise<void> {
    return this.directory.deleteResource(id);
  }

  /* ── M23.3 — schedule ──────────────────────────────────────── */

  @NotPhi('hospital configuration')

  @Get('working-days')
  workingDays() {
    return this.operations.workingDays();
  }

  /**
   * `PUT`, taking the whole week.
   *
   * M23.3's verify step is that the seven rows "can be updated but not
   * created or deleted", so there is no `POST` and no `DELETE` here —
   * the shape of the route is the guarantee.
   */
  @Put('working-days')
  replaceWorkingWeek(@Body(zodBody(workingWeekSchema)) body: WorkingWeekBody) {
    return this.operations.replaceWorkingWeek(body);
  }

  @NotPhi('hospital configuration')

  @Get('holidays')
  holidays() {
    return this.operations.holidays();
  }

  @Post('holidays')
  @HttpCode(HttpStatus.CREATED)
  createHoliday(@Body(zodBody(holidaySchema)) body: HolidayBody) {
    return this.operations.createHoliday(body);
  }

  @Delete('holidays/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteHoliday(@Param('id') id: string): Promise<void> {
    return this.operations.deleteHoliday(id);
  }

  @NotPhi('staff rota')

  @Get('shifts')
  shifts() {
    return this.operations.shifts();
  }

  @Post('shifts')
  @HttpCode(HttpStatus.CREATED)
  createShift(@Body(zodBody(shiftSchema)) body: ShiftBody) {
    return this.operations.createShift(body);
  }

  @Delete('shifts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteShift(@Param('id') id: string): Promise<void> {
    return this.operations.deleteShift(id);
  }

  /* ── M23.4 — queue and waiting room ────────────────────────── */

  /*
   * The two READ routes of M23.4 also admit reception, whose workspace owns
   * the Queue and Waiting Room screens. Handler metadata overrides the
   * class's `@Roles('admin')` (the guard reads `getAllAndOverride`), so this
   * widens these two routes only; every write below stays admin-only.
   */
  // The queue and the waiting room are a hospital's own (F-01, OD-07): a
  // Hospital Admin (or a receptionist) reaches them, confined to that
  // hospital by the service; a Platform Admin is refused there.
  @Roles('admin', 'reception')
  @HospitalScope()
  @PhiRead('patient_queue')
  @Get('queue')
  queue(@CurrentUser() user: AuthenticatedUser) {
    return this.operations.queue(user);
  }

  @HospitalScope()
  @Post('queue/:id/advance')
  @HttpCode(HttpStatus.NO_CONTENT)
  advance(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.operations.advance(user, id);
  }

  @HospitalScope()
  @Post('queue/:id/assign-room')
  @HttpCode(HttpStatus.OK)
  assignRoom(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(assignRoomSchema)) body: AssignRoomBody,
  ) {
    return this.operations.assignRoom(user, id, body.roomId);
  }

  @HospitalScope()
  @Post('queue/:id/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFromQueue(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.operations.removeFromQueue(user, id);
  }

  @Roles('admin', 'reception')
  @HospitalScope()
  @PhiRead('waiting_room')
  @Get('waiting-room')
  waitingRoom(@CurrentUser() user: AuthenticatedUser) {
    return this.operations.waitingRoom(user);
  }

  @HospitalScope()
  @Post('waiting-room/:id/call')
  @HttpCode(HttpStatus.OK)
  call(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.operations.moveWaiting(user, id, 'call');
  }

  @HospitalScope()
  @Post('waiting-room/:id/seat')
  @HttpCode(HttpStatus.OK)
  seat(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.operations.moveWaiting(user, id, 'seat');
  }

  /* ── M23.5 — announcements, policies, templates ────────────── */

  @NotPhi('hospital announcements')

  @Get('announcements')
  announcements(@Query('includeExpired') includeExpired?: string) {
    return this.operations.announcements(includeExpired === 'true');
  }

  @Post('announcements')
  @HttpCode(HttpStatus.CREATED)
  createAnnouncement(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(announcementSchema)) body: AnnouncementBody,
  ) {
    return this.operations.createAnnouncement(user.id, body);
  }

  @Patch('announcements/:id')
  updateAnnouncement(
    @Param('id') id: string,
    @Body(zodBody(announcementPatchSchema)) body: AnnouncementPatchBody,
  ) {
    return this.operations.updateAnnouncement(id, body);
  }

  @Delete('announcements/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAnnouncement(@Param('id') id: string): Promise<void> {
    return this.operations.deleteAnnouncement(id);
  }

  @NotPhi('hospital policies')

  @Get('policies')
  policies() {
    return this.operations.policies();
  }

  @Post('policies')
  @HttpCode(HttpStatus.CREATED)
  createPolicy(@Body(zodBody(policySchema)) body: PolicyBody) {
    return this.operations.createPolicy(body);
  }

  @Patch('policies/:id')
  updatePolicy(@Param('id') id: string, @Body(zodBody(policyPatchSchema)) body: PolicyPatchBody) {
    return this.operations.updatePolicy(id, body);
  }

  @Delete('policies/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePolicy(@Param('id') id: string): Promise<void> {
    return this.operations.deletePolicy(id);
  }

  @NotPhi('document templates')

  @Get('document-templates')
  templates() {
    return this.operations.templates();
  }

  @Post('document-templates')
  @HttpCode(HttpStatus.CREATED)
  createTemplate(@Body(zodBody(templateSchema)) body: TemplateBody) {
    return this.operations.createTemplate(body);
  }

  @Patch('document-templates/:id')
  updateTemplate(
    @Param('id') id: string,
    @Body(zodBody(templatePatchSchema)) body: TemplatePatchBody,
  ) {
    return this.operations.updateTemplate(id, body);
  }

  @Delete('document-templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTemplate(@Param('id') id: string): Promise<void> {
    return this.operations.deleteTemplate(id);
  }

  /* ── M23.6 ─────────────────────────────────────────────────── */

  /**
   * Refused rather than stubbed.
   *
   * `PlatformStatus` carries `system` health — uptime, CPU, RAM,
   * storage, API response time — and M23.6's verify step says it must
   * read "real probe data, not constants". Those probes are **M38.1**'s
   * and do not exist. A route returning plausible constants would pass
   * a smoke test and mislead the one reader who matters: an
   * administrator deciding whether the platform is healthy.
   */
  @NotPhi('platform health')
  @Get('platform-status')
  platformStatus(): never {
    throw new AppException(501, {
      message:
        'Platform status is not implemented yet: its system-health figures need the M38.1 monitoring probes.',
      code: 'not_implemented',
    });
  }

  /* ── M23.7 ─────────────────────────────────────────────────── */

  /**
   * The thin recent feed. The full audit surface — filters, export,
   * incident bookmarks — is **M28**.
   */
  @NotPhi('audit ledger metadata; carries identifiers, never clinical content')
  @Get('audit-events')
  auditEvents(@Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '25', 10);
    const take = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25;

    return this.operations.recentAuditEvents(take);
  }
}
