/**
 * Turning an event's identifiers into the accounts that receive it
 * (RM M19.2).
 *
 * ## Public ids in, user ids out
 *
 * Outbox payloads carry the identifiers a *reader* would recognise —
 * `patients.public_id`, `lab_orders.public_id` — because a payload is a
 * message between modules and MG §11.6 keeps internal keys and clinical
 * content out of it. `notifications.recipient_id` is a `users.id`, so
 * every audience has to be resolved against the database here.
 *
 * ## Resolving to nobody is an ordinary outcome
 *
 * A patient record need not have an account: ADR-030 *links* the two
 * where a link exists, it does not require one. So a patient audience
 * that resolves to no user produces no notification, not an error — the
 * appointment was still confirmed and the transition is still correct.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class NotificationRecipientRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `patients.public_id` → the linked account, if the patient has one. */
  async patientUser(publicId: string): Promise<string | null> {
    const row = await this.prisma.db.patient.findUnique({
      where: { publicId },
      select: { userId: true },
    });

    return row?.userId ?? null;
  }

  /** `patients.public_id` → `patients.id`, for the deep link on the row. */
  async patientRowId(publicId: string): Promise<string | null> {
    const row = await this.prisma.db.patient.findUnique({
      where: { publicId },
      select: { id: true },
    });

    return row?.id ?? null;
  }

  /** `doctors.id` → `doctors.user_id`. */
  async doctorUser(doctorId: string): Promise<string | null> {
    if (!UUID.test(doctorId)) return null;

    const row = await this.prisma.db.doctor.findUnique({
      where: { id: doctorId },
      select: { userId: true },
    });

    return row?.userId ?? null;
  }

  /**
   * `lab_orders.public_id` → the ordering doctor's account and the row
   * ids the notification deep-links to.
   *
   * One query rather than three: a critical-result alert needs the
   * orderer, the order and the patient, and fetching them separately
   * would be an N+1 over a batch of claimed events.
   */
  async labOrderTarget(publicId: string): Promise<{
    readonly labOrderId: string;
    readonly patientId: string;
    readonly doctorUserId: string;
  } | null> {
    const row = await this.prisma.db.labOrder.findUnique({
      where: { publicId },
      select: { id: true, patientId: true, orderer: { select: { userId: true } } },
    });

    if (row === null) return null;

    return {
      labOrderId: row.id,
      patientId: row.patientId,
      doctorUserId: row.orderer.userId,
    };
  }

  /** `appointments.public_id` → `appointments.id`, for the deep link. */
  async appointmentRowId(publicId: string): Promise<string | null> {
    const row = await this.prisma.db.appointment.findUnique({
      where: { publicId },
      select: { id: true },
    });

    return row?.id ?? null;
  }

  /**
   * Every active administrator.
   *
   * The role code is **`admin`**, not `administrator` — that is what
   * `prisma/seed/permissions.ts` seeds and what every other lookup in
   * the codebase uses. The longer spelling is the *label* the UI shows,
   * and a query written against it silently returns nobody: the fan-out
   * would then drop every administrator notification without failing.
   *
   * Active only: a suspended or locked account cannot sign in to read
   * the feed, and filling it would leave unread counts nobody can clear.
   */
  async administrators(): Promise<readonly string[]> {
    const rows = await this.prisma.db.user.findMany({
      where: { status: 'ACTIVE', role: { code: 'admin' } },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }
}
