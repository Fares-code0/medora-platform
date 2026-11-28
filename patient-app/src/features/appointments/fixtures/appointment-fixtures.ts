import { FIXTURE_DOCTORS, MEDORA_HOSPITAL } from '@/features/doctors/fixtures/doctor-fixtures';

import type {
  Appointment,
  AppointmentDetail,
  AppointmentPage,
  AppointmentService,
  BookableSlot,
  RescheduleRequest,
  VisitType,
} from '../model/types';

/**
 * Development fixtures for appointments.
 *
 * Two properties are deliberate:
 *
 * 1. **`availableActions` is stored data, not derived.** The fixture
 *    hardcodes the actions per appointment exactly as a server would send
 *    them. It does NOT compute them from `status`, because a fixture that
 *    computed them would let a screen quietly start depending on the
 *    derivation and the rule in `model/types.ts` would rot.
 *
 * 3. **`list` pages, on a list shorter than one page.** It would be
 *    simpler to return everything and set `hasMore: false`, and it would
 *    make the fixture the only build in which paging is untestable. A
 *    fixture that cannot reach page two is a seam whose two sides
 *    disagree about the shape of the answer, which `api/seam.ts` exists
 *    to prevent.
 *
 * 2. **`listSlots` returns a canned list.** It does not implement
 *    availability minus time-off minus booked minus buffer. That
 *    computation is BE-06's, server-side, and a fixture that did it would
 *    be the client-side slot generator audit §6 forbids.
 */

function isoIn(days: number, hour: number, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

const [layla, samir, hana] = FIXTURE_DOCTORS;

/**
 * A real IANA name, and deliberately not the machine's.
 *
 * The fixture's job is to look like the payload, and the payload carries
 * `clinicTimezone` on every appointment. A zone that happens to match
 * whatever CI is set to would make the one behaviour worth testing —
 * that a clinic in a different zone renders the clinic's time — invisible
 * in exactly the environment that runs the tests.
 */
export const FIXTURE_CLINIC_TIMEZONE = 'Asia/Amman';

function summaryOf(doctor: (typeof FIXTURE_DOCTORS)[number]) {
  return {
    id: doctor.id,
    fullName: doctor.fullName,
    title: doctor.title,
    specialty: doctor.specialty,
    photoUrl: doctor.photoUrl,
  };
}

const UPCOMING: readonly Appointment[] = [
  {
    id: 'APT-2001',
    startsAt: isoIn(3, 9, 30),
    durationMin: 30,
    status: 'confirmed',
    priority: 'normal',
    doctor: summaryOf(layla!),
    departmentName: 'Cardiology',
    visitType: 'Follow-up',
    reason: 'Review of blood pressure medication',
    notes: null,
    cancelledReason: null,
    clinicTimezone: FIXTURE_CLINIC_TIMEZONE,
    hospital: MEDORA_HOSPITAL,
    availableActions: ['cancel', 'reschedule'],
  },
  {
    id: 'APT-2002',
    startsAt: isoIn(9, 14, 0),
    durationMin: 20,
    status: 'pending',
    priority: 'normal',
    doctor: summaryOf(samir!),
    departmentName: 'Dermatology',
    visitType: 'New patient',
    reason: 'Rash on the forearm that has not settled',
    notes: null,
    cancelledReason: null,
    clinicTimezone: FIXTURE_CLINIC_TIMEZONE,
    hospital: MEDORA_HOSPITAL,
    availableActions: ['cancel'],
  },
  {
    id: 'APT-2003',
    startsAt: isoIn(14, 11, 0),
    durationMin: 30,
    status: 'awaiting-patient',
    priority: 'normal',
    doctor: summaryOf(hana!),
    departmentName: 'Family Medicine',
    visitType: 'Follow-up',
    reason: 'Annual check',
    notes: null,
    cancelledReason: null,
    clinicTimezone: FIXTURE_CLINIC_TIMEZONE,
    hospital: MEDORA_HOSPITAL,
    availableActions: ['cancel'],
  },
];

const PAST: readonly Appointment[] = [
  {
    id: 'APT-1990',
    startsAt: isoIn(-21, 10, 0),
    durationMin: 30,
    status: 'completed',
    priority: 'normal',
    doctor: summaryOf(layla!),
    departmentName: 'Cardiology',
    visitType: 'New patient',
    reason: 'Palpitations',
    notes: null,
    cancelledReason: null,
    clinicTimezone: FIXTURE_CLINIC_TIMEZONE,
    hospital: MEDORA_HOSPITAL,
    availableActions: [],
  },
  {
    id: 'APT-1985',
    startsAt: isoIn(-40, 16, 0),
    durationMin: 20,
    status: 'no-show',
    priority: 'normal',
    doctor: summaryOf(hana!),
    departmentName: 'Family Medicine',
    visitType: 'Follow-up',
    reason: 'Repeat prescription review',
    notes: null,
    cancelledReason: null,
    clinicTimezone: FIXTURE_CLINIC_TIMEZONE,
    hospital: MEDORA_HOSPITAL,
    availableActions: [],
  },
  {
    id: 'APT-1970',
    startsAt: isoIn(-63, 12, 30),
    durationMin: 30,
    status: 'cancelled',
    priority: 'normal',
    doctor: summaryOf(samir!),
    departmentName: 'Dermatology',
    visitType: 'Follow-up',
    reason: 'Mole check',
    notes: null,
    cancelledReason: 'Cancelled by the patient',
    clinicTimezone: FIXTURE_CLINIC_TIMEZONE,
    hospital: MEDORA_HOSPITAL,
    availableActions: [],
  },
];

const ALL = [...UPCOMING, ...PAST];

const SLOT_HOURS = [9, 9.5, 10, 11, 13.5, 14, 15, 16] as const;

/**
 * Small on purpose. The fixture list is a handful of appointments, and a
 * page size of two is what makes "Show more" reachable in development
 * and in a test without inventing forty rows nobody reads.
 */
const FIXTURE_PAGE_SIZE = 2;

const VISIT_TYPES: readonly VisitType[] = [
  { id: 'VT-1', name: 'New patient', durationMin: 30 },
  { id: 'VT-2', name: 'Follow-up', durationMin: 20 },
];

let created: AppointmentDetail[] = [];
let overrides = new Map<string, Appointment>();
let requests = new Map<string, RescheduleRequest[]>();

function current(appointment: Appointment): Appointment {
  return overrides.get(appointment.id) ?? appointment;
}

function notFound(): Error {
  return Object.assign(new Error('API error: not_found'), { kind: 'not_found' as const });
}

function find(id: string): Appointment {
  const found = [...created, ...ALL].map(current).find((item) => item.id === id);
  if (found === undefined) throw notFound();
  return found;
}

/** The newest request still open, if any. */
function pendingOf(id: string): RescheduleRequest | null {
  return (requests.get(id) ?? []).find((request) => request.status === 'pending') ?? null;
}

function detailOf(appointment: Appointment): AppointmentDetail {
  return {
    ...appointment,
    // A stored list, exactly as a server would send it — the fixture does
    // not decide it, so a pending request is expressed by the override.
    pendingRescheduleRequest: pendingOf(appointment.id),
    events: [
      {
        id: `${appointment.id}-E1`,
        at: appointment.startsAt,
        fromStatus: null,
        toStatus: 'pending',
        actor: 'You',
        reason: null,
      },
      ...(appointment.status === 'pending'
        ? []
        : [
            {
              id: `${appointment.id}-E2`,
              at: appointment.startsAt,
              fromStatus: 'pending' as const,
              toStatus: appointment.status,
              actor: 'The clinic',
              reason: appointment.cancelledReason,
            },
          ]),
    ],
  };
}

export const fixtureAppointmentService: AppointmentService = {
  async list(scope, page = 1): Promise<AppointmentPage> {
    const base = scope === 'upcoming' ? [...created, ...UPCOMING] : PAST;
    const sorted = base
      .map(current)
      .sort((a, b) =>
        scope === 'upcoming'
          ? a.startsAt.localeCompare(b.startsAt)
          : b.startsAt.localeCompare(a.startsAt),
      );
    const start = (page - 1) * FIXTURE_PAGE_SIZE;
    const items = sorted.slice(start, start + FIXTURE_PAGE_SIZE);
    return {
      items,
      totalItems: sorted.length,
      hasMore: start + items.length < sorted.length,
    };
  },

  async getById(id): Promise<AppointmentDetail> {
    return detailOf(find(id));
  },

  async listSlots(_doctorId, fromIso) {
    // A canned list, NOT a computation over availability rules.
    const day = new Date(fromIso);
    return SLOT_HOURS.map<BookableSlot>((hour, index) => {
      const slot = new Date(day);
      slot.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);
      return {
        id: `SL-${day.toDateString()}-${index}`,
        startsAt: slot.toISOString(),
        durationMin: 30,
        hospital: MEDORA_HOSPITAL,
      };
    });
  },

  async listVisitTypes() {
    return VISIT_TYPES;
  },

  async book(request) {
    const doctor = FIXTURE_DOCTORS.find((item) => item.id === request.doctorId);
    if (doctor === undefined) throw notFound();
    const visitType = VISIT_TYPES.find((item) => item.id === request.visitTypeId);
    const appointment: Appointment = {
      id: `APT-${String(3000 + created.length)}`,
      startsAt: request.startsAt,
      durationMin: 30,
      // Patient-initiated bookings land in `pending` for the clinic to
      // approve — the loop API §5.4/§5.5 already models from the other side.
      status: 'pending',
      priority: 'normal',
      doctor: summaryOf(doctor),
      departmentName: doctor.departmentName,
      visitType: visitType?.name ?? 'New patient',
      reason: request.reason,
      notes: request.notes ?? null,
      cancelledReason: null,
      clinicTimezone: FIXTURE_CLINIC_TIMEZONE,
      hospital: MEDORA_HOSPITAL,
      availableActions: ['cancel'],
    };
    const detail = detailOf(appointment);
    created = [detail, ...created];
    return detail;
  },

  async cancel(id, request) {
    const found = find(id);
    const next: Appointment = {
      ...found,
      status: 'cancelled',
      cancelledReason: `patient:${request.reasonCode}${
        request.note === undefined ? '' : ` ${request.note}`
      }`,
      clinicTimezone: FIXTURE_CLINIC_TIMEZONE,
      availableActions: [],
    };
    overrides.set(id, next);
    return detailOf(next);
  },

  async requestReschedule(id, submission) {
    const found = find(id);
    const request: RescheduleRequest = {
      id: `RR-${String((requests.get(id)?.length ?? 0) + 1)}`,
      appointmentId: found.id,
      status: 'pending',
      requestedSlot: {
        id: submission.slotId,
        startsAt: found.startsAt,
        durationMin: found.durationMin,
      },
      note: submission.note ?? null,
      decisionReason: null,
      createdAt: new Date().toISOString(),
      decidedAt: null,
    };
    requests.set(id, [request, ...(requests.get(id) ?? [])]);
    // The appointment itself is untouched — a request is not a move. Only
    // the server-computed actions change: no second request while one is open.
    overrides.set(id, { ...found, availableActions: ['cancel'] });
    return request;
  },

  async listRescheduleRequests(id) {
    return requests.get(id) ?? [];
  },

  async withdrawRescheduleRequest(requestId) {
    for (const [appointmentId, list] of requests) {
      const request = list.find((item) => item.id === requestId);
      if (request === undefined) continue;
      const withdrawn: RescheduleRequest = {
        ...request,
        status: 'withdrawn',
        decidedAt: new Date().toISOString(),
      };
      requests.set(
        appointmentId,
        list.map((item) => (item.id === requestId ? withdrawn : item)),
      );
      overrides.set(appointmentId, {
        ...find(appointmentId),
        availableActions: ['cancel', 'reschedule'],
      });
      return withdrawn;
    }
    throw notFound();
  },
};

/** Resets fixture mutations. Tests only. */
export function resetAppointmentFixtures(): void {
  created = [];
  overrides = new Map();
  requests = new Map();
}
