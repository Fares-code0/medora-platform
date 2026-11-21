/**
 * Appointment oversight — mock service and store (ADM-05 · UX §3.5).
 *
 * Stands in for the platform scheduling API. Two things make this more than
 * a list of fixtures:
 *
 * 1. **Every intervention writes history.** A nudge, a reassignment and an
 *    administrative cancellation each append a transition event *and* the
 *    per-party notification receipts the detail drawer reports. The drawer is
 *    reading real state, not a decorative timeline.
 * 2. **Reassignment can fail, and failure changes nothing.** The target's
 *    availability is re-checked against the stored roster at write time, and
 *    a rejection throws *before* the first commit — so the appointment keeps
 *    its doctor and no notification is invented. §3.5 requires notifications
 *    to fire only on confirmed success; the only honest way to have that
 *    property is to make the write atomic.
 *
 * Like the clinic store, mutations resolve to the full patched document so
 * the query layer seeds its cache instead of refetching.
 */

import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import type {
  CancelCategory,
  LinkedComplaint,
  NotificationDelivery,
  OversightAppointment,
  OversightEvent,
  OversightStatus,
  PlatformDoctor,
} from '../oversight.types';

const LATENCY_MS = 280;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A slot `days` from today at a fixed wall-clock time. */
function slotAt(days: number, hour: number, minute: number): string {
  const date = new Date(Date.now() + days * DAY_MS);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

/* ── Doctors ──────────────────────────────────────────────────── */

/**
 * The cross-doctor roster the reassign picker reads. Availability is stored
 * rather than derived so a successful reassignment can consume a slot — the
 * picker has to be able to run out of options.
 */
const doctors: readonly PlatformDoctor[] = [
  {
    id: 'doc-chen',
    name: 'Dr. Amelia Chen',
    specialty: 'General Medicine',
    department: 'General Medicine',
    availability: 'available',
    openSlotsToday: 4,
    loadPercent: 72,
    note: null,
  },
  {
    id: 'doc-ibrahim',
    name: 'Dr. Salma Ibrahim',
    specialty: 'General Medicine',
    department: 'General Medicine',
    availability: 'available',
    openSlotsToday: 3,
    loadPercent: 58,
    note: null,
  },
  {
    id: 'doc-khalil',
    name: 'Dr. Omar Khalil',
    specialty: 'Cardiology',
    department: 'Cardiology',
    availability: 'available',
    openSlotsToday: 2,
    loadPercent: 81,
    note: null,
  },
  {
    id: 'doc-nabil',
    name: 'Dr. Youssef Nabil',
    specialty: 'Cardiology',
    department: 'Cardiology',
    availability: 'limited',
    openSlotsToday: 1,
    loadPercent: 94,
    note: 'Theatre list until 15:00 — one late slot free.',
  },
  {
    id: 'doc-hassan',
    name: 'Dr. Amira Hassan',
    specialty: 'Endocrinology',
    department: 'Endocrinology',
    availability: 'available',
    openSlotsToday: 5,
    loadPercent: 46,
    note: null,
  },
  {
    id: 'doc-said',
    name: 'Dr. Hana Said',
    specialty: 'Endocrinology',
    department: 'Endocrinology',
    availability: 'unavailable',
    openSlotsToday: 0,
    loadPercent: 0,
    note: 'On leave until Monday.',
  },
];

function doctorById(id: string, roster: readonly PlatformDoctor[]): PlatformDoctor | undefined {
  return roster.find((doctor) => doctor.id === id);
}

/* ── Appointments ─────────────────────────────────────────────── */

/**
 * The seed is written as a compact table and expanded below, so the shape of
 * the dataset (what is stuck, what has a complaint, what fell over last
 * week) is readable at a glance instead of buried in 24 object literals.
 */
interface AppointmentSeed {
  readonly ref: string;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly durationMin: number;
  readonly visitType: string;
  readonly doctorId: string;
  readonly patient: number;
  readonly status: OversightStatus;
  /** Age of the current status, in hours. */
  readonly stateAge: number;
  readonly reschedules: number;
  readonly complaint?: LinkedComplaint;
  readonly nudgedHoursAgo?: number;
}

const COMPLAINT_LATE: LinkedComplaint = {
  id: 'cmp-118',
  category: 'Waiting time',
  summary: 'Third time this booking has moved; patient asked for a different doctor.',
  openedAt: hoursAgo(30),
  status: 'under-review',
};

const COMPLAINT_CANCEL: LinkedComplaint = {
  id: 'cmp-121',
  category: 'Cancellation handling',
  summary: 'Cancelled with under two hours notice and no alternative offered.',
  openedAt: hoursAgo(120),
  status: 'open',
};

const SEEDS: readonly AppointmentSeed[] = [
  /* ── Awaiting a doctor — the intervention candidates ───────── */
  { ref: 'APT-2401', day: 1, hour: 9, minute: 0, durationMin: 30, visitType: 'Consultation', doctorId: 'doc-khalil', patient: 0, status: 'pending', stateAge: 52, reschedules: 0 },
  { ref: 'APT-2402', day: 2, hour: 10, minute: 30, durationMin: 20, visitType: 'Follow-up', doctorId: 'doc-chen', patient: 1, status: 'pending', stateAge: 30, reschedules: 1 },
  { ref: 'APT-2403', day: 0, hour: 16, minute: 0, durationMin: 30, visitType: 'Medication review', doctorId: 'doc-hassan', patient: 2, status: 'pending', stateAge: 3, reschedules: 0 },
  { ref: 'APT-2414', day: 5, hour: 11, minute: 0, durationMin: 45, visitType: 'Consultation', doctorId: 'doc-nabil', patient: 3, status: 'pending', stateAge: 74, reschedules: 0, nudgedHoursAgo: 0.5 },

  /* ── Live bookings ─────────────────────────────────────────── */
  { ref: 'APT-2404', day: 0, hour: 9, minute: 0, durationMin: 30, visitType: 'Annual check-up', doctorId: 'doc-chen', patient: 3, status: 'confirmed', stateAge: 20, reschedules: 0 },
  { ref: 'APT-2405', day: 0, hour: 11, minute: 0, durationMin: 30, visitType: 'Follow-up', doctorId: 'doc-ibrahim', patient: 4, status: 'scheduled', stateAge: 40, reschedules: 3 },
  { ref: 'APT-2406', day: 3, hour: 14, minute: 0, durationMin: 45, visitType: 'Lab review', doctorId: 'doc-khalil', patient: 0, status: 'rescheduled', stateAge: 8, reschedules: 4, complaint: COMPLAINT_LATE },
  { ref: 'APT-2417', day: 0, hour: 13, minute: 0, durationMin: 20, visitType: 'Follow-up', doctorId: 'doc-hassan', patient: 1, status: 'confirmed', stateAge: 26, reschedules: 0 },
  { ref: 'APT-2412', day: 1, hour: 15, minute: 0, durationMin: 30, visitType: 'Consultation', doctorId: 'doc-ibrahim', patient: 2, status: 'confirmed', stateAge: 12, reschedules: 0 },
  { ref: 'APT-2413', day: 4, hour: 9, minute: 0, durationMin: 30, visitType: 'Procedure', doctorId: 'doc-chen', patient: 4, status: 'scheduled', stateAge: 6, reschedules: 0 },
  { ref: 'APT-2419', day: 2, hour: 12, minute: 0, durationMin: 20, visitType: 'Follow-up', doctorId: 'doc-nabil', patient: 0, status: 'confirmed', stateAge: 18, reschedules: 1 },
  { ref: 'APT-2420', day: 6, hour: 10, minute: 0, durationMin: 30, visitType: 'Annual check-up', doctorId: 'doc-hassan', patient: 2, status: 'scheduled', stateAge: 4, reschedules: 0 },

  /* ── Closed out — what the 7-day rates are computed from ───── */
  { ref: 'APT-2407', day: -1, hour: 10, minute: 0, durationMin: 30, visitType: 'Consultation', doctorId: 'doc-chen', patient: 0, status: 'completed', stateAge: 25, reschedules: 0 },
  { ref: 'APT-2416', day: -1, hour: 14, minute: 0, durationMin: 20, visitType: 'Follow-up', doctorId: 'doc-khalil', patient: 1, status: 'completed', stateAge: 22, reschedules: 0 },
  { ref: 'APT-2408', day: -2, hour: 15, minute: 0, durationMin: 30, visitType: 'Lab review', doctorId: 'doc-ibrahim', patient: 2, status: 'completed', stateAge: 46, reschedules: 0 },
  { ref: 'APT-2421', day: -2, hour: 9, minute: 30, durationMin: 30, visitType: 'Consultation', doctorId: 'doc-hassan', patient: 3, status: 'completed', stateAge: 52, reschedules: 0 },
  { ref: 'APT-2409', day: -3, hour: 9, minute: 30, durationMin: 30, visitType: 'Consultation', doctorId: 'doc-nabil', patient: 4, status: 'cancelled', stateAge: 70, reschedules: 1 },
  { ref: 'APT-2422', day: -3, hour: 16, minute: 0, durationMin: 20, visitType: 'Medication review', doctorId: 'doc-chen', patient: 0, status: 'completed', stateAge: 68, reschedules: 0 },
  { ref: 'APT-2410', day: -4, hour: 13, minute: 0, durationMin: 30, visitType: 'Follow-up', doctorId: 'doc-khalil', patient: 1, status: 'no-show', stateAge: 92, reschedules: 0 },
  { ref: 'APT-2423', day: -4, hour: 11, minute: 0, durationMin: 30, visitType: 'Procedure', doctorId: 'doc-ibrahim', patient: 2, status: 'completed', stateAge: 94, reschedules: 0 },
  { ref: 'APT-2411', day: -5, hour: 8, minute: 0, durationMin: 30, visitType: 'Annual check-up', doctorId: 'doc-hassan', patient: 3, status: 'completed', stateAge: 118, reschedules: 0 },
  { ref: 'APT-2424', day: -5, hour: 17, minute: 0, durationMin: 20, visitType: 'Follow-up', doctorId: 'doc-chen', patient: 4, status: 'completed', stateAge: 110, reschedules: 0 },
  { ref: 'APT-2415', day: -6, hour: 16, minute: 0, durationMin: 30, visitType: 'Consultation', doctorId: 'doc-nabil', patient: 0, status: 'cancelled', stateAge: 140, reschedules: 2, complaint: COMPLAINT_CANCEL },
  { ref: 'APT-2418', day: -6, hour: 10, minute: 0, durationMin: 30, visitType: 'Lab review', doctorId: 'doc-ibrahim', patient: 1, status: 'no-show', stateAge: 142, reschedules: 0 },
];

/** Terminal statuses whose closing event is written by the seed expander. */
const CLOSING_EVENT: Partial<Record<OversightStatus, OversightEvent['kind']>> = {
  completed: 'completed',
  cancelled: 'cancelled',
  'no-show': 'no-show',
  confirmed: 'confirmed',
  rescheduled: 'rescheduled',
};

function seedPatient(index: number) {
  const patient = MOCK_PATIENTS[index % MOCK_PATIENTS.length];
  if (patient === undefined) throw new Error('The shared patient roster is empty.');
  return patient;
}

/** Expands one seed row into a full record, history and receipts included. */
function expand(seed: AppointmentSeed): OversightAppointment {
  const patient = seedPatient(seed.patient);
  const doctor = doctorById(seed.doctorId, doctors);
  if (doctor === undefined) throw new Error(`Unknown seed doctor: ${seed.doctorId}`);

  const startsAt = slotAt(seed.day, seed.hour, seed.minute);
  const stateSince = hoursAgo(seed.stateAge);
  const requestedAt = hoursAgo(seed.stateAge + 24 * (seed.reschedules + 1));

  const events: OversightEvent[] = [
    {
      id: `${seed.ref}-e1`,
      kind: 'requested',
      at: requestedAt,
      actor: 'Patient',
      actorRole: 'patient',
      detail: `${seed.visitType} requested with ${doctor.name}.`,
    },
  ];

  for (let i = 0; i < seed.reschedules; i += 1) {
    events.push({
      id: `${seed.ref}-r${String(i + 1)}`,
      kind: 'rescheduled',
      at: hoursAgo(seed.stateAge + 24 * (seed.reschedules - i)),
      actor: i % 2 === 0 ? doctor.name : 'Patient',
      actorRole: i % 2 === 0 ? 'doctor' : 'patient',
      detail: 'Moved to a later slot.',
    });
  }

  const closing = CLOSING_EVENT[seed.status];
  if (closing !== undefined) {
    events.push({
      id: `${seed.ref}-e2`,
      kind: closing,
      at: stateSince,
      actor: seed.status === 'no-show' ? 'Scheduling service' : doctor.name,
      actorRole: seed.status === 'no-show' ? 'system' : 'doctor',
      detail:
        seed.status === 'no-show'
          ? 'Patient did not attend; the slot was closed automatically.'
          : `Marked ${seed.status} by the attending doctor.`,
    });
  }

  const notifications: NotificationDelivery[] = [
    {
      id: `${seed.ref}-n1`,
      party: 'patient',
      recipientLabel: `Patient · ${seed.ref}`,
      channel: 'email',
      status: 'delivered',
      at: requestedAt,
      subject: 'Your appointment request was received',
    },
    {
      id: `${seed.ref}-n2`,
      party: 'doctor',
      recipientLabel: doctor.name,
      channel: 'in-app',
      status: seed.status === 'pending' ? 'pending' : 'delivered',
      at: requestedAt,
      subject: 'New appointment request awaiting your response',
    },
  ];

  if (seed.nudgedHoursAgo !== undefined) {
    const at = hoursAgo(seed.nudgedHoursAgo);
    events.push({
      id: `${seed.ref}-nudge0`,
      kind: 'nudged',
      at,
      actor: 'Scheduling service',
      actorRole: 'system',
      detail: 'Automatic reminder sent after 72 hours pending.',
    });
    notifications.push({
      id: `${seed.ref}-n3`,
      party: 'doctor',
      recipientLabel: doctor.name,
      channel: 'push',
      status: 'delivered',
      at,
      subject: 'Reminder: appointment request still awaiting a response',
    });
  }

  events.sort((a, b) => b.at.localeCompare(a.at));

  return {
    id: seed.ref.toLowerCase(),
    reference: seed.ref,
    startsAt,
    durationMin: seed.durationMin,
    visitType: seed.visitType,
    department: doctor.department,
    specialty: doctor.specialty,
    doctorId: doctor.id,
    doctorName: doctor.name,
    patientId: patient.id,
    patientName: patient.name,
    patientMrn: patient.mrn,
    status: seed.status,
    stateSince,
    rescheduleCount: seed.reschedules,
    complaint: seed.complaint ?? null,
    lastNudgedAt: seed.nudgedHoursAgo === undefined ? null : hoursAgo(seed.nudgedHoursAgo),
    events,
    notifications,
  };
}

/* ── Store ────────────────────────────────────────────────────── */

const STORAGE_KEY = 'medora.admin.appointments.v1';

export interface OversightDocument {
  readonly appointments: readonly OversightAppointment[];
  readonly doctors: readonly PlatformDoctor[];
}

export const DEFAULT_OVERSIGHT: OversightDocument = {
  appointments: SEEDS.map(expand),
  doctors,
};

function load(): OversightDocument {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_OVERSIGHT;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_OVERSIGHT;
    return { ...DEFAULT_OVERSIGHT, ...(parsed as Partial<OversightDocument>) };
  } catch {
    return DEFAULT_OVERSIGHT;
  }
}

function persist(document: OversightDocument): OversightDocument {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  } catch {
    // Storage unavailable — interventions stay session-local.
  }
  return document;
}

/**
 * The one failure type this service raises. Carrying a message the UI can
 * show verbatim keeps the "failed reassign rolls back with an error toast"
 * path honest: the toast says what the service actually refused.
 */
export class OversightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OversightError';
  }
}

function requireAppointment(
  document: OversightDocument,
  id: string,
): OversightAppointment {
  const appointment = document.appointments.find((entry) => entry.id === id);
  if (appointment === undefined) {
    throw new OversightError('That appointment no longer exists. Refresh and try again.');
  }
  return appointment;
}

function isClosed(status: OversightStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'no-show';
}

let sequence = 0;

/** Unique-per-session id for an event or receipt written right now. */
function writeId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(Date.now())}-${String(sequence)}`;
}

function patch(
  document: OversightDocument,
  id: string,
  changes: (appointment: OversightAppointment) => OversightAppointment,
): OversightDocument {
  return {
    ...document,
    appointments: document.appointments.map((entry) => (entry.id === id ? changes(entry) : entry)),
  };
}

export interface NudgeInput {
  readonly ids: readonly string[];
  readonly actor: string;
  readonly message: string;
}

export interface ReassignInput {
  readonly id: string;
  readonly toDoctorId: string;
  readonly actor: string;
  readonly reason: string;
}

export interface CancelInput {
  readonly id: string;
  readonly category: CancelCategory;
  readonly actor: string;
  readonly reason: string;
}

export const oversightApi = {
  list: (): Promise<OversightDocument> => delay(load()),

  /**
   * Nudges one or more doctors sitting on Pending requests. Bulk is allowed
   * here and nowhere else (§3.5: destructive bulk actions are deliberately
   * unsupported) — the worst a mistaken bulk nudge does is send a reminder.
   *
   * Ineligible ids are skipped rather than failing the batch; a nudge is not
   * a transaction, and the caller filters with `canNudge` before offering it.
   */
  nudge: async ({ ids, actor, message }: NudgeInput): Promise<OversightDocument> => {
    let document = load();
    const at = new Date().toISOString();
    let sent = 0;

    for (const id of ids) {
      const appointment = document.appointments.find((entry) => entry.id === id);
      if (appointment === undefined || appointment.status !== 'pending') continue;
      sent += 1;
      document = patch(document, id, (entry) => ({
        ...entry,
        lastNudgedAt: at,
        events: [
          {
            id: writeId('ev'),
            kind: 'nudged',
            at,
            actor,
            actorRole: 'administrator',
            detail: message,
          },
          ...entry.events,
        ],
        notifications: [
          {
            id: writeId('nt'),
            party: 'doctor',
            recipientLabel: entry.doctorName,
            channel: 'push',
            status: 'delivered',
            at,
            subject: `Reminder: ${entry.reference} is awaiting your response`,
          },
          ...entry.notifications,
        ],
      }));
    }

    if (sent === 0) {
      throw new OversightError('None of the selected appointments can be nudged right now.');
    }
    return delay(persist(document));
  },

  /**
   * Moves an appointment to another doctor. Every precondition is checked
   * against freshly loaded state and throws before anything is written, so a
   * refusal leaves the appointment, the roster and the notification log
   * exactly as they were.
   */
  reassign: async ({ id, toDoctorId, actor, reason }: ReassignInput): Promise<OversightDocument> => {
    const document = load();
    const appointment = requireAppointment(document, id);

    if (isClosed(appointment.status)) {
      throw new OversightError(
        `${appointment.reference} is already ${appointment.status} and cannot be reassigned.`,
      );
    }
    const target = doctorById(toDoctorId, document.doctors);
    if (target === undefined) {
      throw new OversightError('That doctor is no longer on the platform roster.');
    }
    if (target.id === appointment.doctorId) {
      throw new OversightError(`${appointment.reference} is already with ${target.name}.`);
    }
    if (target.specialty !== appointment.specialty) {
      throw new OversightError(
        `${target.name} practises ${target.specialty}; this is a ${appointment.specialty} appointment.`,
      );
    }
    if (target.availability === 'unavailable' || (target.openSlotsToday ?? 0) <= 0) {
      throw new OversightError(
        `${target.name} has no capacity left today. Nothing was changed and no one was notified.`,
      );
    }

    const at = new Date().toISOString();
    const previousDoctor = appointment.doctorName;

    const withAppointment = patch(document, id, (entry) => ({
      ...entry,
      doctorId: target.id,
      doctorName: target.name,
      department: target.department,
      // Reassignment restarts the clock: the new doctor has not been sitting
      // on this request, and the age column must not say otherwise.
      stateSince: at,
      events: [
        {
          id: writeId('ev'),
          kind: 'reassigned' as const,
          at,
          actor,
          actorRole: 'administrator' as const,
          detail: `Moved from ${previousDoctor} to ${target.name}. Reason: ${reason.trim()}`,
        },
        ...entry.events,
      ],
      notifications: [
        {
          id: writeId('nt'),
          party: 'patient' as const,
          recipientLabel: `Patient · ${entry.reference}`,
          channel: 'sms' as const,
          status: 'delivered' as const,
          at,
          subject: `Your appointment is now with ${target.name}`,
        },
        {
          id: writeId('nt'),
          party: 'receiving-doctor' as const,
          recipientLabel: target.name,
          channel: 'in-app' as const,
          status: 'delivered' as const,
          at,
          subject: `${entry.reference} has been assigned to you`,
        },
        {
          id: writeId('nt'),
          party: 'doctor' as const,
          recipientLabel: previousDoctor,
          channel: 'in-app' as const,
          status: 'delivered' as const,
          at,
          subject: `${entry.reference} was reassigned away from your list`,
        },
        ...entry.notifications,
      ],
    }));

    return delay(
      persist({
        ...withAppointment,
        doctors: withAppointment.doctors.map((doctor) =>
          doctor.id === target.id
            ? { ...doctor, openSlotsToday: Math.max(0, (doctor.openSlotsToday ?? 0) - 1) }
            : doctor,
        ),
      }),
    );
  },

  /**
   * Cancels on the clinic's behalf. The patient is notified with the apology
   * template, and the category plus reason travel with the event so the
   * cancellation is attributable months later.
   */
  cancelAdministratively: async ({
    id,
    category,
    actor,
    reason,
  }: CancelInput): Promise<OversightDocument> => {
    const document = load();
    const appointment = requireAppointment(document, id);
    if (isClosed(appointment.status)) {
      throw new OversightError(`${appointment.reference} is already ${appointment.status}.`);
    }

    const at = new Date().toISOString();
    return delay(
      persist(
        patch(document, id, (entry) => ({
          ...entry,
          status: 'cancelled' as const,
          stateSince: at,
          events: [
            {
              id: writeId('ev'),
              kind: 'cancelled-administratively' as const,
              at,
              actor,
              actorRole: 'administrator' as const,
              detail: `Category: ${category}. Reason: ${reason.trim()}`,
            },
            ...entry.events,
          ],
          notifications: [
            {
              id: writeId('nt'),
              party: 'patient' as const,
              recipientLabel: `Patient · ${entry.reference}`,
              channel: 'sms' as const,
              status: 'delivered' as const,
              at,
              subject: 'We are sorry — your appointment has been cancelled by the clinic',
            },
            {
              id: writeId('nt'),
              party: 'doctor' as const,
              recipientLabel: entry.doctorName,
              channel: 'in-app' as const,
              status: 'delivered' as const,
              at,
              subject: `${entry.reference} was cancelled administratively`,
            },
            ...entry.notifications,
          ],
        })),
      ),
    );
  },

  /** Restores the seeded baseline. */
  reset: (): Promise<OversightDocument> => delay(persist(DEFAULT_OVERSIGHT)),
} as const;
