import { FIXTURE_DOCTORS } from '@/features/doctors/fixtures/doctor-fixtures';

import type {
  Appointment,
  AppointmentDetail,
  AppointmentPage,
  AppointmentService,
  BookableSlot,
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
    availableActions: ['cancel', 'reschedule'],
    proposedSlots: [],
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
    availableActions: ['cancel'],
    proposedSlots: [],
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
    availableActions: ['confirm', 'cancel'],
    proposedSlots: [
      { id: 'PS-1', startsAt: isoIn(15, 9, 0), durationMin: 30 },
      { id: 'PS-2', startsAt: isoIn(16, 15, 30), durationMin: 30 },
      { id: 'PS-3', startsAt: isoIn(18, 10, 0), durationMin: 30 },
    ],
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
    availableActions: [],
    proposedSlots: [],
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
    availableActions: [],
    proposedSlots: [],
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
    availableActions: [],
    proposedSlots: [],
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

let created: Appointment[] = [];
let overrides = new Map<string, Appointment>();

function current(appointment: Appointment): Appointment {
  return overrides.get(appointment.id) ?? appointment;
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
    const found = [...created, ...ALL].map(current).find((item) => item.id === id);
    if (found === undefined) {
      throw Object.assign(new Error('API error: not_found'), { kind: 'not_found' as const });
    }
    return {
      ...found,
      events: [
        {
          id: `${found.id}-E1`,
          at: found.startsAt,
          fromStatus: null,
          toStatus: 'pending',
          actor: 'You',
          reason: null,
        },
        ...(found.status === 'pending'
          ? []
          : [
              {
                id: `${found.id}-E2`,
                at: found.startsAt,
                fromStatus: 'pending' as const,
                toStatus: found.status,
                actor: 'The clinic',
                reason: found.cancelledReason,
              },
            ]),
      ],
    };
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
      };
    });
  },

  async book(request) {
    const doctor = FIXTURE_DOCTORS.find((item) => item.id === request.doctorId);
    if (doctor === undefined) {
      throw Object.assign(new Error('API error: not_found'), { kind: 'not_found' as const });
    }
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
      visitType: 'New patient',
      reason: request.reason,
      notes: request.notes ?? null,
      cancelledReason: null,
      clinicTimezone: FIXTURE_CLINIC_TIMEZONE,
      availableActions: ['cancel'],
      proposedSlots: [],
    };
    created = [appointment, ...created];
    return appointment;
  },

  async cancel(id, reason) {
    const found = [...created, ...ALL].map(current).find((item) => item.id === id);
    if (found === undefined) {
      throw Object.assign(new Error('API error: not_found'), { kind: 'not_found' as const });
    }
    const next: Appointment = {
      ...found,
      status: 'cancelled',
      cancelledReason: reason,
      clinicTimezone: FIXTURE_CLINIC_TIMEZONE,
      availableActions: [],
      proposedSlots: [],
    };
    overrides.set(id, next);
    return next;
  },

  async requestReschedule(id, reason) {
    const found = [...created, ...ALL].map(current).find((item) => item.id === id);
    if (found === undefined) {
      throw Object.assign(new Error('API error: not_found'), { kind: 'not_found' as const });
    }
    const next: Appointment = {
      ...found,
      status: 'rescheduled',
      notes: reason,
      availableActions: ['cancel'],
    };
    overrides.set(id, next);
    return next;
  },

  async acceptProposal(id, slotId) {
    const found = [...created, ...ALL].map(current).find((item) => item.id === id);
    if (found === undefined) {
      throw Object.assign(new Error('API error: not_found'), { kind: 'not_found' as const });
    }
    // The fixture always populates `proposedSlots`; the port makes it
    // optional because the LIVE payload does not carry it yet.
    const slot = (found.proposedSlots ?? []).find((item) => item.id === slotId);
    if (slot === undefined) {
      // The same 409 a real race produces, so the recovery path is exercised.
      throw Object.assign(new Error('API error: conflict'), {
        kind: 'conflict' as const,
        detail: 'That time is no longer offered.',
      });
    }
    const next: Appointment = {
      ...found,
      status: 'confirmed',
      startsAt: slot.startsAt,
      availableActions: ['cancel', 'reschedule'],
      proposedSlots: [],
    };
    overrides.set(id, next);
    return next;
  },
};

/** Resets fixture mutations. Tests only. */
export function resetAppointmentFixtures(): void {
  created = [];
  overrides = new Map();
}
