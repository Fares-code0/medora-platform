/**
 * Doctor Administration Center — domain types (Phase 17).
 * The clinic-management area owned by the doctor (distinct from the System
 * Admin Panel). Every dataset here is mock-backed and capped at five records
 * per the phase brief; the shapes mirror what a real clinic API would return
 * so the query layer can be swapped without touching the views.
 */

import type { AdminSectionSlug } from '@/routes';

export type { AdminSectionSlug };

/* ── Shared vocabularies ──────────────────────────────────────── */

export type StaffRole = 'doctor' | 'nurse' | 'receptionist' | 'laboratory' | 'pharmacy';

export type PresenceStatus = 'on-duty' | 'on-break' | 'off-duty' | 'on-leave';

export type RoomKind = 'consultation' | 'lab' | 'procedure' | 'pharmacy' | 'waiting';

export type RoomStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance';

export type ActiveStatus = 'active' | 'inactive';

export type ShiftKind = 'morning' | 'evening' | 'on-call' | 'vacation' | 'leave';

export type QueuePriority = 'routine' | 'priority' | 'urgent';

export type AnnouncementPriority = 'low' | 'normal' | 'high';

export type TemplateKind =
  'prescription' | 'certificate' | 'referral' | 'lab-request' | 'radiology-request' | 'discharge';

/* ── Records ──────────────────────────────────────────────────── */

export interface StaffMember {
  readonly id: string;
  readonly name: string;
  readonly role: StaffRole;
  readonly title: string;
  readonly departmentId: string;
  readonly status: PresenceStatus;
  readonly phone: string;
  readonly email: string;
  readonly workingHours: string;
  readonly permissions: readonly string[];
  readonly avatarUrl?: string | undefined;
}

export interface Department {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: ActiveStatus;
  readonly headStaffId: string;
  readonly staffCount: number;
}

export interface Room {
  readonly id: string;
  readonly name: string;
  readonly kind: RoomKind;
  readonly status: RoomStatus;
  readonly departmentId: string;
  readonly capacity: number;
  readonly note?: string | undefined;
}

export interface Resource {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly location: string;
  readonly quantity: number;
  readonly reorderLevel: number;
  readonly status: 'in-stock' | 'low' | 'out';
}

export interface WorkingDay {
  readonly day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  readonly open: boolean;
  readonly start: string;
  readonly end: string;
  readonly breakLabel?: string | undefined;
}

export interface Holiday {
  readonly id: string;
  readonly name: string;
  readonly date: string;
  readonly kind: 'public' | 'clinic';
  readonly recurring: boolean;
}

export interface ShiftAssignment {
  readonly id: string;
  readonly staffId: string;
  readonly kind: ShiftKind;
  /** Index 0 = Monday … 6 = Sunday. */
  readonly days: readonly boolean[];
}

export interface QueueEntry {
  readonly id: string;
  readonly ticket: string;
  /**
   * D-27b attribution. The row was blocked on exactly these three fields:
   * a doctor-scoped board cannot exist while an entry says only which
   * *patient* is waiting.
   */
  readonly clinicId: string;
  readonly doctorId: string;
  /** The record id. `patientName` is for display; this is for identity. */
  readonly patientId: string;
  readonly patientName: string;
  readonly reason: string;
  readonly priority: QueuePriority;
  readonly waitingMinutes: number;
  readonly estimatedMinutes: number;
  readonly roomId?: string | undefined;
  readonly delayed: boolean;
}

export interface WaitingPatient {
  readonly id: string;
  /** D-27b attribution — see `QueueEntry`. */
  readonly clinicId: string;
  readonly doctorId: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly appointmentTime: string;
  readonly checkedInAt: string;
  readonly waitingMinutes: number;
  readonly area: string;
  readonly status: 'waiting' | 'called' | 'in-room';
}

export interface Announcement {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly priority: AnnouncementPriority;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly expiresAt?: string | undefined;
}

export interface Policy {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly summary: string;
  readonly updatedAt: string;
  readonly version: string;
}

export interface DocumentTemplate {
  readonly id: string;
  readonly name: string;
  readonly kind: TemplateKind;
  readonly description: string;
  readonly updatedAt: string;
  readonly usageCount: number;
  readonly archived: boolean;
}

/* ── Overview / dashboard aggregate ───────────────────────────── */

export interface ClinicOverview {
  readonly clinicName: string;
  readonly todaysPatients: number;
  readonly todaysAppointments: number;
  readonly waitingPatients: number;
  readonly completedVisits: number;
  readonly cancelledAppointments: number;
  /** 0–100 doctor utilization. */
  readonly doctorUtilization: number;
  readonly averageWaitingMinutes: number;
  /** 0–100 clinic room occupancy. */
  readonly clinicOccupancy: number;
  /** Appointments completed per hour bucket, for the activity strip. */
  readonly hourlyActivity: readonly { readonly hour: string; readonly count: number }[];
}

/* ── Platform status (executive dashboard + audit) ────────────── */

export interface AuditEvent {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  /**
   * A record reference (patient MRN, ticket id, backup name, …) — never a
   * patient name. This is free text rendered verbatim wherever the audit log
   * is shown (the admin home feed, the security-alert summary), with no
   * masking and no capability check in front of it, unlike every other place
   * a patient identifier reaches the admin area. The only thing that keeps
   * PHI out of it is what goes in at the write site, so every writer — seed
   * data included — must name the record, not the person.
   */
  readonly target: string;
  readonly at: string;
  readonly severity: 'info' | 'warning' | 'critical';
}

/* ── PHI access (ADM-10, UX §1.5.1 + §1.5.6) ──────────────────── */

/**
 * Why an administrator unmasked a patient identifier. The categories are a
 * closed set on purpose: free text alone is not reviewable, and "because I
 * needed to" is what an open field collects.
 */
export type PhiJustificationCategory =
  | 'clinical-review'
  | 'patient-request'
  | 'safety-investigation'
  | 'billing-dispute'
  | 'legal-request';

/**
 * One justified unmasking. Written before the value is shown, never after —
 * an access that failed to log is an access that did not happen.
 */
export interface PhiAccessEvent {
  readonly id: string;
  readonly actor: string;
  /** The record whose identifiers were unmasked (queue entry, patient, …). */
  readonly subjectId: string;
  /** A non-identifying label for the record, e.g. "Queue ticket A-104". */
  readonly subjectLabel: string;
  readonly category: PhiJustificationCategory;
  readonly reason: string;
  readonly at: string;
  /** Minutes the elevation was granted for. */
  readonly durationMinutes: number;
}

export interface RegistrationEntry {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly registeredAt: string;
}

export interface SystemHealth {
  readonly status: 'operational' | 'degraded' | 'down';
  readonly uptimePercent: number;
  readonly cpuPercent: number;
  readonly ramPercent: number;
  readonly storageUsedGb: number;
  readonly storageTotalGb: number;
  readonly apiResponseMs: number;
}

export interface LicenseStatus {
  readonly plan: string;
  readonly seatsUsed: number;
  readonly seatsTotal: number;
  readonly renewsOn: string;
}

export interface PlatformStatus {
  readonly revenueMonth: number;
  readonly revenueDeltaPercent: number;
  readonly activeUsers: number;
  readonly doctors: number;
  readonly patients: number;
  readonly departments: number;
  readonly appointmentsMonth: number;
  readonly growthPercent: number;
  readonly system: SystemHealth;
  readonly license: LicenseStatus;
  readonly registrations: readonly RegistrationEntry[];
}

/* ── Global search ────────────────────────────────────────────── */

export interface SearchResult {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly section: AdminSectionSlug;
  /** Overrides the section path (e.g. a specific settings panel). */
  readonly path?: string | undefined;
}
