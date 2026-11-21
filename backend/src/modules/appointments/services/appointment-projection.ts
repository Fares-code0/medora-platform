/**
 * Row → wire, for the doctor and administrator surfaces (API §5).
 *
 * Kept out of the service so the mapping is testable on its own and so
 * there is exactly one place where a column becomes a field. Two
 * projections of the same table that drifted apart is how the oversight
 * list and the book end up disagreeing about an appointment's status.
 *
 * The one rule this file exists to keep: **nothing enters a payload that
 * the caller's surface is not entitled to.** `toView` embeds the
 * patient's name, MRN and phone because API §5.1 fixes those six fields
 * for a doctor's own book; `toOversightView` embeds the handle alone,
 * because an administrator's projection is masked until the reveal of
 * M7.3 audits it. They are separate functions rather than one with a
 * flag for that reason — a flag is one forgotten argument away from
 * serving the wrong one.
 */

import {
  appointmentActionToWire,
  appointmentPriorityToWire,
  appointmentStatusToWire,
  genderToWire,
} from '../dto/appointment-enums';
import {
  ageOn,
  hoursSince,
  type AppointmentDetailView,
  type AppointmentEventView,
  type AppointmentProposalView,
  type AppointmentView,
  type OversightAppointmentView,
} from '../dto/appointment.dto';
import type {
  BookRow,
  DetailRow,
  EventRow,
  ProposalRow,
} from '../repositories/appointment.repository';

import { availableActions } from './appointment-status.machine';

export function toView(row: BookRow, timeZone: string, now: Date): AppointmentView {
  return {
    id: row.publicId,
    patient: {
      id: row.patient.publicId,
      name: row.patient.fullName,
      mrn: row.patient.mrn,
      phone: row.patient.phone,
      age: ageOn(row.patient.dateOfBirth, now),
      gender: genderToWire(row.patient.gender),
    },
    dateTime: row.startsAt.toISOString(),
    durationMin: row.durationMin,
    visitType: row.visitType.name,
    department: row.department?.name ?? null,
    doctorId: row.doctor.id,
    doctor: row.doctor.fullName,
    status: appointmentStatusToWire(row.status),
    priority: appointmentPriorityToWire(row.priority),
    isNewPatient: row.isNewPatient,
    isFollowUp: row.isFollowUp,
    reason: row.reason,
    notes: row.notes,
    availableActions: availableActions(row.status, row.startsAt, timeZone, now),
  };
}

export function toDetailView(
  row: DetailRow,
  timeZone: string,
  now: Date,
): AppointmentDetailView {
  return {
    ...toView(row, timeZone, now),
    cancelledReason: row.cancelledReason,
    createdAt: row.createdAt.toISOString(),
    events: row.events.map(toEventView),
    proposals: row.proposals.map(toProposalView),
  };
}

function toEventView(row: EventRow): AppointmentEventView {
  return {
    id: row.id,
    action: appointmentActionToWire(row.action),
    fromStatus: row.fromStatus === null ? null : appointmentStatusToWire(row.fromStatus),
    toStatus: row.toStatus === null ? null : appointmentStatusToWire(row.toStatus),
    occurredAt: row.occurredAt.toISOString(),
    // `System` rather than an empty string: a history line with a blank
    // actor reads as missing data, and an actor-less row is a scheduled
    // job, which is a fact worth stating.
    actor: row.actorName ?? 'System',
    reason: row.reason,
    detail: isRecord(row.detail) ? row.detail : null,
  };
}

function toProposalView(row: ProposalRow): AppointmentProposalView {
  return {
    id: row.id,
    status: row.status,
    // Nulls dropped rather than serialized: DB §S3 stores three columns
    // because the maximum is three, and a client rendering the choices
    // should not have to filter the absent ones out.
    slots: [row.slot1, row.slot2, row.slot3]
      .filter((slot): slot is Date => slot !== null)
      .map((slot) => slot.toISOString()),
    chosenSlot: row.chosenSlot,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The flags API §5.10's toolbar filters on. */
export interface OversightSignals {
  readonly stateSince: Date;
  readonly reschedules: number;
  readonly lastNudgedAt: Date | null;
}

/** A `pending` row older than this is "stuck" (API §5.11's admin strip). */
export const STUCK_PENDING_HOURS = 24;

/** Three or more moves is "repeated" — the frontend's own threshold. */
export const REPEATED_RESCHEDULE_COUNT = 3;

export function toOversightView(
  row: BookRow,
  signals: OversightSignals,
  now: Date,
): OversightAppointmentView {
  const ageInStateHours = hoursSince(signals.stateSince, now);
  const flags: string[] = [];

  if (row.status === 'PENDING' && ageInStateHours >= STUCK_PENDING_HOURS) {
    flags.push('stuck-pending');
  }
  if (signals.reschedules >= REPEATED_RESCHEDULE_COUNT) flags.push('repeated-reschedules');

  return {
    id: row.publicId,
    reference: row.publicId,
    startsAt: row.startsAt.toISOString(),
    durationMin: row.durationMin,
    visitType: row.visitType.name,
    department: row.department?.name ?? null,
    specialty: row.doctor.specialty,
    doctorId: row.doctor.id,
    doctorName: row.doctor.fullName,
    // The handle and nothing else — see the header, and API §0.4.
    patientId: row.patient.publicId,
    status: appointmentStatusToWire(row.status),
    stateSince: signals.stateSince.toISOString(),
    ageInStateHours,
    rescheduleCount: signals.reschedules,
    lastNudgedAt: signals.lastNudgedAt?.toISOString() ?? null,
    flags,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
