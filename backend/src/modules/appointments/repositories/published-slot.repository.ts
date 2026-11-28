/**
 * The doctor's side of the published-slot inventory (SLT-01; DR-10, OD-08).
 *
 * Publishing, listing and withdrawing (`ownSlotsOverlapping`, `insertSlots`,
 * `listOwn`, `lockOwnSlot`, `withdraw`, `ownSlot`, `liveBookingOf`) run under
 * the request's own tenant context — `hospital`, the doctor's active
 * employment — and every one also names that hospital and doctor in its
 * WHERE clause, so it behaves identically with Row-Level Security on or off.
 * Patients read and book these slots through `PatientBookingRepository`
 * (ADR-049).
 *
 * Soft deletes: a transaction client does not carry the soft-delete
 * extension, so `deletedAt: null` / `deleted_at IS NULL` is spelled out.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';

import { LIVE_STATUSES, type ScheduleTx } from './appointment.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OwnSlotRow {
  readonly id: string;
  readonly startsAt: Date;
  readonly durationMinutes: number;
  readonly createdAt: Date;
  readonly withdrawnAt: Date | null;
  /** The live appointment holding the slot, if any. */
  readonly bookedBy: string | null;
}

@Injectable()
export class PublishedSlotRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── The doctor's own slots ────────────────────────────────────────────

  /**
   * The doctor's live (not withdrawn) slots at `hospitalId` whose
   * interval, widened by `bufferMin` on both sides, touches `[from, to)`.
   */
  async ownSlotsOverlapping(
    input: {
      readonly doctorId: string;
      readonly hospitalId: string;
      readonly from: Date;
      readonly to: Date;
      readonly bufferMin: number;
    },
    tx: ScheduleTx,
  ): Promise<readonly { id: string; startsAt: Date }[]> {
    const buffer = Math.max(0, input.bufferMin);

    return tx.$queryRaw<{ id: string; startsAt: Date }[]>`
      SELECT s.id::text AS id, s.starts_at AS "startsAt"
        FROM published_slots s
        JOIN doctor_employments e ON e.id = s.doctor_employment_id AND e.hospital_id = s.hospital_id
       WHERE e.doctor_id = ${input.doctorId}::uuid
         AND s.hospital_id = ${input.hospitalId}::uuid
         AND s.withdrawn_at IS NULL
         AND s.starts_at - make_interval(mins => ${buffer}::int) < ${input.to}
         AND s.starts_at + make_interval(mins => s.duration_minutes + ${buffer}::int) > ${input.from}
       ORDER BY s.starts_at`;
  }

  async insertSlots(
    input: {
      readonly hospitalId: string;
      readonly doctorEmploymentId: string;
      readonly slots: readonly { startsAt: Date; durationMin: number }[];
    },
    tx: ScheduleTx,
  ): Promise<readonly OwnSlotRow[]> {
    const created: OwnSlotRow[] = [];
    for (const slot of input.slots) {
      const row = await tx.publishedSlot.create({
        data: {
          hospitalId: input.hospitalId,
          doctorEmploymentId: input.doctorEmploymentId,
          startsAt: slot.startsAt,
          durationMinutes: slot.durationMin,
        },
        select: {
          id: true,
          startsAt: true,
          durationMinutes: true,
          createdAt: true,
          withdrawnAt: true,
        },
      });
      created.push({ ...row, bookedBy: null });
    }

    return created;
  }

  /** The doctor's own slots at `hospitalId`, newest window first by start. */
  async listOwn(criteria: {
    readonly doctorId: string;
    readonly hospitalId: string;
    readonly from: Date | undefined;
    readonly to: Date | undefined;
    readonly page: number;
    readonly pageSize: number;
  }): Promise<{ rows: readonly OwnSlotRow[]; totalItems: number }> {
    const where = {
      hospitalId: criteria.hospitalId,
      employment: { is: { doctorId: criteria.doctorId } },
      ...(criteria.from === undefined && criteria.to === undefined
        ? {}
        : {
            startsAt: {
              ...(criteria.from === undefined ? {} : { gte: criteria.from }),
              ...(criteria.to === undefined ? {} : { lt: criteria.to }),
            },
          }),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.publishedSlot.findMany({
        where,
        select: {
          id: true,
          startsAt: true,
          durationMinutes: true,
          createdAt: true,
          withdrawnAt: true,
          appointments: {
            where: { deletedAt: null, status: { in: [...LIVE_STATUSES] } },
            select: { publicId: true },
            take: 1,
          },
        },
        orderBy: { startsAt: 'asc' },
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.publishedSlot.count({ where }),
    ]);

    return {
      rows: rows.map(({ appointments, ...row }) => ({
        ...row,
        bookedBy: appointments[0]?.publicId ?? null,
      })),
      totalItems,
    };
  }

  /**
   * Locks one of the doctor's own slots at `hospitalId` (`FOR UPDATE`), or
   * returns `null` when it is not theirs or does not exist — the caller
   * answers both with the same 404.
   */
  async lockOwnSlot(
    input: { readonly slotId: string; readonly doctorId: string; readonly hospitalId: string },
    tx: ScheduleTx,
  ): Promise<{ id: string; withdrawnAt: Date | null } | null> {
    if (!UUID.test(input.slotId)) return null;

    const rows = await tx.$queryRaw<{ id: string; withdrawnAt: Date | null }[]>`
      SELECT s.id::text AS id, s.withdrawn_at AS "withdrawnAt"
        FROM published_slots s
        JOIN doctor_employments e ON e.id = s.doctor_employment_id AND e.hospital_id = s.hospital_id
       WHERE s.id = ${input.slotId}::uuid
         AND s.hospital_id = ${input.hospitalId}::uuid
         AND e.doctor_id = ${input.doctorId}::uuid
         FOR UPDATE OF s`;

    return rows[0] ?? null;
  }

  async withdraw(slotId: string, now: Date, tx: ScheduleTx): Promise<OwnSlotRow> {
    const row = await tx.publishedSlot.update({
      where: { id: slotId },
      data: { withdrawnAt: now },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        createdAt: true,
        withdrawnAt: true,
      },
    });

    return { ...row, bookedBy: null };
  }

  /** One slot already locked by `lockOwnSlot`, as the doctor's view reads it. */
  async ownSlot(slotId: string, tx: ScheduleTx): Promise<OwnSlotRow> {
    const row = await tx.publishedSlot.findUniqueOrThrow({
      where: { id: slotId },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        createdAt: true,
        withdrawnAt: true,
      },
    });

    return { ...row, bookedBy: null };
  }

  /** The live appointment holding a slot, or `null`. */
  async liveBookingOf(slotId: string, tx: ScheduleTx): Promise<string | null> {
    const row = await tx.appointment.findFirst({
      where: { publishedSlotId: slotId, deletedAt: null, status: { in: [...LIVE_STATUSES] } },
      select: { publicId: true },
    });

    return row?.publicId ?? null;
  }
}

