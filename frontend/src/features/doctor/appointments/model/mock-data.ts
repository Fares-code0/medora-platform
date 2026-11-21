import {
  MOCK_PATIENTS,
  isoDaysFromNow,
  mulberry32,
  pick,
  weighted,
} from '@/features/shared-domain/patient-identity';
import { dayDiffFromToday } from '@/utils/dates';

import {
  DEPARTMENTS,
  VISIT_TYPES,
  type Appointment,
  type AppointmentPriority,
  type AppointmentStatus,
} from './types';

/**
 * PHASE 12 MOCK DATA — five representative appointments, one per
 * canonical roster patient, mirroring the dashboard's "Today's schedule"
 * exactly (same people, times, visit types, and statuses) so the demo
 * reads as one coherent day. Replaced by the appointments endpoints in a
 * later phase.
 */

interface SeedPlan {
  readonly hour: number;
  readonly minute: number;
  readonly visitType: string;
  readonly status: AppointmentStatus;
  readonly priority: AppointmentPriority;
  readonly durationMin: number;
}

/** index ↔ MOCK_PATIENTS index: Khaled · Mona · Amira · Omar · Layla. */
const SEED_PLAN: readonly SeedPlan[] = [
  {
    hour: 9,
    minute: 0,
    visitType: 'Follow-up',
    status: 'completed',
    priority: 'normal',
    durationMin: 30,
  },
  {
    hour: 9,
    minute: 45,
    visitType: 'Consultation',
    status: 'completed',
    priority: 'normal',
    durationMin: 30,
  },
  {
    hour: 10,
    minute: 30,
    visitType: 'Follow-up',
    status: 'confirmed',
    priority: 'normal',
    durationMin: 30,
  },
  {
    hour: 11,
    minute: 15,
    visitType: 'Lab review',
    status: 'confirmed',
    priority: 'urgent',
    durationMin: 30,
  },
  {
    hour: 13,
    minute: 0,
    visitType: 'Consultation',
    status: 'pending',
    priority: 'normal',
    durationMin: 45,
  },
];

const REASONS: Record<string, readonly string[]> = {
  Consultation: [
    'Recurring headaches over the past two weeks',
    'Chest discomfort on exertion',
    'Persistent fatigue and poor sleep',
    'Abdominal pain after meals',
  ],
  'Follow-up': [
    'Blood-pressure control review',
    'Diabetes management follow-up',
    'Post-procedure wound check',
    'Medication tolerance review',
  ],
  'Annual check-up': ['Routine annual physical examination'],
  'Lab review': ['Review of recent laboratory results'],
  'Medication review': ['Reassess current regimen and refills'],
  Procedure: ['Minor in-clinic procedure', 'Diagnostic procedure preparation'],
};

const NOTES: readonly string[] = [
  'Patient prefers morning slots.',
  'Interpreter not required.',
  'Bring previous imaging discs.',
  'Fasting required before visit.',
];

const PAST_STATUS: ReadonlyArray<readonly [AppointmentStatus, number]> = [
  ['completed', 70],
  ['cancelled', 15],
  ['no-show', 10],
  ['rescheduled', 5],
];

const TODAY_STATUS: ReadonlyArray<readonly [AppointmentStatus, number]> = [
  ['confirmed', 35],
  ['completed', 25],
  ['scheduled', 20],
  ['pending', 15],
  ['cancelled', 5],
];

const FUTURE_STATUS: ReadonlyArray<readonly [AppointmentStatus, number]> = [
  ['scheduled', 33],
  ['confirmed', 34],
  ['pending', 18],
  ['rescheduled', 15],
];

const PRIORITY_WEIGHTS: ReadonlyArray<readonly [AppointmentPriority, number]> = [
  ['low', 10],
  ['normal', 60],
  ['high', 20],
  ['urgent', 10],
];

const DURATIONS: readonly number[] = [15, 20, 30, 30, 45, 60];

function buildAppointment(index: number, random: () => number): Appointment {
  const plan = SEED_PLAN[index];
  const patient = MOCK_PATIENTS[index % MOCK_PATIENTS.length] ?? pick(MOCK_PATIENTS, random());

  const hour = plan?.hour ?? 8 + Math.floor(random() * 10);
  const minute = plan?.minute ?? (random() < 0.5 ? 0 : 30);
  const dateTime = isoDaysFromNow(0, hour, minute);

  const diff = dayDiffFromToday(dateTime);
  const status =
    plan?.status ??
    weighted(diff < 0 ? PAST_STATUS : diff === 0 ? TODAY_STATUS : FUTURE_STATUS, random());

  const visitType = plan?.visitType ?? pick(VISIT_TYPES, random());
  const isFollowUp = visitType === 'Follow-up';

  return {
    id: `APT-${String(3001 + index)}`,
    patient: {
      id: patient.id,
      name: patient.name,
      mrn: patient.mrn,
      phone: patient.phone,
      age: patient.age,
      gender: patient.gender,
    },
    dateTime,
    durationMin: plan?.durationMin ?? pick(DURATIONS, random()),
    visitType,
    department: pick(DEPARTMENTS, random()),
    doctor: 'Dr. Amelia Chen',
    status,
    priority: plan?.priority ?? weighted(PRIORITY_WEIGHTS, random()),
    isNewPatient: patient.lastVisit === null,
    isFollowUp,
    reason: pick(REASONS[visitType] ?? REASONS['Consultation'] ?? ['Consultation'], random()),
    notes: random() < 0.35 ? pick(NOTES, random()) : null,
  };
}

const random = mulberry32(0xa9017_beef % 2147483647);

export const MOCK_APPOINTMENTS: readonly Appointment[] = Array.from({ length: 24 }, (_, index) =>
  buildAppointment(index, random),
);
