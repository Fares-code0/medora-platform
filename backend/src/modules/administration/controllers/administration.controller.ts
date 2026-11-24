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
import {
  AdminScoped,
  CurrentAdminScope,
  CurrentAdminScopeOrOtherRole,
  hospitalFilterOf,
  Roles,
  type ResolvedAdminScope,
} from '../../../shared/authz';
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
 * ## Administrative scope (S5, OD-07)
 *
 * `@AdminScoped('platform')` on the class: every route here is
 * **Platform Admin only** unless a handler says otherwise, so a route added
 * later without a decision fails closed for Hospital Admins rather than
 * leaking another hospital's rows. Handlers that a Hospital Admin may use
 * are marked `any` (Platform Admin platform-wide, Hospital Admin its own
 * hospital's rows; another hospital's row is 404) or `hospital` (Hospital
 * Admin only). An administrator with no scope is refused on all of them.
 *
 * | Routes | Scope | Why |
 * | --- | --- | --- |
 * | overview, audit-events feed | any | counts and rows filtered by `hospital_id` |
 * | staff | any | in scope = an active `hospital_staff_affiliations` row at the hospital; created staff are affiliated in the same transaction |
 * | departments `GET` | any | the catalogue is platform-wide; `staffCount` counts the caller's hospital only |
 * | departments writes | platform | `departments` has no `hospital_id`: a write changes every hospital's catalogue |
 * | rooms, resources | any | `hospital_id`, stamped on create; legacy rows (no hospital) are outside every hospital's scope |
 * | shifts | any | `staff_shift_assignments.hospital_id`; a Hospital Admin's shift is stamped with its hospital and the staff member's affiliation |
 * | queue, waiting room | hospital | rows name patients: a Platform Admin gets no PHI (OD-07); reception's reads are unchanged |
 * | working-days, holidays, announcements, policies, document templates, platform-status | platform | no `hospital_id` column: platform-wide by construction |
 *
 * ## `platform-status` is absent, and that is M23.6
 *
 * Its verify step requires "system health reads real probe data, not
 * constants", and the probes are **M38.1**'s. A route returning
 * hard-coded CPU and uptime would be the one thing that step forbids.
 * See RA-M23.1.
 */
@Roles('admin')
@AdminScoped('platform')
@Controller('administration')
export class AdministrationController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly operations: OperationsService,
    private readonly overview: OverviewService,
  ) {}

  /* ── M23.1 ─────────────────────────────────────────────────── */

  @Get('overview')
  @AdminScoped('any')
  clinicOverview(@CurrentAdminScope() scope: ResolvedAdminScope) {
    return this.overview.build(hospitalFilterOf(scope));
  }

  /* ── M23.2 — staff ─────────────────────────────────────────── */

  @Get('staff')
  @AdminScoped('any')
  listStaff(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Query(zodQuery(pageQuerySchema)) query: PageQuery,
  ) {
    return this.directory.listStaff(query.page, query.pageSize, hospitalFilterOf(scope));
  }

  @Post('staff')
  @AdminScoped('any')
  @HttpCode(HttpStatus.CREATED)
  createStaff(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Body(zodBody(staffSchema)) body: StaffBody,
  ) {
    return this.directory.createStaff(body, hospitalFilterOf(scope));
  }

  @Patch('staff/:id')
  @AdminScoped('any')
  updateStaff(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('id') id: string,
    @Body(zodBody(staffPatchSchema)) body: StaffPatchBody,
  ) {
    return this.directory.updateStaff(id, body, hospitalFilterOf(scope));
  }

  @Delete('staff/:id')
  @AdminScoped('any')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteStaff(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('id') id: string,
  ): Promise<void> {
    return this.directory.deleteStaff(id, hospitalFilterOf(scope));
  }

  /* ── M23.2 — departments ───────────────────────────────────── */

  @Get('departments')
  @AdminScoped('any')
  listDepartments(@CurrentAdminScope() scope: ResolvedAdminScope) {
    return this.directory.listDepartments(hospitalFilterOf(scope));
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

  @Get('rooms')
  @AdminScoped('any')
  listRooms(@CurrentAdminScope() scope: ResolvedAdminScope) {
    return this.directory.listRooms(hospitalFilterOf(scope));
  }

  @Post('rooms')
  @AdminScoped('any')
  @HttpCode(HttpStatus.CREATED)
  createRoom(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Body(zodBody(roomSchema)) body: RoomBody,
  ) {
    return this.directory.createRoom(body, hospitalFilterOf(scope));
  }

  @Patch('rooms/:id')
  @AdminScoped('any')
  updateRoom(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('id') id: string,
    @Body(zodBody(roomPatchSchema)) body: RoomPatchBody,
  ) {
    return this.directory.updateRoom(id, body, hospitalFilterOf(scope));
  }

  @Delete('rooms/:id')
  @AdminScoped('any')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRoom(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('id') id: string,
  ): Promise<void> {
    return this.directory.deleteRoom(id, hospitalFilterOf(scope));
  }

  /* ── M23.2 — resources ─────────────────────────────────────── */

  @Get('resources')
  @AdminScoped('any')
  listResources(@CurrentAdminScope() scope: ResolvedAdminScope) {
    return this.directory.listResources(hospitalFilterOf(scope));
  }

  @Post('resources')
  @AdminScoped('any')
  @HttpCode(HttpStatus.CREATED)
  createResource(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Body(zodBody(resourceSchema)) body: ResourceBody,
  ) {
    return this.directory.createResource(body, hospitalFilterOf(scope));
  }

  @Patch('resources/:id')
  @AdminScoped('any')
  updateResource(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('id') id: string,
    @Body(zodBody(resourcePatchSchema)) body: ResourcePatchBody,
  ) {
    return this.directory.updateResource(id, body, hospitalFilterOf(scope));
  }

  @Delete('resources/:id')
  @AdminScoped('any')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteResource(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('id') id: string,
  ): Promise<void> {
    return this.directory.deleteResource(id, hospitalFilterOf(scope));
  }

  /* ── M23.3 — schedule ──────────────────────────────────────── */

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

  @Get('shifts')
  @AdminScoped('any')
  shifts(@CurrentAdminScope() scope: ResolvedAdminScope) {
    return this.operations.shifts(hospitalFilterOf(scope));
  }

  @Post('shifts')
  @AdminScoped('any')
  @HttpCode(HttpStatus.CREATED)
  createShift(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Body(zodBody(shiftSchema)) body: ShiftBody,
  ) {
    return this.operations.createShift(body, hospitalFilterOf(scope));
  }

  @Delete('shifts/:id')
  @AdminScoped('any')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteShift(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('id') id: string,
  ): Promise<void> {
    return this.operations.deleteShift(id, hospitalFilterOf(scope));
  }

  /* ── M23.4 — queue and waiting room ────────────────────────── */

  /*
   * The two READ routes of M23.4 also admit reception, whose workspace owns
   * the Queue and Waiting Room screens. Handler metadata overrides the
   * class's `@Roles('admin')` (the guard reads `getAllAndOverride`), so this
   * widens these two routes only; every write below stays admin-only.
   */
  @Roles('admin', 'reception')
  @AdminScoped('hospital', { otherRoles: ['reception'] })
  @Get('queue')
  queue(@CurrentAdminScopeOrOtherRole() scope: ResolvedAdminScope | null) {
    // Reception (scope `null`) is unchanged by S5: platform-wide, as before.
    return this.operations.queue(scope === null ? null : hospitalFilterOf(scope));
  }

  @Post('queue/:id/advance')
  @AdminScoped('hospital')
  @HttpCode(HttpStatus.NO_CONTENT)
  advance(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('id') id: string,
  ): Promise<void> {
    return this.operations.advance(id, hospitalOf(scope));
  }

  @Post('queue/:id/assign-room')
  @AdminScoped('hospital')
  @HttpCode(HttpStatus.OK)
  assignRoom(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('id') id: string,
    @Body(zodBody(assignRoomSchema)) body: AssignRoomBody,
  ) {
    return this.operations.assignRoom(id, body.roomId, hospitalOf(scope));
  }

  @Post('queue/:id/remove')
  @AdminScoped('hospital')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFromQueue(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('id') id: string,
  ): Promise<void> {
    return this.operations.removeFromQueue(id, hospitalOf(scope));
  }

  @Roles('admin', 'reception')
  @AdminScoped('hospital', { otherRoles: ['reception'] })
  @Get('waiting-room')
  waitingRoom(@CurrentAdminScopeOrOtherRole() scope: ResolvedAdminScope | null) {
    return this.operations.waitingRoom(scope === null ? null : hospitalFilterOf(scope));
  }

  @Post('waiting-room/:id/call')
  @AdminScoped('hospital')
  @HttpCode(HttpStatus.OK)
  call(@CurrentAdminScope() scope: ResolvedAdminScope, @Param('id') id: string) {
    return this.operations.moveWaiting(id, 'call', hospitalOf(scope));
  }

  @Post('waiting-room/:id/seat')
  @AdminScoped('hospital')
  @HttpCode(HttpStatus.OK)
  seat(@CurrentAdminScope() scope: ResolvedAdminScope, @Param('id') id: string) {
    return this.operations.moveWaiting(id, 'seat', hospitalOf(scope));
  }

  /* ── M23.5 — announcements, policies, templates ────────────── */

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
  @Get('audit-events')
  @AdminScoped('any')
  auditEvents(@CurrentAdminScope() scope: ResolvedAdminScope, @Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '25', 10);
    const take = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25;

    return this.operations.recentAuditEvents(take, hospitalFilterOf(scope));
  }
}

/** `@AdminScoped('hospital')` routes: the guard admitted only a Hospital Admin. */
function hospitalOf(scope: ResolvedAdminScope): string {
  const hospitalId = hospitalFilterOf(scope);
  if (hospitalId === null) throw AppException.forbidden();
  return hospitalId;
}
