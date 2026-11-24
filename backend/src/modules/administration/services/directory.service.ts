/**
 * Staff, departments, rooms and resources — API §18, RM M23.2.
 *
 * > ✅ Verify: derived fields are computed, never stored; capacity ≤ 0 →
 * > 422; deleting a department with staff → 409.
 *
 * All three are enforced here or in the schema, and each in the place it
 * belongs: `capacity` is a request-shape rule so it lives in Zod;
 * `staffCount` and `Resource.status` are projections so they live in the
 * view builders; and the department guard is a state rule, so it is a
 * 409 rather than a validation error — the request is well-formed and
 * the *world* refuses it.
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import {
  ACTIVE_STATUS_FROM_WIRE,
  ACTIVE_STATUS_TO_WIRE,
  PRESENCE_FROM_WIRE,
  PRESENCE_TO_WIRE,
  resourceStatus,
  ROOM_KIND_FROM_WIRE,
  ROOM_KIND_TO_WIRE,
  ROOM_STATUS_FROM_WIRE,
  ROOM_STATUS_TO_WIRE,
  STAFF_ROLE_FROM_WIRE,
  STAFF_ROLE_TO_WIRE,
} from '../dto/administration-enums';
import type {
  DepartmentBody,
  DepartmentPatchBody,
  ResourceBody,
  ResourcePatchBody,
  RoomBody,
  RoomPatchBody,
  StaffBody,
  StaffPatchBody,
} from '../dto/administration.schema';
import {
  DirectoryRepository,
  type DepartmentRow,
  type ResourceRow,
  type RoomRow,
  type StaffRow,
} from '../repositories/directory.repository';

@Injectable()
export class DirectoryService {
  constructor(private readonly directory: DirectoryRepository) {}

  /* ── Staff ─────────────────────────────────────────────────── */

  async listStaff(page: number, pageSize: number, hospitalId: string | null) {
    const [rows, totalItems] = await this.directory.listStaff(page, pageSize, hospitalId);

    return {
      items: rows.map(toStaffView),
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  async createStaff(body: StaffBody, hospitalId: string | null) {
    await this.requireDepartment(body.departmentId);

    return toStaffView(
      await this.directory.createStaff(
        {
          name: body.name,
          role: STAFF_ROLE_FROM_WIRE[body.role]!,
          title: body.title,
          departmentId: body.departmentId,
          status: PRESENCE_FROM_WIRE[body.status]!,
          phone: body.phone,
          email: body.email,
          workingHours: body.workingHours,
          permissions: body.permissions,
        },
        hospitalId,
      ),
    );
  }

  async updateStaff(id: string, body: StaffPatchBody, hospitalId: string | null) {
    if (body.departmentId !== undefined) await this.requireDepartment(body.departmentId);

    const row = await this.directory.updateStaff(
      id,
      {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.role === undefined ? {} : { role: STAFF_ROLE_FROM_WIRE[body.role]! }),
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.departmentId === undefined ? {} : { departmentId: body.departmentId }),
        ...(body.status === undefined ? {} : { status: PRESENCE_FROM_WIRE[body.status]! }),
        ...(body.phone === undefined ? {} : { phone: body.phone }),
        ...(body.email === undefined ? {} : { email: body.email }),
        ...(body.workingHours === undefined ? {} : { workingHours: body.workingHours }),
        ...(body.permissions === undefined ? {} : { permissions: body.permissions }),
      },
      hospitalId,
    );

    if (row === null) throw AppException.notFound('Staff member not found');

    return toStaffView(row);
  }

  async deleteStaff(id: string, hospitalId: string | null): Promise<void> {
    if ((await this.directory.softDeleteStaff(id, hospitalId)) === 0) {
      throw AppException.notFound('Staff member not found');
    }
  }

  /* ── Departments ───────────────────────────────────────────── */

  async listDepartments(hospitalId: string | null) {
    return (await this.directory.listDepartments(hospitalId)).map(toDepartmentView);
  }

  async createDepartment(body: DepartmentBody) {
    return toDepartmentView(
      await this.directory.createDepartment({
        name: body.name,
        ...(body.description === undefined ? {} : { description: body.description }),
        status: ACTIVE_STATUS_FROM_WIRE[body.status]!,
        ...(body.headStaffId === null ? {} : { headStaffId: body.headStaffId }),
      }),
    );
  }

  async updateDepartment(id: string, body: DepartmentPatchBody) {
    const row = await this.directory.updateDepartment(id, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.status === undefined ? {} : { status: ACTIVE_STATUS_FROM_WIRE[body.status]! }),
      ...(body.headStaffId === undefined ? {} : { headStaffId: body.headStaffId }),
    });

    if (row === null) throw AppException.notFound('Department not found');

    return toDepartmentView(row);
  }

  /**
   * M23.2's verify step: deleting a department with staff → **409**.
   *
   * A 409 and not a 422: the request is well-formed and would be legal
   * on an empty department. What refuses it is the state of the world,
   * which is exactly the distinction ADR-013 draws. The message names
   * the count so an administrator knows how much work reassignment is.
   */
  async deleteDepartment(id: string): Promise<void> {
    const staff = await this.directory.staffCountFor(id);

    if (staff > 0) {
      throw AppException.conflict(
        `This department still has ${staff} staff member${staff === 1 ? '' : 's'}. Reassign them first.`,
      );
    }

    if ((await this.directory.softDeleteDepartment(id)) === 0) {
      throw AppException.notFound('Department not found');
    }
  }

  /* ── Rooms ─────────────────────────────────────────────────── */

  async listRooms(hospitalId: string | null) {
    return (await this.directory.listRooms(hospitalId)).map(toRoomView);
  }

  async createRoom(body: RoomBody, hospitalId: string | null) {
    await this.requireDepartment(body.departmentId);

    return toRoomView(
      await this.directory.createRoom(
        {
          name: body.name,
          kind: ROOM_KIND_FROM_WIRE[body.kind]!,
          status: ROOM_STATUS_FROM_WIRE[body.status]!,
          capacity: body.capacity,
          ...(body.note === undefined ? {} : { note: body.note }),
          departmentId: body.departmentId,
        },
        hospitalId,
      ),
    );
  }

  async updateRoom(id: string, body: RoomPatchBody, hospitalId: string | null) {
    if (body.departmentId !== undefined) await this.requireDepartment(body.departmentId);

    const row = await this.directory.updateRoom(
      id,
      {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.kind === undefined ? {} : { kind: ROOM_KIND_FROM_WIRE[body.kind]! }),
        ...(body.status === undefined ? {} : { status: ROOM_STATUS_FROM_WIRE[body.status]! }),
        ...(body.capacity === undefined ? {} : { capacity: body.capacity }),
        ...(body.note === undefined ? {} : { note: body.note }),
        ...(body.departmentId === undefined ? {} : { departmentId: body.departmentId }),
      },
      hospitalId,
    );

    if (row === null) throw AppException.notFound('Room not found');

    return toRoomView(row);
  }

  async deleteRoom(id: string, hospitalId: string | null): Promise<void> {
    if ((await this.directory.softDeleteRoom(id, hospitalId)) === 0) {
      throw AppException.notFound('Room not found');
    }
  }

  /* ── Resources ─────────────────────────────────────────────── */

  async listResources(hospitalId: string | null) {
    return (await this.directory.listResources(hospitalId)).map(toResourceView);
  }

  async createResource(body: ResourceBody, hospitalId: string | null) {
    return toResourceView(
      await this.directory.createResource(
        {
          name: body.name,
          category: body.category,
          location: body.location,
          quantity: body.quantity,
          reorderLevel: body.reorderLevel,
          // The column is kept in step so the value is filterable —
          // DB §14.5-6's "index use" exception — while the *response*
          // always carries the computed answer. A drifted column can
          // therefore never mislead a reader.
          status: storedStatus(body.quantity, body.reorderLevel),
        },
        hospitalId,
      ),
    );
  }

  async updateResource(id: string, body: ResourcePatchBody, hospitalId: string | null) {
    const existing = await this.directory.resourceById(id, hospitalId);

    if (existing === null) throw AppException.notFound('Resource not found');

    const quantity = body.quantity ?? existing.quantity;
    const reorderLevel = body.reorderLevel ?? existing.reorderLevel;

    const row = await this.directory.updateResource(
      id,
      {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.category === undefined ? {} : { category: body.category }),
        ...(body.location === undefined ? {} : { location: body.location }),
        quantity,
        reorderLevel,
        status: storedStatus(quantity, reorderLevel),
      },
      hospitalId,
    );

    if (row === null) throw AppException.notFound('Resource not found');

    return toResourceView(row);
  }

  async deleteResource(id: string, hospitalId: string | null): Promise<void> {
    if ((await this.directory.softDeleteResource(id, hospitalId)) === 0) {
      throw AppException.notFound('Resource not found');
    }
  }

  private async requireDepartment(id: string): Promise<void> {
    if ((await this.directory.departmentExists(id)) === 0) {
      throw AppException.validation({ departmentId: ['No such department'] }, 'No such department');
    }
  }
}

function storedStatus(quantity: number, reorderLevel: number) {
  const wire = resourceStatus(quantity, reorderLevel);

  return wire === 'out' ? 'OUT' : wire === 'low' ? 'LOW' : 'IN_STOCK';
}

function toStaffView(row: StaffRow) {
  return {
    id: row.id,
    name: row.name,
    role: STAFF_ROLE_TO_WIRE[row.role],
    title: row.title,
    departmentId: row.departmentId,
    department: row.department.name,
    status: PRESENCE_TO_WIRE[row.status],
    phone: row.phone,
    email: row.email,
    workingHours: row.workingHours,
    permissions: row.permissions,
  };
}

function toDepartmentView(row: DepartmentRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: ACTIVE_STATUS_TO_WIRE[row.status],
    headStaffId: row.headStaffId,
    // Counted on the relation, never read from a column: a stored count
    // is wrong the moment someone is reassigned.
    staffCount: row._count.staff,
  };
}

function toRoomView(row: RoomRow) {
  return {
    id: row.id,
    name: row.name,
    kind: ROOM_KIND_TO_WIRE[row.kind],
    status: ROOM_STATUS_TO_WIRE[row.status],
    capacity: row.capacity,
    note: row.note,
    departmentId: row.departmentId,
  };
}

function toResourceView(row: ResourceRow) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    location: row.location,
    quantity: row.quantity,
    reorderLevel: row.reorderLevel,
    // Computed, always — the stored column is an index aid and is never
    // the answer a client receives.
    status: resourceStatus(row.quantity, row.reorderLevel),
  };
}
