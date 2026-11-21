import { DollarSign, Users, Calendar, FlaskConical, Pill, TrendingUp } from 'lucide-react';

import { DOCTORS } from '@/features/shared-domain/patient-identity';

import type {
  KpiDatum,
  ReportsDocument,
  SavedReport,
  ScheduledReport,
  SeriesPoint,
  Slice,
} from './types';
import { DEFAULT_FILTERS } from './types';

/**
 * PHASE 16 MOCK ANALYTICS — small, hand-authored, deterministic seeds. The
 * five colleagues reuse the shared roster (`DOCTORS`); everything else is
 * ≤5 canonical rows (5 departments, 5 lab statuses, 5 drug classes, 5 saved
 * reports, 3 schedules). Filtered snapshots are derived from these bases by
 * deterministic scaling (see selectors) so charts respond to filters without
 * a mountain of fake rows. Aggregate counts only — never patient records.
 */

export const DEPARTMENTS: readonly string[] = [
  'Cardiology',
  'Internal Medicine',
  'Pediatrics',
  'Orthopedics',
  'Neurology',
];

export const REPORT_DOCTORS = DOCTORS;

export const MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const WEEKDAYS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const TIME_SLOTS: readonly string[] = ['8a', '10a', '12p', '2p', '4p', '6p'];

/* ── Base monthly series (12 months) ────────────────────────────── */

export const BASE_REVENUE: readonly number[] = [
  182, 174, 205, 221, 213, 244, 268, 259, 287, 301, 296, 324,
];
export const BASE_PATIENTS: readonly number[] = [
  118, 109, 131, 142, 138, 151, 164, 158, 173, 181, 176, 194,
];
export const BASE_APPOINTMENTS: readonly number[] = [
  240, 226, 268, 291, 279, 312, 338, 327, 356, 372, 361, 398,
];

/* ── Weekday appointment volume ─────────────────────────────────── */

export const BASE_WEEKDAY: readonly SeriesPoint[] = [
  { label: 'Mon', value: 74 },
  { label: 'Tue', value: 68 },
  { label: 'Wed', value: 82 },
  { label: 'Thu', value: 71 },
  { label: 'Fri', value: 63 },
  { label: 'Sat', value: 38 },
  { label: 'Sun', value: 12 },
];

/* ── Departments (patients) ─────────────────────────────────────── */

/*
 * Specialties are CATEGORIES, so they take the categorical ramp. They used to
 * run primary / success / accent / warning / info, which said Internal
 * Medicine was healthy, Orthopedics needed attention, and Paediatrics was
 * AI-generated — none of which was meant (ADR-0001 section 9).
 */
export const BASE_DEPARTMENTS: readonly Slice[] = [
  { label: 'Cardiology', value: 312, tone: 'chart1' },
  { label: 'Internal Medicine', value: 268, tone: 'chart2' },
  { label: 'Pediatrics', value: 194, tone: 'chart3' },
  { label: 'Orthopedics', value: 156, tone: 'chart4' },
  { label: 'Neurology', value: 121, tone: 'chart5' },
];

/* ── Lab order status ───────────────────────────────────────────── */

/*
 * Lab status KEEPS the clinical semantics: here the colour is the message —
 * `Critical` must be red, `Pending` amber. This is what the semantic tones
 * are reserved for.
 */
export const BASE_LAB_STATUS: readonly Slice[] = [
  { label: 'Completed', value: 428, tone: 'success' },
  { label: 'In progress', value: 96, tone: 'info' },
  { label: 'Pending', value: 74, tone: 'warning' },
  { label: 'Critical', value: 23, tone: 'error' },
  { label: 'Cancelled', value: 18, tone: 'secondary' },
];

/* ── Age distribution (patients) ────────────────────────────────── */

export const BASE_AGE: readonly SeriesPoint[] = [
  { label: '0–17', value: 143 },
  { label: '18–39', value: 268 },
  { label: '40–64', value: 341 },
  { label: '65+', value: 199 },
];

/* ── Prescriptions by drug class ────────────────────────────────── */

export const BASE_PHARMACY: readonly SeriesPoint[] = [
  { label: 'Antibiotics', value: 214 },
  { label: 'Analgesics', value: 187 },
  { label: 'Cardiovascular', value: 163 },
  { label: 'Antidiabetic', value: 128 },
  { label: 'Respiratory', value: 96 },
];

/* ── Messages sent per weekday ──────────────────────────────────── */

export const BASE_MESSAGES: readonly SeriesPoint[] = [
  { label: 'Mon', value: 58 },
  { label: 'Tue', value: 52 },
  { label: 'Wed', value: 64 },
  { label: 'Thu', value: 49 },
  { label: 'Fri', value: 41 },
  { label: 'Sat', value: 18 },
  { label: 'Sun', value: 7 },
];

/* ── AI assistant usage by feature ──────────────────────────────── */

export const BASE_AI: readonly SeriesPoint[] = [
  { label: 'Note summaries', value: 182 },
  { label: 'Draft replies', value: 141 },
  { label: 'Safety checks', value: 118 },
  { label: 'Coding help', value: 87 },
  { label: 'Clinical Q&A', value: 64 },
];

/* ── Medical records by type ────────────────────────────────────── */

export const BASE_RECORDS: readonly SeriesPoint[] = [
  { label: 'Consultations', value: 246 },
  { label: 'Lab reports', value: 198 },
  { label: 'Imaging', value: 132 },
  { label: 'Procedures', value: 89 },
  { label: 'Referrals', value: 61 },
];

/* ── Activity heatmap (weekday × time-of-day) ───────────────────── */

export const BASE_HEATMAP: readonly (readonly number[])[] = [
  [12, 22, 18, 24, 20, 8], // Mon
  [10, 20, 16, 22, 19, 7], // Tue
  [14, 26, 21, 27, 23, 9], // Wed
  [11, 21, 17, 23, 18, 6], // Thu
  [9, 18, 15, 20, 16, 5], // Fri
  [4, 9, 8, 10, 7, 2], // Sat
  [1, 3, 2, 4, 2, 1], // Sun
];

/* ── Executive KPIs (base, current period) ──────────────────────── */

export const BASE_KPIS: readonly KpiDatum[] = [
  {
    id: 'revenue',
    label: 'Revenue',
    value: 324_000,
    format: 'currency',
    deltaPercent: 9.5,
    tone: 'success',
    icon: DollarSign,
    spark: [268, 259, 287, 301, 296, 324],
  },
  {
    id: 'patients',
    label: 'Patients',
    value: 194,
    format: 'number',
    deltaPercent: 10.2,
    tone: 'primary',
    icon: Users,
    spark: [164, 158, 173, 181, 176, 194],
  },
  {
    id: 'appointments',
    label: 'Appointments',
    value: 398,
    format: 'number',
    deltaPercent: 7.4,
    tone: 'info',
    icon: Calendar,
    spark: [338, 327, 356, 372, 361, 398],
  },
  {
    id: 'lab-orders',
    label: 'Lab orders',
    value: 639,
    format: 'number',
    deltaPercent: 4.1,
    tone: 'error',
    icon: FlaskConical,
    spark: [560, 574, 598, 611, 623, 639],
  },
  {
    id: 'prescriptions',
    label: 'Prescriptions',
    value: 788,
    format: 'number',
    deltaPercent: 6.8,
    tone: 'warning',
    icon: Pill,
    spark: [688, 701, 724, 742, 761, 788],
  },
  {
    id: 'growth',
    label: 'Growth',
    value: 12.4,
    format: 'percent',
    deltaPercent: 2.3,
    tone: 'accent',
    icon: TrendingUp,
    spark: [8.1, 9.2, 9.8, 10.6, 11.5, 12.4],
  },
];

/* ── Saved reports (5) + schedules (3) ──────────────────────────── */

export const SEED_SAVED_REPORTS: readonly SavedReport[] = [
  {
    id: 'rep-1',
    name: 'Monthly executive summary',
    category: 'overview',
    range: 'month',
    favorite: true,
    createdAt: '2026-06-01T09:00:00.000Z',
    lastViewedAt: '2026-07-13T08:20:00.000Z',
    filters: { ...DEFAULT_FILTERS, category: 'overview', range: 'month' },
  },
  {
    id: 'rep-2',
    name: 'Quarterly revenue review',
    category: 'revenue',
    range: 'quarter',
    favorite: true,
    createdAt: '2026-04-02T10:30:00.000Z',
    lastViewedAt: '2026-07-10T14:05:00.000Z',
    filters: { ...DEFAULT_FILTERS, category: 'revenue', range: 'quarter' },
  },
  {
    id: 'rep-3',
    name: 'Cardiology patient mix',
    category: 'patients',
    range: 'year',
    favorite: false,
    createdAt: '2026-05-18T11:15:00.000Z',
    lastViewedAt: '2026-07-06T16:40:00.000Z',
    filters: { ...DEFAULT_FILTERS, category: 'patients', range: 'year', department: 'Cardiology' },
  },
  {
    id: 'rep-4',
    name: 'Lab turnaround & criticals',
    category: 'laboratory',
    range: 'week',
    favorite: false,
    createdAt: '2026-06-22T08:45:00.000Z',
    lastViewedAt: '2026-07-12T09:10:00.000Z',
    filters: { ...DEFAULT_FILTERS, category: 'laboratory', range: 'week' },
  },
  {
    id: 'rep-5',
    name: 'Prescription trends',
    category: 'pharmacy',
    range: 'month',
    favorite: false,
    createdAt: '2026-06-30T13:00:00.000Z',
    lastViewedAt: '2026-07-11T10:25:00.000Z',
    filters: { ...DEFAULT_FILTERS, category: 'pharmacy', range: 'month' },
  },
];

export const SEED_SCHEDULED_REPORTS: readonly ScheduledReport[] = [
  {
    id: 'sch-1',
    name: 'Daily practice digest',
    category: 'overview',
    frequency: 'daily',
    format: 'pdf',
    recipients: ['amelia.chen@medora.health'],
    status: 'active',
    nextRunAt: '2026-07-15T06:00:00.000Z',
    history: [
      { id: 'run-1a', at: '2026-07-14T06:00:00.000Z', status: 'sent' },
      { id: 'run-1b', at: '2026-07-13T06:00:00.000Z', status: 'sent' },
      { id: 'run-1c', at: '2026-07-12T06:00:00.000Z', status: 'sent' },
    ],
  },
  {
    id: 'sch-2',
    name: 'Weekly revenue report',
    category: 'revenue',
    frequency: 'weekly',
    format: 'excel',
    recipients: ['amelia.chen@medora.health', 'finance@medora.health'],
    status: 'active',
    nextRunAt: '2026-07-20T07:00:00.000Z',
    history: [
      { id: 'run-2a', at: '2026-07-13T07:00:00.000Z', status: 'sent' },
      { id: 'run-2b', at: '2026-07-06T07:00:00.000Z', status: 'failed' },
    ],
  },
  {
    id: 'sch-3',
    name: 'Monthly board pack',
    category: 'overview',
    frequency: 'monthly',
    format: 'pdf',
    recipients: ['board@medora.health'],
    status: 'paused',
    nextRunAt: '2026-08-01T08:00:00.000Z',
    history: [{ id: 'run-3a', at: '2026-07-01T08:00:00.000Z', status: 'sent' }],
  },
];

export const SEED_REPORTS_DOCUMENT: ReportsDocument = {
  saved: SEED_SAVED_REPORTS,
  scheduled: SEED_SCHEDULED_REPORTS,
};
