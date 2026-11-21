/**
 * Clinic operations — mock data source (Phase 17; moved here by D-27b).
 *
 * Stands in for the clinic-management API. Every list is capped at the
 * five seeded records the brief allows (document templates enumerate the
 * six named deliverables). Fetch functions simulate network latency so the
 * query layer, loading states and error paths behave like production.
 *
 * **Why it lives in shared-domain.** Two features read the clinic floor now:
 * the administrator's cross-clinic board (`features/admin/`) and the
 * doctor's own-clinic board (`features/doctor/clinic/`, D-27b). §3.4 forbids
 * the second importing the first, and the state here is mutable — the queue
 * is edited — so moving the *seed* would not have been enough; both features
 * have to read and write the same store or they will disagree. This is the
 * same remedy D-05 applied to lab studies.
 *
 * shared-domain must not import a role feature (§3.3), which is why the
 * ADM-07 audit *projection* is not here: see `getAuditRows`.
 */

import { notConnected } from '@/api/http';
import { selectService } from '@/api/seam';

import type {
  Announcement,
  AuditEvent,
  ClinicOverview,
  Department,
  DocumentTemplate,
  Holiday,
  PhiAccessEvent,
  Policy,
  PlatformStatus,
  QueueEntry,
  Resource,
  Room,
  ShiftAssignment,
  StaffMember,
  WaitingPatient,
  WorkingDay,
} from './types';

const LATENCY_MS = 280;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

/* ── Departments (referenced by most other datasets) ──────────── */

const departments: readonly Department[] = [
  {
    id: 'dep-med',
    name: 'General Medicine',
    description: 'Primary consultations, follow-ups and chronic care.',
    status: 'active',
    headStaffId: 'stf-doc',
    staffCount: 2,
  },
  {
    id: 'dep-nur',
    name: 'Nursing',
    description: 'Vitals, triage, dressings and patient preparation.',
    status: 'active',
    headStaffId: 'stf-nur',
    staffCount: 1,
  },
  {
    id: 'dep-desk',
    name: 'Front Desk',
    description: 'Reception, check-in, scheduling and billing.',
    status: 'active',
    headStaffId: 'stf-rec',
    staffCount: 1,
  },
  {
    id: 'dep-lab',
    name: 'Laboratory',
    description: 'Sample collection and in-house diagnostics.',
    status: 'active',
    headStaffId: 'stf-lab',
    staffCount: 1,
  },
  {
    id: 'dep-pharm',
    name: 'Pharmacy',
    description: 'Dispensing, stock control and medication counselling.',
    status: 'inactive',
    headStaffId: 'stf-phr',
    staffCount: 1,
  },
];

/* ── Staff (max 5, one per clinic role) ───────────────────────── */

const staff: readonly StaffMember[] = [
  {
    id: 'stf-doc',
    name: 'Dr. Lena Hart',
    role: 'doctor',
    title: 'Attending Physician',
    departmentId: 'dep-med',
    status: 'on-duty',
    phone: '+1 (555) 018-2201',
    email: 'lena.hart@medora.clinic',
    workingHours: 'Mon–Fri · 08:00–16:00',
    permissions: ['Patients', 'Prescriptions', 'Lab review', 'Scheduling'],
  },
  {
    id: 'stf-nur',
    name: 'Marcus Reed',
    role: 'nurse',
    title: 'Senior Nurse',
    departmentId: 'dep-nur',
    status: 'on-duty',
    phone: '+1 (555) 018-4477',
    email: 'marcus.reed@medora.clinic',
    workingHours: 'Mon–Sat · 07:30–15:30',
    permissions: ['Vitals', 'Triage', 'Patient prep'],
  },
  {
    id: 'stf-rec',
    name: 'Priya Nair',
    role: 'receptionist',
    title: 'Front Desk Lead',
    departmentId: 'dep-desk',
    status: 'on-break',
    phone: '+1 (555) 018-9910',
    email: 'priya.nair@medora.clinic',
    workingHours: 'Mon–Fri · 08:00–17:00',
    permissions: ['Check-in', 'Scheduling', 'Billing'],
  },
  {
    id: 'stf-lab',
    name: 'Tomas Ellis',
    role: 'laboratory',
    title: 'Lab Technician',
    departmentId: 'dep-lab',
    status: 'off-duty',
    phone: '+1 (555) 018-3352',
    email: 'tomas.ellis@medora.clinic',
    workingHours: 'Mon–Fri · 09:00–17:00',
    permissions: ['Sample intake', 'Result entry'],
  },
  {
    id: 'stf-phr',
    name: 'Sofia Marin',
    role: 'pharmacy',
    title: 'Pharmacist',
    departmentId: 'dep-pharm',
    status: 'on-leave',
    phone: '+1 (555) 018-7788',
    email: 'sofia.marin@medora.clinic',
    workingHours: 'Mon–Fri · 08:30–16:30',
    permissions: ['Dispensing', 'Stock control'],
  },
];

/* ── Rooms (one per kind) ─────────────────────────────────────── */

const rooms: readonly Room[] = [
  {
    id: 'rm-101',
    name: 'Consultation 1',
    kind: 'consultation',
    status: 'occupied',
    departmentId: 'dep-med',
    capacity: 2,
    note: 'Dr. Hart · patient in room',
  },
  {
    id: 'rm-lab',
    name: 'Laboratory',
    kind: 'lab',
    status: 'available',
    departmentId: 'dep-lab',
    capacity: 3,
  },
  {
    id: 'rm-proc',
    name: 'Procedure Room',
    kind: 'procedure',
    status: 'cleaning',
    departmentId: 'dep-nur',
    capacity: 2,
    note: 'Turnaround ~10 min',
  },
  {
    id: 'rm-pharm',
    name: 'Pharmacy Counter',
    kind: 'pharmacy',
    status: 'maintenance',
    departmentId: 'dep-pharm',
    capacity: 1,
    note: 'Fridge calibration',
  },
  {
    id: 'rm-wait',
    name: 'Waiting Area',
    kind: 'waiting',
    status: 'occupied',
    departmentId: 'dep-desk',
    capacity: 18,
    note: '11 of 18 seats in use',
  },
];

/* ── Resources ────────────────────────────────────────────────── */

const resources: readonly Resource[] = [
  {
    id: 'res-ecg',
    name: 'ECG Machine',
    category: 'Equipment',
    location: 'Consultation 1',
    quantity: 1,
    reorderLevel: 1,
    status: 'in-stock',
  },
  {
    id: 'res-glove',
    name: 'Nitrile Gloves (box)',
    category: 'Consumable',
    location: 'Store A',
    quantity: 6,
    reorderLevel: 8,
    status: 'low',
  },
  {
    id: 'res-tube',
    name: 'Sample Tubes',
    category: 'Consumable',
    location: 'Laboratory',
    quantity: 0,
    reorderLevel: 20,
    status: 'out',
  },
  {
    id: 'res-wheel',
    name: 'Wheelchair',
    category: 'Equipment',
    location: 'Waiting Area',
    quantity: 2,
    reorderLevel: 1,
    status: 'in-stock',
  },
  {
    id: 'res-print',
    name: 'Label Printer',
    category: 'Equipment',
    location: 'Front Desk',
    quantity: 1,
    reorderLevel: 1,
    status: 'in-stock',
  },
];

/* ── Working schedule ─────────────────────────────────────────── */

const workingSchedule: readonly WorkingDay[] = [
  { day: 'Mon', open: true, start: '08:00', end: '16:00', breakLabel: '12:00–12:30' },
  { day: 'Tue', open: true, start: '08:00', end: '16:00', breakLabel: '12:00–12:30' },
  { day: 'Wed', open: true, start: '08:00', end: '18:00', breakLabel: '13:00–13:30' },
  { day: 'Thu', open: true, start: '08:00', end: '16:00', breakLabel: '12:00–12:30' },
  { day: 'Fri', open: true, start: '08:00', end: '14:00' },
  { day: 'Sat', open: true, start: '09:00', end: '13:00' },
  { day: 'Sun', open: false, start: '—', end: '—' },
];

/* ── Holidays ─────────────────────────────────────────────────── */

const holidays: readonly Holiday[] = [
  { id: 'hol-1', name: 'New Year’s Day', date: '2026-01-01', kind: 'public', recurring: true },
  {
    id: 'hol-2',
    name: 'Clinic Foundation Day',
    date: '2026-03-12',
    kind: 'clinic',
    recurring: true,
  },
  { id: 'hol-3', name: 'Spring Maintenance', date: '2026-04-06', kind: 'clinic', recurring: false },
  { id: 'hol-4', name: 'Labour Day', date: '2026-05-01', kind: 'public', recurring: true },
  { id: 'hol-5', name: 'Staff Training Day', date: '2026-09-18', kind: 'clinic', recurring: false },
];

/* ── Shift assignments (days: Mon..Sun) ───────────────────────── */

const shifts: readonly ShiftAssignment[] = [
  {
    id: 'sh-1',
    staffId: 'stf-doc',
    kind: 'morning',
    days: [true, true, true, true, true, false, false],
  },
  {
    id: 'sh-2',
    staffId: 'stf-nur',
    kind: 'morning',
    days: [true, true, true, true, true, true, false],
  },
  {
    id: 'sh-3',
    staffId: 'stf-rec',
    kind: 'evening',
    days: [false, true, true, true, true, false, false],
  },
  {
    id: 'sh-4',
    staffId: 'stf-lab',
    kind: 'on-call',
    days: [false, false, true, false, true, false, false],
  },
  {
    id: 'sh-5',
    staffId: 'stf-phr',
    kind: 'leave',
    days: [true, true, true, true, true, false, false],
  },
];

/* ── Clinic attribution (D-27b) ───────────────────────────────── */

/**
 * Medora is multi-clinic, and the product model is one doctor, one primary
 * clinic. The seeded operations below all belong to the clinic
 * `usr_doctor_amelia` practises at; a second clinic's rows would be seeded
 * with a different id and must never reach that doctor's board.
 *
 * These constants exist so the seed can *state* attribution rather than
 * implying it. The isolation itself is the server's to enforce — see
 * `docs/handoff/clinic-isolation.md`.
 */
export const CLINIC_ID = 'clinic-meadowbrook';
const CLINIC_MEADOWBROOK = CLINIC_ID;
const DR_AMELIA = 'usr_doctor_amelia';
const DR_JULIAN = 'usr_doctor_secure';

/**
 * The clinic's practising doctors, by **account id**.
 *
 * This is the piece D-27b's checklist row named as missing: "a doctor
 * identity that resolves against the staff roster the shifts hang off". It
 * still does not, and the mismatch is worth stating rather than papering
 * over — the `staff` collection above is a *clinic* roster (`stf-doc`, "Dr.
 * Lena Hart") with no account behind it, while a queue entry has to name the
 * account a signed-in doctor actually holds. Reconciling the two is a
 * backend concern: one staff record, one account, one link between them.
 *
 * Until then this list is the join, seeded to match the accounts the auth
 * mock issues. shared-domain may not import `features/auth` (§3.3), so it
 * cannot be derived here; a test asserts the two agree.
 */
export const CLINIC_DOCTORS: readonly { readonly id: string; readonly name: string }[] = [
  { id: DR_AMELIA, name: 'Dr. Amelia Chen' },
  { id: DR_JULIAN, name: 'Dr. Julian Ford' },
];

/* ── Queue ────────────────────────────────────────────────────── */

const queue: readonly QueueEntry[] = [
  {
    id: 'q-1',
    clinicId: CLINIC_MEADOWBROOK,
    doctorId: DR_AMELIA,
    patientId: 'PT-1001',
    ticket: 'A-102',
    patientName: 'Ravi Menon',
    reason: 'Follow-up · hypertension',
    priority: 'urgent',
    waitingMinutes: 24,
    estimatedMinutes: 0,
    roomId: 'rm-101',
    delayed: true,
  },
  {
    id: 'q-2',
    clinicId: CLINIC_MEADOWBROOK,
    doctorId: DR_AMELIA,
    patientId: 'PT-1002',
    ticket: 'A-103',
    patientName: 'Elena Rossi',
    reason: 'New consultation',
    priority: 'priority',
    waitingMinutes: 12,
    estimatedMinutes: 8,
    delayed: false,
  },
  {
    id: 'q-3',
    clinicId: CLINIC_MEADOWBROOK,
    doctorId: DR_JULIAN,
    patientId: 'PT-1003',
    ticket: 'A-104',
    patientName: 'Daniel Cho',
    reason: 'Lab results review',
    priority: 'routine',
    waitingMinutes: 7,
    estimatedMinutes: 18,
    delayed: false,
  },
  {
    id: 'q-4',
    clinicId: CLINIC_MEADOWBROOK,
    doctorId: DR_AMELIA,
    patientId: 'PT-1004',
    ticket: 'A-105',
    patientName: 'Grace Owen',
    reason: 'Prescription renewal',
    priority: 'routine',
    waitingMinutes: 3,
    estimatedMinutes: 26,
    delayed: false,
  },
  {
    id: 'q-5',
    clinicId: CLINIC_MEADOWBROOK,
    doctorId: DR_JULIAN,
    patientId: 'PT-1005',
    ticket: 'A-106',
    patientName: 'Imran Farouk',
    reason: 'Dressing change',
    priority: 'priority',
    waitingMinutes: 31,
    estimatedMinutes: 34,
    delayed: true,
  },
];

/* ── Waiting room ─────────────────────────────────────────────── */

const waitingRoom: readonly WaitingPatient[] = [
  {
    id: 'w-1',
    clinicId: CLINIC_MEADOWBROOK,
    doctorId: DR_AMELIA,
    patientId: 'PT-1001',
    patientName: 'Ravi Menon',
    appointmentTime: '09:00',
    checkedInAt: '08:52',
    waitingMinutes: 24,
    area: 'Main lobby',
    status: 'in-room',
  },
  {
    id: 'w-2',
    clinicId: CLINIC_MEADOWBROOK,
    doctorId: DR_AMELIA,
    patientId: 'PT-1002',
    patientName: 'Elena Rossi',
    appointmentTime: '09:15',
    checkedInAt: '09:04',
    waitingMinutes: 12,
    area: 'Main lobby',
    status: 'called',
  },
  {
    id: 'w-3',
    clinicId: CLINIC_MEADOWBROOK,
    doctorId: DR_JULIAN,
    patientId: 'PT-1003',
    patientName: 'Daniel Cho',
    appointmentTime: '09:30',
    checkedInAt: '09:19',
    waitingMinutes: 7,
    area: 'Main lobby',
    status: 'waiting',
  },
  {
    id: 'w-4',
    clinicId: CLINIC_MEADOWBROOK,
    doctorId: DR_AMELIA,
    patientId: 'PT-1004',
    patientName: 'Grace Owen',
    appointmentTime: '09:45',
    checkedInAt: '09:33',
    waitingMinutes: 3,
    area: 'Quiet corner',
    status: 'waiting',
  },
];

/* ── Announcements ────────────────────────────────────────────── */

const announcements: readonly Announcement[] = [
  {
    id: 'an-1',
    title: 'Flu vaccination drive starts Monday',
    body: 'Nursing to prepare 40 doses. Reception will slot walk-ins between 11:00 and 13:00.',
    author: 'Dr. Lena Hart',
    priority: 'high',
    pinned: true,
    archived: false,
    createdAt: '2026-07-13',
    expiresAt: '2026-07-31',
  },
  {
    id: 'an-2',
    title: 'New lab request form is live',
    body: 'Use the updated Lab Request template for all orders from today.',
    author: 'Tomas Ellis',
    priority: 'normal',
    pinned: false,
    archived: false,
    createdAt: '2026-07-11',
  },
  {
    id: 'an-3',
    title: 'Pharmacy counter closed for calibration',
    body: 'Dispensing paused Thursday morning. Route urgent scripts to the partner pharmacy.',
    author: 'Sofia Marin',
    priority: 'high',
    pinned: false,
    archived: false,
    createdAt: '2026-07-10',
    expiresAt: '2026-07-17',
  },
  {
    id: 'an-4',
    title: 'Team lunch Friday 13:00',
    body: 'Front desk will hold the phones. Please stagger your breaks.',
    author: 'Priya Nair',
    priority: 'low',
    pinned: false,
    archived: false,
    createdAt: '2026-07-09',
  },
  {
    id: 'an-5',
    title: 'Q2 audit closed',
    body: 'All records reconciled. Thanks to the team for a clean cycle.',
    author: 'Dr. Lena Hart',
    priority: 'normal',
    pinned: false,
    archived: true,
    createdAt: '2026-06-30',
  },
];

/* ── Policies ─────────────────────────────────────────────────── */

const policies: readonly Policy[] = [
  {
    id: 'pol-1',
    title: 'Patient Confidentiality',
    category: 'Compliance',
    summary: 'Handling, storage and disclosure rules for patient records.',
    updatedAt: '2026-05-02',
    version: 'v3.1',
  },
  {
    id: 'pol-2',
    title: 'Infection Control',
    category: 'Clinical',
    summary: 'Hand hygiene, PPE and room turnaround standards.',
    updatedAt: '2026-06-14',
    version: 'v2.4',
  },
  {
    id: 'pol-3',
    title: 'Appointment & No-Show',
    category: 'Operations',
    summary: 'Booking windows, cancellation notice and no-show follow-up.',
    updatedAt: '2026-04-20',
    version: 'v1.8',
  },
  {
    id: 'pol-4',
    title: 'Controlled Substances',
    category: 'Pharmacy',
    summary: 'Storage, logging and dispensing of controlled medicines.',
    updatedAt: '2026-06-01',
    version: 'v2.0',
  },
  {
    id: 'pol-5',
    title: 'Staff Code of Conduct',
    category: 'HR',
    summary: 'Professional behaviour, dress code and grievance process.',
    updatedAt: '2026-03-15',
    version: 'v1.2',
  },
];

/* ── Document templates (six named deliverables) ──────────────── */

const templates: readonly DocumentTemplate[] = [
  {
    id: 'tpl-rx',
    name: 'Prescription',
    kind: 'prescription',
    description: 'Standard outpatient prescription with dosage table.',
    updatedAt: '2026-06-28',
    usageCount: 312,
    archived: false,
  },
  {
    id: 'tpl-cert',
    name: 'Medical Certificate',
    kind: 'certificate',
    description: 'Fitness / sick-leave certificate with date range.',
    updatedAt: '2026-06-12',
    usageCount: 88,
    archived: false,
  },
  {
    id: 'tpl-ref',
    name: 'Referral',
    kind: 'referral',
    description: 'Specialist referral letter with clinical summary.',
    updatedAt: '2026-05-30',
    usageCount: 47,
    archived: false,
  },
  {
    id: 'tpl-lab',
    name: 'Lab Request',
    kind: 'lab-request',
    description: 'Laboratory investigation order form.',
    updatedAt: '2026-07-11',
    usageCount: 205,
    archived: false,
  },
  {
    id: 'tpl-rad',
    name: 'Radiology Request',
    kind: 'radiology-request',
    description: 'Imaging order with modality and region.',
    updatedAt: '2026-05-18',
    usageCount: 61,
    archived: false,
  },
  {
    id: 'tpl-dis',
    name: 'Discharge Summary',
    kind: 'discharge',
    description: 'Visit summary, diagnosis and aftercare plan.',
    updatedAt: '2026-04-27',
    usageCount: 29,
    archived: true,
  },
];

/* ── Overview aggregate ───────────────────────────────────────── */

const overview: ClinicOverview = {
  clinicName: 'Medora Clinic — Riverside',
  todaysPatients: 34,
  todaysAppointments: 41,
  waitingPatients: 4,
  completedVisits: 22,
  cancelledAppointments: 3,
  doctorUtilization: 78,
  averageWaitingMinutes: 14,
  clinicOccupancy: 61,
  hourlyActivity: [
    { hour: '08', count: 3 },
    { hour: '09', count: 6 },
    { hour: '10', count: 5 },
    { hour: '11', count: 7 },
    { hour: '12', count: 2 },
    { hour: '13', count: 4 },
    { hour: '14', count: 6 },
    { hour: '15', count: 5 },
  ],
};

/* ── Platform status (executive dashboard) ────────────────────── */

/**
 * The seeded platform audit feed — the RAW source, without the PHI reveals
 * `getAuditEvents()` folds in on read.
 *
 * Exported for ADM-07's log service, which aggregates from raw trails rather
 * than from `getAuditEvents()`. Reading the folded feed *and* the PHI access
 * log would put every reveal in the log twice under two different ids
 * (`phi:…` from `fromPhiAccess`, `legacy:aud-phi-…` from `fromLegacyAudit`),
 * which no dedupe-by-id could catch. Exporting the seed is what lets that
 * service take each source exactly once.
 */
export const auditEvents: readonly AuditEvent[] = [
  {
    id: 'aud-1',
    actor: 'Marcus Reed',
    action: 'Updated security policy',
    target: 'Session timeout 45 -> 30 min',
    at: '2026-07-19T08:02:00Z',
    severity: 'info',
  },
  {
    id: 'aud-2',
    actor: 'System',
    action: 'Automatic backup completed',
    target: 'bak-0719 (412 MB)',
    at: '2026-07-19T02:00:00Z',
    severity: 'info',
  },
  {
    id: 'aud-3',
    actor: 'Marcus Reed',
    action: 'Deactivated user',
    target: 'Sofia Marin (pharmacy)',
    at: '2026-07-18T16:20:00Z',
    severity: 'warning',
  },
  {
    id: 'aud-4',
    actor: 'Dr. Lena Hart',
    action: 'Exported patient summary',
    target: 'PT-1004',
    at: '2026-07-18T11:47:00Z',
    severity: 'info',
  },
  {
    id: 'aud-5',
    actor: 'System',
    action: 'Failed login attempts',
    target: 'admin@medora.health - 3 attempts',
    at: '2026-07-17T22:15:00Z',
    severity: 'critical',
  },
];

const platformStatus: PlatformStatus = {
  revenueMonth: 324_000,
  revenueDeltaPercent: 9.5,
  activeUsers: 5,
  doctors: 1,
  patients: 194,
  departments: 5,
  appointmentsMonth: 398,
  growthPercent: 12.4,
  system: {
    status: 'operational',
    uptimePercent: 99.98,
    cpuPercent: 34,
    ramPercent: 58,
    storageUsedGb: 412,
    storageTotalGb: 1024,
    apiResponseMs: 142,
  },
  license: {
    plan: 'Enterprise',
    seatsUsed: 5,
    seatsTotal: 25,
    renewsOn: '2027-01-01',
  },
  registrations: [
    { id: 'reg-1', name: 'Sofia Marin', role: 'Pharmacy', registeredAt: '2026-07-04' },
    { id: 'reg-2', name: 'Tomas Ellis', role: 'Laboratory', registeredAt: '2026-06-19' },
    { id: 'reg-3', name: 'Priya Nair', role: 'Reception', registeredAt: '2026-05-30' },
    { id: 'reg-4', name: 'Marcus Reed', role: 'Nurse', registeredAt: '2026-05-12' },
    { id: 'reg-5', name: 'Dr. Lena Hart', role: 'Doctor', registeredAt: '2026-04-02' },
  ],
};

/* ── Mutable store ────────────────────────────────────────────── */

/**
 * The seeded collections above are the reset baseline. Everything the admin
 * can edit lives in ONE localStorage document merged over that baseline on
 * load, so a later-added collection never produces a hole. This mirrors the
 * Platform Settings store (`admin-settings.api.ts`); the difference is that
 * these are collections of records rather than form slices, so the CRUD is
 * generic over `{ id }`.
 *
 * Every mutation returns the FULL patched collection so the query layer can
 * seed its cache with `setQueryData` instead of refetching — the
 * StrictMode-safe pattern used across the app.
 */

const STORAGE_KEY = 'medora.admin.clinic.v1';

export interface ClinicDocument {
  readonly staff: readonly StaffMember[];
  readonly departments: readonly Department[];
  readonly rooms: readonly Room[];
  readonly resources: readonly Resource[];
  readonly workingSchedule: readonly WorkingDay[];
  readonly holidays: readonly Holiday[];
  readonly shifts: readonly ShiftAssignment[];
  readonly queue: readonly QueueEntry[];
  readonly waitingRoom: readonly WaitingPatient[];
  readonly announcements: readonly Announcement[];
  readonly policies: readonly Policy[];
  readonly templates: readonly DocumentTemplate[];
  /**
   * Append-only PHI access log (ADM-10). It lives in the clinic document
   * rather than in its own store so a reveal survives a reload through the
   * same path every other admin write already uses.
   */
  readonly phiAccessLog: readonly PhiAccessEvent[];
}

/** Collections the admin can edit; the reset-defaults baseline. */
export const DEFAULT_CLINIC: ClinicDocument = {
  staff,
  departments,
  rooms,
  resources,
  workingSchedule,
  holidays,
  shifts,
  queue,
  waitingRoom,
  announcements,
  policies,
  templates,
  phiAccessLog: [],
};

export type ClinicCollection = keyof ClinicDocument;

/**
 * The collections the generic CRUD hooks work over. `phiAccessLog` is
 * excluded on purpose: it is append-only and reached through
 * `clinicOperationsApi.phiAccess`, not through create/update/remove.
 */
export type EditableClinicCollection = Exclude<ClinicCollection, 'phiAccessLog'>;

function load(): ClinicDocument {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_CLINIC;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CLINIC;
    const stored = parsed as Partial<ClinicDocument>;
    // Collections are taken whole when present, defaulted when absent.
    return { ...DEFAULT_CLINIC, ...stored };
  } catch {
    return DEFAULT_CLINIC;
  }
}

function persist(document: ClinicDocument): ClinicDocument {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  } catch {
    // Storage unavailable — edits stay session-local.
  }
  return document;
}

/** Replaces one collection and returns it, already persisted. */
function commit<K extends ClinicCollection>(key: K, next: ClinicDocument[K]): ClinicDocument[K] {
  persist({ ...load(), [key]: next });
  return next;
}

/** Sequential id for a new record in a collection, e.g. "stf-6". */
function nextId(prefix: string, existing: readonly { id: string }[]): string {
  let n = existing.length + 1;
  const taken = new Set(existing.map((item) => item.id));
  while (taken.has(`${prefix}-${String(n)}`)) n += 1;
  return `${prefix}-${String(n)}`;
}

/**
 * Generic CRUD over one collection. Entities all carry a string `id`, so the
 * list/create/update/remove shape is identical for every section — only the
 * form fields differ.
 */
type IdentifiedCollection = Exclude<EditableClinicCollection, 'workingSchedule'>;

function crud<K extends IdentifiedCollection>(key: K, idPrefix: string) {
  type Item = ClinicDocument[K][number];
  return {
    list: (): Promise<ClinicDocument[K]> => delay(load()[key]),

    create: (draft: Omit<Item, 'id'>): Promise<ClinicDocument[K]> => {
      const current = load()[key] as readonly Item[];
      const item = { ...draft, id: nextId(idPrefix, current) } as Item;
      return delay(commit(key, [item, ...current] as ClinicDocument[K]));
    },

    update: (id: string, changes: Partial<Item>): Promise<ClinicDocument[K]> => {
      const current = load()[key] as readonly Item[];
      const next = current.map((item) => (item.id === id ? { ...item, ...changes } : item));
      return delay(commit(key, next as ClinicDocument[K]));
    },

    remove: (id: string): Promise<ClinicDocument[K]> => {
      const current = load()[key] as readonly Item[];
      return delay(commit(key, current.filter((item) => item.id !== id) as ClinicDocument[K]));
    },

    /** Replaces the whole collection — used by reordering. */
    replace: (next: ClinicDocument[K]): Promise<ClinicDocument[K]> => delay(commit(key, next)),
  };
}

/* ── Fetch + mutation functions (async, latency-simulated) ────── */

/**
 * A logged PHI reveal, rendered into the shape the audit feed already
 * speaks. §1.5.1 requires these to be visible in the same log as everything
 * else, so they are folded in on read rather than kept in a side channel.
 */
export function asAuditEvent(event: PhiAccessEvent): AuditEvent {
  return {
    id: `aud-${event.id}`,
    actor: event.actor,
    action: 'Revealed patient identifiers',
    target: `${event.subjectLabel} · ${PHI_CATEGORY_ACTION[event.category]} · ${event.reason}`,
    at: event.at,
    severity: 'warning',
  };
}

const PHI_CATEGORY_ACTION: Record<PhiAccessEvent['category'], string> = {
  'clinical-review': 'Clinical review',
  'patient-request': 'Patient request',
  'safety-investigation': 'Safety investigation',
  'billing-dispute': 'Billing dispute',
  'legal-request': 'Legal or regulatory request',
};

const mockClinicOperationsApi = {
  getOverview: () => delay(overview),

  /**
   * The raw audit rows: seeded platform events plus every logged PHI reveal,
   * unclassified and unsorted.
   *
   * **The projection is not here on purpose.** The feed the administrator
   * reads is these rows run through ADM-07's taxonomy (`fromLegacyAudit`
   * classifies, `projectAuditFeed` keeps what the summary feed shows), and
   * that taxonomy lives in `features/admin/logs/`. shared-domain must not
   * import a role feature (§3.3), so the composition happens one layer up,
   * in `features/admin/api/administration.api.ts`, which owns
   * `getAuditEvents`. What is shared is the data; what is admin-specific is
   * the reading of it.
   */
  getAuditRows: (): Promise<readonly AuditEvent[]> =>
    delay([...load().phiAccessLog.map(asAuditEvent), ...auditEvents]),

  getPlatformStatus: () => delay(platformStatus),

  /**
   * PHI access log (ADM-10). Append-only by construction: there is no
   * update and no remove, because an audit trail an administrator can edit
   * is not an audit trail.
   */
  phiAccess: {
    list: (): Promise<readonly PhiAccessEvent[]> => delay(load().phiAccessLog),

    record: (draft: Omit<PhiAccessEvent, 'id' | 'at'>): Promise<readonly PhiAccessEvent[]> => {
      const current = load().phiAccessLog;
      const event: PhiAccessEvent = {
        ...draft,
        id: nextId('phi', current),
        at: new Date().toISOString(),
      };
      return delay(commit('phiAccessLog', [event, ...current]));
    },
  },

  /**
   * The weekly schedule is seven fixed weekdays keyed by `day`, not an
   * id-bearing collection — it is edited in place, never added to or
   * deleted from, so it gets a set/replace API rather than CRUD.
   */
  workingSchedule: {
    list: () => delay(load().workingSchedule),
    setDay: (day: WorkingDay['day'], changes: Partial<WorkingDay>) => {
      const next = load().workingSchedule.map((entry) =>
        entry.day === day ? { ...entry, ...changes } : entry,
      );
      return delay(commit('workingSchedule', next));
    },
    replace: (next: readonly WorkingDay[]) => delay(commit('workingSchedule', next)),
  },

  staff: crud('staff', 'stf'),
  departments: crud('departments', 'dep'),
  rooms: crud('rooms', 'rm'),
  resources: crud('resources', 'res'),
  holidays: crud('holidays', 'hol'),
  shifts: crud('shifts', 'sh'),
  queue: crud('queue', 'q'),
  waitingRoom: crud('waitingRoom', 'wr'),
  announcements: crud('announcements', 'ann'),
  policies: crud('policies', 'pol'),
  templates: crud('templates', 'tpl'),

  /** Restores every collection to the seeded baseline. */
  resetClinic: () => delay(persist(DEFAULT_CLINIC)),
} as const;

/* ── Live posture (FE-10.10) ──────────────────────────────────── */

/**
 * The clinic-operations store has no backend: staff, rooms, the queue, the
 * waiting room and the rest are seeded demo data. In a live build every
 * read and write answers `notConnected`, so neither the administrator's
 * boards, the admin search index, nor the doctor's own-clinic board can put
 * a seeded patient in a queue next to a real sign-in (FE-10 §18).
 */
const refuse = (): Promise<never> => Promise.reject(notConnected('Clinic operations'));

function unconnectedCrud<K extends IdentifiedCollection>(): ReturnType<typeof crud<K>> {
  return { list: refuse, create: refuse, update: refuse, remove: refuse, replace: refuse };
}

export const unconnectedClinicOperationsApi: typeof mockClinicOperationsApi = {
  getOverview: refuse,
  getAuditRows: refuse,
  getPlatformStatus: refuse,
  phiAccess: { list: refuse, record: refuse },
  workingSchedule: { list: refuse, setDay: refuse, replace: refuse },
  staff: unconnectedCrud<'staff'>(),
  departments: unconnectedCrud<'departments'>(),
  rooms: unconnectedCrud<'rooms'>(),
  resources: unconnectedCrud<'resources'>(),
  holidays: unconnectedCrud<'holidays'>(),
  shifts: unconnectedCrud<'shifts'>(),
  queue: unconnectedCrud<'queue'>(),
  waitingRoom: unconnectedCrud<'waitingRoom'>(),
  announcements: unconnectedCrud<'announcements'>(),
  policies: unconnectedCrud<'policies'>(),
  templates: unconnectedCrud<'templates'>(),
  resetClinic: refuse,
};

export const clinicOperationsApi = selectService({
  mock: mockClinicOperationsApi,
  http: unconnectedClinicOperationsApi,
});
