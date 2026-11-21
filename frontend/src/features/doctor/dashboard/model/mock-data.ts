import { Calendar, CalendarCheck, ClipboardList, Users, type LucideIcon } from 'lucide-react';

import type { NamedSeries, Slice } from '@/components/charts';
import type { StatisticDelta, StatisticTone, StatusKind } from '@/components/patterns';
import { routes } from '@/routes';

import { ACTIVITY_PRESENTATION, satisfactionSlices } from './pulse';

/**
 * PHASE 2 MOCK DATA — frontend-only fixtures for the Overview page.
 * Phase 7 replaces this module with TanStack Query hooks in this
 * feature's api/ folder (FRONTEND_ARCHITECTURE.md §3.4); component
 * props are already shaped so only the data source changes.
 */

/* ── KPI row (UX 2.1 Row 1) ─────────────────────────────────────── */

export interface OverviewKpi {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly icon: LucideIcon;
  readonly tone: StatisticTone;
  readonly delta?: StatisticDelta;
  readonly caption?: string;
  readonly sparkline?: readonly number[];
  readonly href: string;
}

export const MOCK_KPIS: readonly OverviewKpi[] = [
  {
    id: 'appointments-today',
    label: "Today's appointments",
    value: '5',
    icon: Calendar,
    tone: 'primary',
    caption: 'Next at 10:30 · 2 completed',
    sparkline: [3, 4, 2, 5, 4, 3, 5],
    href: routes.doctor.appointments,
  },
  {
    id: 'pending-requests',
    label: 'Pending requests',
    value: '1',
    icon: ClipboardList,
    tone: 'warning',
    caption: 'Layla Mansour · awaiting decision',
    href: routes.doctor.appointments,
  },
  {
    id: 'total-patients',
    label: 'Active patients',
    value: '5',
    icon: Users,
    tone: 'info',
    caption: '1 critical · 1 high risk',
    href: routes.doctor.patients,
  },
  {
    id: 'completed-week',
    label: 'Completed this week',
    value: '9',
    icon: CalendarCheck,
    tone: 'success',
    delta: { direction: 'up', label: '2', tone: 'positive', comparison: 'vs last week' },
    sparkline: [1, 2, 1, 2, 1, 0, 2],
    href: routes.doctor.reports,
  },
];

/* ── Statistics cards ───────────────────────────────────────────── */

export interface OverviewStatistic {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly delta?: StatisticDelta;
  readonly caption?: string;
}

export const MOCK_STATISTICS: readonly OverviewStatistic[] = [
  {
    id: 'consultation-duration',
    label: 'Avg. consultation duration',
    value: '24 min',
    delta: { direction: 'down', label: '2 min', tone: 'positive', comparison: 'vs last month' },
  },
  {
    id: 'response-time',
    label: 'Request response time',
    value: '1.8 h',
    delta: { direction: 'flat', label: '0.0 h', tone: 'neutral', comparison: 'vs last month' },
  },
  {
    id: 'no-show-rate',
    label: 'No-show rate (30d)',
    value: '4.2%',
    delta: { direction: 'up', label: '0.6%', tone: 'negative', comparison: 'vs last month' },
  },
];

/* ── Today's schedule (upcoming appointments placeholder) ───────── */

export interface ScheduleEntry {
  readonly id: string;
  readonly time: string;
  readonly patientName: string;
  readonly patientAge: number;
  readonly visitType: string;
  readonly status: StatusKind;
  readonly statusLabel: string;
  /** The next upcoming appointment is highlighted (UX 2.1). */
  readonly isNext?: boolean;
}

export const MOCK_SCHEDULE: readonly ScheduleEntry[] = [
  {
    id: 'a1',
    time: '09:00',
    patientName: 'Khaled Nassar',
    patientAge: 52,
    visitType: 'Follow-up',
    status: 'completed',
    statusLabel: 'Completed',
  },
  {
    id: 'a2',
    time: '09:45',
    patientName: 'Mona Adel',
    patientAge: 29,
    visitType: 'Consultation',
    status: 'completed',
    statusLabel: 'Completed',
  },
  {
    id: 'a3',
    time: '10:30',
    patientName: 'Amira Saleh',
    patientAge: 34,
    visitType: 'Follow-up',
    status: 'confirmed',
    statusLabel: 'Confirmed',
    isNext: true,
  },
  {
    id: 'a4',
    time: '11:15',
    patientName: 'Omar Farouk',
    patientAge: 61,
    visitType: 'Lab review',
    status: 'confirmed',
    statusLabel: 'Confirmed',
  },
  {
    id: 'a5',
    time: '13:00',
    patientName: 'Layla Mansour',
    patientAge: 45,
    visitType: 'Consultation',
    status: 'pending',
    statusLabel: 'Pending',
  },
];

/* ── Recent activity feed ───────────────────────────────────────── */

export interface ActivityEntry {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly text: string;
  readonly time: string;
  readonly href: string;
}

/**
 * The doctor's own clinical work, in the server's three kinds and its
 * `detail — patient` wording (`dashboard.repository.ts`), so the demo shows
 * nothing a live feed could never contain.
 */
export const MOCK_ACTIVITY: readonly ActivityEntry[] = [
  {
    id: 'act1',
    icon: ACTIVITY_PRESENTATION['note-signed'].icon,
    text: 'Consultation note signed — Khaled Nassar',
    time: '20 min ago',
    href: ACTIVITY_PRESENTATION['note-signed'].href,
  },
  {
    id: 'act2',
    icon: ACTIVITY_PRESENTATION['prescription-issued'].icon,
    text: 'Prescription issued — Amoxicillin 500 mg — Mona Adel',
    time: '1 h ago',
    href: ACTIVITY_PRESENTATION['prescription-issued'].href,
  },
  {
    id: 'act3',
    icon: ACTIVITY_PRESENTATION['lab-released'].icon,
    text: 'Lab result released — Basic metabolic panel — Omar Farouk',
    time: '2 h ago',
    href: ACTIVITY_PRESENTATION['lab-released'].href,
  },
];

/* ── Analytics charts (UX 2.1 Row 3) ────────────────────────────── */

/** Completed vs cancelled appointments per day, last 14 days. */
export const MOCK_APPOINTMENTS_TREND: readonly NamedSeries[] = [
  {
    name: 'Completed',
    tone: 'primary',
    points: [
      { label: '5', value: 4 },
      { label: '6', value: 5 },
      { label: '7', value: 3 },
      { label: '8', value: 5 },
      { label: '9', value: 4 },
      { label: '10', value: 2 },
      { label: '11', value: 0 },
      { label: '12', value: 4 },
      { label: '13', value: 5 },
      { label: '14', value: 4 },
      { label: '15', value: 5 },
      { label: '16', value: 3 },
      { label: '17', value: 4 },
      { label: '18', value: 2 },
    ],
  },
  {
    name: 'Cancelled',
    tone: 'error',
    points: [
      { label: '5', value: 1 },
      { label: '6', value: 0 },
      { label: '7', value: 1 },
      { label: '8', value: 0 },
      { label: '9', value: 0 },
      { label: '10', value: 1 },
      { label: '11', value: 0 },
      { label: '12', value: 0 },
      { label: '13', value: 1 },
      { label: '14', value: 0 },
      { label: '15', value: 0 },
      { label: '16', value: 1 },
      { label: '17', value: 0 },
      { label: '18', value: 0 },
    ],
  },
];

/** Post-visit survey ratings, current month — the server's five buckets. */
export const MOCK_SATISFACTION: readonly Slice[] = satisfactionSlices([
  { rating: 1, count: 1 },
  { rating: 2, count: 1 },
  { rating: 3, count: 3 },
  { rating: 4, count: 9 },
  { rating: 5, count: 18 },
]);

/* ── Notifications widget (placeholder) ─────────────────────────── */

export interface OverviewNotification {
  readonly id: string;
  readonly status: StatusKind;
  readonly statusLabel: string;
  readonly text: string;
  readonly time: string;
  /** Where acting on it happens — the page that owns the object. */
  readonly href?: string;
}

export const MOCK_NOTIFICATIONS: readonly OverviewNotification[] = [
  {
    id: 'note1',
    status: 'critical',
    statusLabel: 'Critical',
    text: 'Potassium 6.1 mmol/L — Omar Farouk, awaiting review',
    time: '12 min ago',
  },
  {
    id: 'note2',
    status: 'pending',
    statusLabel: 'Request',
    text: 'Layla Mansour requested Thu 10:30 — needs your decision',
    time: '25 min ago',
  },
  {
    id: 'note3',
    status: 'info',
    statusLabel: 'Message',
    text: 'Amira Saleh sent a new message',
    time: '1 h ago',
  },
  {
    id: 'note4',
    status: 'confirmed',
    statusLabel: 'Confirmed',
    text: 'Khaled Nassar confirmed today’s 15:00 appointment',
    time: '2 h ago',
  },
];
