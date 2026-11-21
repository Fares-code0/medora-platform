/**
 * Request validation for the Administration Center (API §18, RM M23).
 *
 * ## Derived fields are never accepted from a client
 *
 * `Resource.status`, `Department.staffCount`, `DocumentTemplate.usageCount`
 * and the queue's waiting minutes are all computed by the server. None
 * appears in any schema here, so there is no request shape that could
 * carry one — a client cannot assert that an out-of-stock item is in
 * stock, because the field it would have to send does not exist.
 *
 * ## The enums are the contract's spellings
 *
 * Mapped to Prisma members at the repository edge (ADR-023 §2), with a
 * `Record` in each direction so neither side can drift.
 */

import { z } from 'zod';

import { patchOf } from '../../../common/validation/patch-schema';

const name = (max: number) => z.string().trim().min(1).max(max);

/* ── Staff ───────────────────────────────────────────────────────── */

export const STAFF_ROLES = ['doctor', 'nurse', 'receptionist', 'laboratory', 'pharmacy'] as const;
export const PRESENCE = ['on-duty', 'on-break', 'off-duty', 'on-leave'] as const;

export const staffSchema = z.object({
  name: name(120),
  role: z.enum(STAFF_ROLES),
  title: name(80),
  departmentId: z.string().uuid(),
  status: z.enum(PRESENCE).default('off-duty'),
  phone: name(30),
  email: z.string().trim().email().max(254).toLowerCase(),
  workingHours: name(80),
  permissions: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
});

export type StaffBody = z.infer<typeof staffSchema>;
export const staffPatchSchema = patchOf(staffSchema);
export type StaffPatchBody = z.infer<typeof staffPatchSchema>;

/* ── Departments ─────────────────────────────────────────────────── */

export const DEPARTMENT_STATUS = ['active', 'inactive'] as const;

export const departmentSchema = z.object({
  name: name(120),
  description: z.string().trim().max(300).optional(),
  status: z.enum(DEPARTMENT_STATUS).default('active'),
  headStaffId: z.string().uuid().nullable().default(null),
});

export type DepartmentBody = z.infer<typeof departmentSchema>;
export const departmentPatchSchema = patchOf(departmentSchema);
export type DepartmentPatchBody = z.infer<typeof departmentPatchSchema>;

/* ── Rooms ───────────────────────────────────────────────────────── */

export const ROOM_KINDS = ['consultation', 'lab', 'procedure', 'pharmacy', 'waiting'] as const;
export const ROOM_STATUS = ['available', 'occupied', 'cleaning', 'maintenance'] as const;

export const roomSchema = z.object({
  name: name(80),
  kind: z.enum(ROOM_KINDS),
  status: z.enum(ROOM_STATUS).default('available'),
  /** M23.2's verify step: `capacity ≤ 0 → 422`. */
  capacity: z.number().int().positive().max(500),
  note: z.string().trim().max(300).optional(),
  departmentId: z.string().uuid(),
});

export type RoomBody = z.infer<typeof roomSchema>;
export const roomPatchSchema = patchOf(roomSchema);
export type RoomPatchBody = z.infer<typeof roomPatchSchema>;

/* ── Resources ───────────────────────────────────────────────────── */

/**
 * The largest count `resources.quantity` and `reorder_level` can hold:
 * both are PostgreSQL `integer`. Without the bound, Zod's safe-integer
 * range let 2,147,483,648 through to the column, which answered 500
 * (2026-10-31). The column's own limit, not a guess at a stock level.
 */
const INT4_MAX = 2_147_483_647;

export const resourceSchema = z.object({
  name: name(120),
  category: name(80),
  location: name(120),
  quantity: z.number().int().min(0).max(INT4_MAX),
  reorderLevel: z.number().int().min(0).max(INT4_MAX),
  // `status` is absent by design — it is derived from the two above.
});

export type ResourceBody = z.infer<typeof resourceSchema>;
export const resourcePatchSchema = patchOf(resourceSchema);
export type ResourcePatchBody = z.infer<typeof resourcePatchSchema>;

/* ── Working days, holidays, shifts ──────────────────────────────── */

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

const workingDaySchema = z
  .object({
    day: z.enum(WEEKDAYS),
    open: z.boolean(),
    startTime: z.string().regex(TIME_OF_DAY, 'Expected "HH:MM"'),
    endTime: z.string().regex(TIME_OF_DAY, 'Expected "HH:MM"'),
    breakLabel: z.string().trim().max(80).nullable().default(null),
  })
  // M23.3's verify step: `start >= end → 422`.
  .refine((value) => value.startTime < value.endTime, {
    message: 'The day must start before it ends',
    path: ['startTime'],
  });

/**
 * A `PUT` of all seven rows.
 *
 * M23.3's verify step is that the seven weekday rows "can be updated but
 * not created or deleted", so the route takes the whole week and writes
 * it — there is no create and no delete, and a body naming six days or
 * eight is refused rather than partially applied.
 */
export const workingWeekSchema = z
  .array(workingDaySchema)
  .length(7)
  .refine(
    (rows) => new Set(rows.map((row) => row.day)).size === 7,
    'Each of the seven weekdays must appear exactly once',
  );

export type WorkingWeekBody = z.infer<typeof workingWeekSchema>;

export const HOLIDAY_KINDS = ['public', 'clinic'] as const;

export const holidaySchema = z.object({
  name: name(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  kind: z.enum(HOLIDAY_KINDS),
  recurring: z.boolean().default(false),
});

export type HolidayBody = z.infer<typeof holidaySchema>;

export const SHIFT_KINDS = ['morning', 'evening', 'on-call', 'vacation', 'leave'] as const;

export const shiftSchema = z.object({
  staffId: z.string().uuid(),
  kind: z.enum(SHIFT_KINDS),
  /** Seven booleans, Monday first — the column is `Boolean[]`. */
  days: z.array(z.boolean()).length(7),
});

export type ShiftBody = z.infer<typeof shiftSchema>;

/* ── Queue and waiting room ──────────────────────────────────────── */

export const QUEUE_PRIORITIES = ['routine', 'priority', 'urgent'] as const;

export const assignRoomSchema = z.object({ roomId: z.string().uuid() });
export type AssignRoomBody = z.infer<typeof assignRoomSchema>;

/* ── Announcements, policies, templates ──────────────────────────── */

export const ANNOUNCEMENT_PRIORITIES = ['low', 'normal', 'high'] as const;

/**
 * `expiresAt` must be in the future when it is given at all.
 *
 * DB §K10 puts the rule in the database —
 * `announcements_expires_after_creation` CHECKs
 * `expires_at IS NULL OR expires_at > created_at`, because "an
 * announcement that expires before it is posted is never seen". Refusing
 * it here turns that constraint into a **422 naming the field** instead
 * of a 500 from the driver, while the CHECK stays as the backstop for
 * any writer that does not come through this route.
 */
export const announcementSchema = z.object({
  title: name(200),
  body: z.string().trim().min(1).max(20_000),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES).default('normal'),
  pinned: z.boolean().default(false),
  expiresAt: z
    .string()
    .datetime()
    .refine((value) => Date.parse(value) > Date.now(), 'An announcement cannot expire in the past')
    .nullable()
    .default(null),
});

export type AnnouncementBody = z.infer<typeof announcementSchema>;
export const announcementPatchSchema = patchOf(announcementSchema).extend({
  archived: z.boolean().optional(),
});
export type AnnouncementPatchBody = z.infer<typeof announcementPatchSchema>;

export const policySchema = z.object({
  title: name(200),
  category: name(80),
  summary: z.string().trim().min(1).max(20_000),
  // `version` is absent: M23.5 bumps it server-side on every edit, so a
  // client that could set it could also freeze it.
});

export type PolicyBody = z.infer<typeof policySchema>;
export const policyPatchSchema = patchOf(policySchema);
export type PolicyPatchBody = z.infer<typeof policyPatchSchema>;

export const TEMPLATE_KINDS = [
  'prescription',
  'certificate',
  'referral',
  'lab-request',
  'radiology-request',
  'discharge',
] as const;

export const templateSchema = z.object({
  name: name(120),
  kind: z.enum(TEMPLATE_KINDS),
  description: z.string().trim().max(300).optional(),
  // `usageCount` is absent — the server counts uses; a client cannot.
});

export type TemplateBody = z.infer<typeof templateSchema>;
export const templatePatchSchema = patchOf(templateSchema).extend({
  archived: z.boolean().optional(),
});
export type TemplatePatchBody = z.infer<typeof templatePatchSchema>;

/* ── Shared query ────────────────────────────────────────────────── */

/**
 * API §0's common list parameters: `page` 1-based, `pageSize` default 20,
 * **max 100**. This schema allowed 200 (default 50) — the one list in the
 * API above the documented cap, found by the M41.2 payload audit
 * (`test/list-payload-size.e2e-spec.ts`, 2026-11-14). No client calls the
 * route yet, so aligning it breaks nothing.
 */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;
