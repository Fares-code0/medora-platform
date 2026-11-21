/**
 * Staff, departments, rooms and resources (API §18, DB §K1–K4, RM M23.2).
 *
 * ## Derived fields are computed, never read back from the row
 *
 * `Department.staffCount` is a `_count` on the relation and
 * `Resource.status` comes from `resourceStatus()`. Neither is taken from
 * a column on the read path, so a stale stored value cannot reach a
 * client — which is what M23.2's verify step means by "derived fields
 * are computed, never stored".
 *
 * ## Soft delete is the module's, not this file's invention
 *
 * Every table here carries `deleted_at` and the shared soft-delete
 * extension hides those rows from `prisma.db`. A delete is therefore an
 * update, and a "restore" is possible later without a second table.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STAFF_SELECT = {
  id: true,
  name: true,
  role: true,
  title: true,
  departmentId: true,
  status: true,
  phone: true,
  email: true,
  workingHours: true,
  permissions: true,
  department: { select: { name: true } },
} as const;

const DEPARTMENT_SELECT = {
  id: true,
  name: true,
  description: true,
  status: true,
  headStaffId: true,
  _count: { select: { staff: true } },
} as const;

const ROOM_SELECT = {
  id: true,
  name: true,
  kind: true,
  status: true,
  capacity: true,
  note: true,
  departmentId: true,
} as const;

const RESOURCE_SELECT = {
  id: true,
  name: true,
  category: true,
  location: true,
  quantity: true,
  reorderLevel: true,
} as const;

@Injectable()
export class DirectoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Staff ─────────────────────────────────────────────────── */

  listStaff(page: number, pageSize: number) {
    return Promise.all([
      this.prisma.db.staffMember.findMany({
        select: STAFF_SELECT,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.staffMember.count(),
    ]);
  }

  createStaff(data: Prisma.StaffMemberUncheckedCreateInput) {
    return this.prisma.db.staffMember.create({ data, select: STAFF_SELECT });
  }

  async updateStaff(id: string, data: Prisma.StaffMemberUncheckedUpdateInput) {
    if (!UUID.test(id)) return null;

    const moved = await this.prisma.db.staffMember.updateMany({ where: { id }, data });

    return moved.count === 0
      ? null
      : this.prisma.db.staffMember.findUnique({ where: { id }, select: STAFF_SELECT });
  }

  async softDeleteStaff(id: string): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.staffMember.updateMany({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return result.count;
  }

  staffById(id: string) {
    if (!UUID.test(id)) return Promise.resolve(null);

    return this.prisma.db.staffMember.findUnique({ where: { id }, select: STAFF_SELECT });
  }

  /* ── Departments ───────────────────────────────────────────── */

  listDepartments() {
    return this.prisma.db.department.findMany({
      select: DEPARTMENT_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  createDepartment(data: Prisma.DepartmentUncheckedCreateInput) {
    return this.prisma.db.department.create({ data, select: DEPARTMENT_SELECT });
  }

  async updateDepartment(id: string, data: Prisma.DepartmentUncheckedUpdateInput) {
    if (!UUID.test(id)) return null;

    const moved = await this.prisma.db.department.updateMany({ where: { id }, data });

    return moved.count === 0
      ? null
      : this.prisma.db.department.findUnique({ where: { id }, select: DEPARTMENT_SELECT });
  }

  /** M23.2's verify step: deleting a department with staff → 409. */
  staffCountFor(departmentId: string): Promise<number> {
    if (!UUID.test(departmentId)) return Promise.resolve(0);

    return this.prisma.db.staffMember.count({ where: { departmentId } });
  }

  async softDeleteDepartment(id: string): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.department.updateMany({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return result.count;
  }

  departmentExists(id: string): Promise<number> {
    if (!UUID.test(id)) return Promise.resolve(0);

    return this.prisma.db.department.count({ where: { id } });
  }

  /* ── Rooms ─────────────────────────────────────────────────── */

  listRooms() {
    return this.prisma.db.room.findMany({ select: ROOM_SELECT, orderBy: { name: 'asc' } });
  }

  createRoom(data: Prisma.RoomUncheckedCreateInput) {
    return this.prisma.db.room.create({ data, select: ROOM_SELECT });
  }

  async updateRoom(id: string, data: Prisma.RoomUncheckedUpdateInput) {
    if (!UUID.test(id)) return null;

    const moved = await this.prisma.db.room.updateMany({ where: { id }, data });

    return moved.count === 0
      ? null
      : this.prisma.db.room.findUnique({ where: { id }, select: ROOM_SELECT });
  }

  async softDeleteRoom(id: string): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.room.updateMany({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return result.count;
  }

  roomById(id: string) {
    if (!UUID.test(id)) return Promise.resolve(null);

    return this.prisma.db.room.findUnique({ where: { id }, select: ROOM_SELECT });
  }

  /* ── Resources ─────────────────────────────────────────────── */

  listResources() {
    return this.prisma.db.resource.findMany({
      select: RESOURCE_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  createResource(data: Prisma.ResourceUncheckedCreateInput) {
    return this.prisma.db.resource.create({ data, select: RESOURCE_SELECT });
  }

  async updateResource(id: string, data: Prisma.ResourceUncheckedUpdateInput) {
    if (!UUID.test(id)) return null;

    const moved = await this.prisma.db.resource.updateMany({ where: { id }, data });

    return moved.count === 0
      ? null
      : this.prisma.db.resource.findUnique({ where: { id }, select: RESOURCE_SELECT });
  }

  async softDeleteResource(id: string): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.resource.updateMany({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return result.count;
  }

  resourceById(id: string) {
    if (!UUID.test(id)) return Promise.resolve(null);

    return this.prisma.db.resource.findUnique({ where: { id }, select: RESOURCE_SELECT });
  }
}

export type StaffRow = Prisma.StaffMemberGetPayload<{ select: typeof STAFF_SELECT }>;
export type DepartmentRow = Prisma.DepartmentGetPayload<{ select: typeof DEPARTMENT_SELECT }>;
export type RoomRow = Prisma.RoomGetPayload<{ select: typeof ROOM_SELECT }>;
export type ResourceRow = Prisma.ResourceGetPayload<{ select: typeof RESOURCE_SELECT }>;
