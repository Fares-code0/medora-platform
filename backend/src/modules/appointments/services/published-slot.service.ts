/**
 * Doctor-published slots (DR-10, OD-08 — `API_CONTRACT_CHANGES.md` §6;
 * audit SLT-01, SLT-02).
 *
 * ## The doctor side: the hospital is derived, never sent
 *
 * A slot belongs to the doctor's one active employment at an ACTIVE
 * hospital in clinical standing (`PatientScopeService.clinicalEmployment`,
 * the same standing every clinical route uses). The body carries a time
 * and a duration only; there is no hospital picker (contract §0 rule 2).
 *
 * Publishing refuses — under the doctor's schedule lock (BE-1), so a
 * concurrent booking or publish cannot slip between check and insert —
 * a slot that is not in the future, that overlaps the doctor's time off
 * or a live appointment (ADR-005 §4 rules 3–4, buffer included), or that
 * overlaps one of the doctor's own live published slots. It does **not**
 * require the slot to fall inside the weekly working-hours grid: DR-10
 * makes working hours internal planning data and the published slot the
 * doctor's explicit offer, and no source states that the two must agree.
 *
 * Capacity is always 1 (OD-08): a slot is a single appointment-sized
 * interval; the database's partial unique index on
 * `appointments.published_slot_id` holds it.
 *
 * ## The patient side: inventory, never working hours
 *
 * `bookable` lists only published, unwithdrawn, future, unoccupied slots
 * (DR-10). It projects the slot and its hospital, never the grid
 * (AST-C6). Discovery requires sign-in (DR-09) but not a linked patient
 * record: browsing is not booking.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { PatientScopeService, principalOf } from '../../../shared/authz';
import { runAsSystem } from '../../../shared/database';
import type {
  BookableSlotQuery,
  PublishedSlotListQuery,
  PublishSlotsInput,
} from '../dto/published-slot.schema';
import { AppointmentRepository } from '../repositories/appointment.repository';
import {
  PublishedSlotRepository,
  type OwnSlotRow,
} from '../repositories/published-slot.repository';

import { CLINIC_TIMEZONE, type ClinicTimezoneSource } from './clinic-timezone';
import { mentionsConstraint } from './booking-errors';
import { SlotConflictChecker } from './slot-conflict.checker';

export type PublishedSlotStatus = 'published' | 'booked' | 'withdrawn' | 'past';

export interface PublishedSlotView {
  readonly id: string;
  readonly startsAt: string;
  readonly durationMin: number;
  readonly status: PublishedSlotStatus;
  /** The doctor's own appointment reference when booked; never the patient. */
  readonly appointmentId: string | null;
  readonly createdAt: string;
  readonly withdrawnAt: string | null;
}

export interface PublishedSlotPage {
  readonly items: readonly PublishedSlotView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface BookableSlotView {
  readonly slotId: string;
  readonly startsAt: string;
  readonly durationMin: number;
  readonly timezone: string;
  readonly hospital: { readonly id: string; readonly name: string };
}

export interface BookableSlots {
  /** The server instant the snapshot was taken at — a listing is not a reservation. */
  readonly asOf: string;
  readonly items: readonly BookableSlotView[];
}

@Injectable()
export class PublishedSlotService {
  constructor(
    private readonly slots: PublishedSlotRepository,
    private readonly appointments: AppointmentRepository,
    private readonly conflicts: SlotConflictChecker,
    private readonly scope: PatientScopeService,
    @Inject(CLINIC_TIMEZONE) private readonly timezone: ClinicTimezoneSource,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /** `POST /me/published-slots` — all or nothing. */
  async publish(user: AuthenticatedUser, input: PublishSlotsInput): Promise<PublishedSlotView[]> {
    const employment = await this.requireEmployment(user);
    const now = new Date();

    const fieldErrors: Record<string, string[]> = {};
    input.forEach((slot, index) => {
      if (slot.startsAt.getTime() <= now.getTime()) {
        fieldErrors[input.length === 1 ? 'startsAt' : `${String(index)}.startsAt`] = [
          'A slot must start in the future',
        ];
      }
    });
    if (Object.keys(fieldErrors).length > 0) {
      throw AppException.validation(fieldErrors, 'A slot must start in the future');
    }

    const timeZone = await this.timezone.current();

    const created = await this.conflicts
      .underScheduleLock([employment.doctorId], async (tx) => {
        const scheduling = await this.appointments.schedulingFor(employment.doctorId, tx);
        const bufferMin = scheduling?.bufferMin ?? 0;

        assertNoOverlapWithinBatch(input, bufferMin);

        for (const [index, slot] of input.entries()) {
          const label = input.length === 1 ? '' : `Slot ${String(index + 1)}: `;
          const candidate = { startsAt: slot.startsAt, durationMin: slot.durationMin };

          const conflict = await this.conflicts.findOccupancy({
            doctorId: employment.doctorId,
            bufferMin,
            timeZone,
            candidate,
            tx,
          });
          if (conflict !== null) {
            if (conflict.rule === 'duration') {
              throw AppException.validation({ durationMin: [conflict.detail] }, conflict.detail);
            }
            throw AppException.conflict(`${label}${conflict.detail}`, 'slot_conflict');
          }

          const own = await this.slots.ownSlotsOverlapping(
            {
              doctorId: employment.doctorId,
              hospitalId: employment.hospitalId,
              from: slot.startsAt,
              to: new Date(slot.startsAt.getTime() + slot.durationMin * 60_000),
              bufferMin,
            },
            tx,
          );
          if (own.length > 0) {
            throw AppException.conflict(
              `${label}The slot overlaps one of your published slots`,
              'slot_conflict',
            );
          }
        }

        return this.slots.insertSlots(
          {
            hospitalId: employment.hospitalId,
            doctorEmploymentId: employment.doctorEmploymentId,
            slots: input,
          },
          tx,
        );
      })
      .catch((error: unknown) => {
        // `published_slots_active_employment_trg`: the employment ended
        // between the standing check and the insert.
        if (mentionsConstraint(error, ['published_slots_active_employment_check'])) {
          throw AppException.conflict(
            'The slot cannot be published: you have no active employment at this hospital',
            'conflict',
          );
        }
        throw error;
      });

    for (const row of created) {
      await this.audit.record({
        action: 'published_slot.publish',
        actor: { userId: user.id, role: user.role },
        entityType: 'published_slot',
        entityId: row.id,
        hospitalId: employment.hospitalId,
        metadata: { startsAt: row.startsAt.toISOString(), durationMin: row.durationMinutes },
      });
    }

    return created.map((row) => toView(row, now));
  }

  /** `DELETE /me/published-slots/:id` — withdraw an unbooked slot of one's own. */
  async withdraw(user: AuthenticatedUser, slotId: string): Promise<PublishedSlotView> {
    const employment = await this.requireEmployment(user);
    const now = new Date();

    const { row, changed } = await this.conflicts.underScheduleLock(
      [employment.doctorId],
      async (tx) => {
        const locked = await this.slots.lockOwnSlot(
          { slotId, doctorId: employment.doctorId, hospitalId: employment.hospitalId },
          tx,
        );
        if (locked === null) throw slotNotFound();

        const booking = await this.slots.liveBookingOf(locked.id, tx);
        if (booking !== null) {
          throw AppException.conflict(
            'The slot is booked; cancel or reschedule the appointment instead',
            'slot_booked',
          );
        }

        if (locked.withdrawnAt !== null) {
          // Already withdrawn: DELETE is idempotent, and the answer is the
          // slot as it stands.
          return { row: await this.slots.ownSlot(locked.id, tx), changed: false };
        }

        return { row: await this.slots.withdraw(locked.id, now, tx), changed: true };
      },
    );

    if (changed) {
      await this.audit.record({
        action: 'published_slot.withdraw',
        actor: { userId: user.id, role: user.role },
        entityType: 'published_slot',
        entityId: row.id,
        hospitalId: employment.hospitalId,
        metadata: { startsAt: row.startsAt.toISOString() },
      });
    }

    return toView(row, now);
  }

  /** `GET /me/published-slots` — the doctor's own slots at the active hospital. */
  async listOwn(
    user: AuthenticatedUser,
    query: PublishedSlotListQuery,
  ): Promise<PublishedSlotPage> {
    const employment = await this.scope.clinicalEmployment(principalOf(user));
    // No clinical standing: an empty list, never an unscoped one.
    if (employment === null) {
      return {
        items: [],
        page: query.page,
        pageSize: query.pageSize,
        totalItems: 0,
        totalPages: 0,
      };
    }

    const { rows, totalItems } = await this.slots.listOwn({
      doctorId: employment.doctorId,
      hospitalId: employment.hospitalId,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });

    const now = new Date();

    return {
      items: rows.map((row) => toView(row, now)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /**
   * `GET /patient/doctors/:doctorId/slots` — the bookable inventory.
   *
   * Patients only. An unknown or non-patient-visible doctor is the same
   * 404 `/patient/doctors/:id` gives.
   */
  async bookable(
    user: AuthenticatedUser,
    doctorId: string,
    query: BookableSlotQuery,
  ): Promise<BookableSlots> {
    assertPatient(user);

    const now = new Date();
    const from =
      query.from === undefined || query.from.getTime() < now.getTime() ? now : query.from;

    // `runAsSystem`: published slots, employments and time off are
    // organisational rows (`org_visible`) a patient scope cannot see, the
    // same reason the patient doctor directory reads under system scope.
    // Both queries are keyed by `doctorId` and project slot and hospital
    // fields only — no working hours, no other patient's booking.
    const visible = await runAsSystem(() => this.slots.patientVisibleDoctor(doctorId));
    if (!visible) throw AppException.notFound('Doctor not found');

    const rows = await runAsSystem(() =>
      this.slots.bookableSlots({ doctorId, from, to: query.to }),
    );

    return {
      asOf: now.toISOString(),
      items: rows.map((row) => ({
        slotId: row.id,
        startsAt: row.startsAt.toISOString(),
        durationMin: row.durationMinutes,
        timezone: row.timezone,
        hospital: { id: row.hospitalId, name: row.hospitalName },
      })),
    };
  }

  private async requireEmployment(user: AuthenticatedUser): Promise<{
    doctorId: string;
    doctorEmploymentId: string;
    hospitalId: string;
  }> {
    const employment = await this.scope.clinicalEmployment(principalOf(user));
    if (employment === null) {
      throw AppException.notFound('No active clinical employment for this account');
    }

    return employment;
  }
}

/**
 * Two slots in one request may not overlap each other (buffer included) —
 * checked before the database, which only sees already-published slots.
 */
function assertNoOverlapWithinBatch(input: PublishSlotsInput, bufferMin: number): void {
  const bufferMs = Math.max(0, bufferMin) * 60_000;
  const sorted = [...input].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    const previousEnd = previous.startsAt.getTime() + previous.durationMin * 60_000 + bufferMs;
    if (current.startsAt.getTime() < previousEnd) {
      throw AppException.conflict('Two slots in the request overlap each other', 'slot_conflict');
    }
  }
}

/**
 * The patient routes are for patients. `@Roles()` cannot name `patient`
 * by design (ADR-030 §6), so the check is here, as a 403: a doctor or
 * administrator is authenticated but not the audience.
 */
export function assertPatient(user: AuthenticatedUser): void {
  if (user.role !== 'patient') {
    throw AppException.forbidden('This route is for patient accounts');
  }
}

function slotNotFound(): AppException {
  return AppException.notFound('Slot not found');
}

function toView(row: OwnSlotRow, now: Date): PublishedSlotView {
  const status: PublishedSlotStatus =
    row.withdrawnAt !== null
      ? 'withdrawn'
      : row.bookedBy !== null
        ? 'booked'
        : row.startsAt.getTime() <= now.getTime()
          ? 'past'
          : 'published';

  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    durationMin: row.durationMinutes,
    status,
    appointmentId: row.bookedBy,
    createdAt: row.createdAt.toISOString(),
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
  };
}
