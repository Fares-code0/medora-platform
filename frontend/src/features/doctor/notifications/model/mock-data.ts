import {
  MOCK_PATIENTS,
  mulberry32,
  pick,
  weighted,
} from '@/features/shared-domain/patient-identity';

import {
  NO_RELATED,
  type Conversation,
  type ChatMessage,
  type DoctorNotification,
  type NotificationCategory,
  type NotificationKind,
  type NotificationPriority,
  type NotificationRelated,
} from './types';

/**
 * PHASE 11 MOCK DATA — deterministic notifications and conversations
 * drawn from the shared patient roster, so related patients/records/
 * labs/prescriptions stay coherent with the Phase 3–8 modules ("View
 * patient" lands on a real profile; entity links deep-link into the
 * matching module filtered by patient). Generated with a seeded PRNG so
 * every session sees the same dataset; the store overlays user actions
 * (read/archive/pin/…) in localStorage.
 */

const HOUR_MS = 3_600_000;

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

/* ── Notification templates per category ────────────────────────── */

interface NotificationTemplate {
  readonly category: NotificationCategory;
  readonly kind: NotificationKind;
  readonly title: string;
  /** `{patient}` is substituted with the related patient's name. */
  readonly body: string;
  readonly sender: string;
  readonly priorityWeights: ReadonlyArray<readonly [NotificationPriority, number]>;
  /** Which related entity ids the template carries. */
  readonly relates: ReadonlyArray<'patient' | 'record' | 'lab' | 'prescription' | 'appointment'>;
}

const TEMPLATES: readonly NotificationTemplate[] = [
  {
    category: 'laboratory',
    kind: 'alert',
    title: 'Critical lab result released',
    body: 'A critical value was verified for {patient}. Review the result and acknowledge the critical flag.',
    sender: 'Laboratory system',
    priorityWeights: [
      ['critical', 80],
      ['important', 20],
    ],
    relates: ['patient', 'lab'],
  },
  {
    category: 'laboratory',
    kind: 'update',
    title: 'Lab results available',
    body: 'Results for {patient} are verified and ready for review.',
    sender: 'Laboratory system',
    priorityWeights: [
      ['normal', 70],
      ['important', 30],
    ],
    relates: ['patient', 'lab'],
  },
  {
    category: 'appointments',
    kind: 'reminder',
    title: 'Upcoming appointment',
    body: 'You have an appointment with {patient} tomorrow. Review the visit reason and recent notes.',
    sender: 'Scheduling',
    priorityWeights: [
      ['normal', 80],
      ['important', 20],
    ],
    relates: ['patient', 'appointment'],
  },
  {
    category: 'appointments',
    kind: 'update',
    title: 'Appointment request',
    body: '{patient} requested a follow-up visit. Confirm or propose a new time.',
    sender: 'Scheduling',
    priorityWeights: [
      ['normal', 60],
      ['important', 40],
    ],
    relates: ['patient', 'appointment'],
  },
  {
    category: 'pharmacy',
    kind: 'alert',
    title: 'Refill approval pending',
    body: 'A refill request from {patient} is awaiting your approval.',
    sender: 'Pharmacy',
    priorityWeights: [
      ['important', 70],
      ['normal', 30],
    ],
    relates: ['patient', 'prescription'],
  },
  {
    category: 'pharmacy',
    kind: 'alert',
    title: 'Interaction warning on new prescription',
    body: 'A potential drug interaction was flagged for {patient}. Review before dispensing continues.',
    sender: 'Pharmacy safety screen',
    priorityWeights: [
      ['critical', 50],
      ['important', 50],
    ],
    relates: ['patient', 'prescription'],
  },
  {
    category: 'medical-records',
    kind: 'update',
    title: 'Record awaiting signature',
    body: 'The encounter record for {patient} is complete and awaiting your signature.',
    sender: 'Records',
    priorityWeights: [
      ['normal', 60],
      ['important', 40],
    ],
    relates: ['patient', 'record'],
  },
  {
    category: 'patients',
    kind: 'update',
    title: 'New patient assigned',
    body: '{patient} was assigned to your care. Review the profile and intake summary.',
    sender: 'Admissions',
    priorityWeights: [
      ['normal', 85],
      ['important', 15],
    ],
    relates: ['patient'],
  },
  {
    category: 'ai',
    kind: 'update',
    title: 'AI summary ready',
    body: 'The assistant finished a medication review for {patient}. Open the conversation to review the draft.',
    sender: 'Medora AI',
    priorityWeights: [
      ['normal', 90],
      ['important', 10],
    ],
    relates: ['patient'],
  },
  {
    category: 'system',
    kind: 'update',
    title: 'Scheduled maintenance window',
    body: 'Medora will run maintenance Saturday 02:00–03:00. No downtime is expected.',
    sender: 'Medora platform',
    priorityWeights: [['normal', 100]],
    relates: [],
  },
  {
    category: 'system',
    kind: 'reminder',
    title: 'Complete your quarterly compliance module',
    body: 'The Q3 clinical-documentation module is due by the end of the month.',
    sender: 'Medora platform',
    priorityWeights: [
      ['normal', 80],
      ['important', 20],
    ],
    relates: [],
  },
  {
    category: 'security',
    kind: 'alert',
    title: 'New sign-in to your account',
    body: 'A new sign-in from Chrome on Windows was detected. If this was not you, secure your account now.',
    sender: 'Security',
    priorityWeights: [
      ['important', 70],
      ['critical', 30],
    ],
    relates: [],
  },
];

/* ── Builder ────────────────────────────────────────────────────── */

const TOTAL_NOTIFICATIONS = 5;

function buildRelated(
  template: NotificationTemplate,
  index: number,
  random: () => number,
): NotificationRelated {
  if (template.relates.length === 0) return NO_RELATED;
  const patient = pick(MOCK_PATIENTS, random());
  return {
    patientId: template.relates.includes('patient') ? patient.id : null,
    patientName: template.relates.includes('patient') ? patient.name : null,
    recordId: template.relates.includes('record') ? `MR-${String(10_001 + (index % 5))}` : null,
    labId: template.relates.includes('lab') ? `LAB-${String(100_001 + (index % 5))}` : null,
    prescriptionId: template.relates.includes('prescription')
      ? `RX-${String(200_001 + (index % 5))}`
      : null,
    appointmentId: template.relates.includes('appointment')
      ? `APT-${String(3_001 + (index % 5))}`
      : null,
  };
}

function buildNotification(index: number, random: () => number): DoctorNotification {
  const template = pick(TEMPLATES, random());
  // Every ~9th notification is minutes old (keeps the "Today" card
  // populated whatever the wall-clock time); the rest spread ~14 days.
  const ageHours = index % 9 === 0 ? random() * 0.8 : 1 + Math.floor(random() * 14 * 24);
  const related = buildRelated(template, index, random);
  const read = ageHours > 48 ? random() < 0.85 : random() < 0.35;

  return {
    id: `NTF-${String(5_001 + index)}`,
    title: template.title,
    body: template.body.replace('{patient}', related.patientName ?? 'a patient'),
    category: template.category,
    priority: weighted(template.priorityWeights, random()),
    kind: template.kind,
    sender: template.sender,
    createdAt: hoursAgoIso(ageHours),
    read,
    archived: read && random() < 0.15,
    favorite: random() < 0.08,
    pinned: index % 23 === 0,
    related,
  };
}

const random = mulberry32(0xbe11_f00d);

export const SEED_NOTIFICATIONS: readonly DoctorNotification[] = Array.from(
  { length: TOTAL_NOTIFICATIONS },
  (_, index) => buildNotification(index, random),
);

/**
 * The "realtime" arrival: delivered once by the polling seam a short
 * while after first load, so the unread badge visibly updates everywhere.
 */
export function buildIncomingNotification(): DoctorNotification {
  // Omar Farouk — his completed metabolic panel carries the critical
  // potassium, so the live arrival matches the seeded lab data.
  const patient = MOCK_PATIENTS[3];
  return {
    id: 'NTF-LIVE-1',
    title: 'Lab results available',
    body: `Results for ${patient?.name ?? 'a patient'} are verified and ready for review.`,
    category: 'laboratory',
    priority: 'important',
    kind: 'alert',
    sender: 'Laboratory system',
    createdAt: new Date().toISOString(),
    read: false,
    archived: false,
    favorite: false,
    pinned: false,
    related: {
      ...NO_RELATED,
      patientId: patient?.id ?? null,
      patientName: patient?.name ?? null,
      labId: 'LAB-100017',
    },
  };
}

/* ── Conversations ──────────────────────────────────────────────── */

function message(id: string, from: string, body: string, hoursAgo: number): ChatMessage {
  return { id, from, body, at: hoursAgoIso(hoursAgo) };
}

export const SEED_CONVERSATIONS: readonly Conversation[] = [
  {
    id: 'conv-omar',
    name: 'Dr. Omar Khalil',
    kind: 'direct',
    caption: 'Cardiology',
    readOnly: false,
    unreadCount: 2,
    messages: [
      message('m-omar-1', 'me', 'Omar, did you see the echo report for Khaled Nassar?', 26),
      message(
        'm-omar-2',
        'Dr. Omar Khalil',
        'Just reviewed it — EF is preserved, mild MR. Nothing urgent.',
        25,
      ),
      message(
        'm-omar-3',
        'Dr. Omar Khalil',
        'I would repeat the echo in 12 months unless symptoms change. Happy to see him in clinic if you prefer.',
        3,
      ),
      message('m-omar-4', 'Dr. Omar Khalil', 'Also — are you covering Thursday grand rounds?', 2),
    ],
  },
  {
    id: 'conv-salma',
    name: 'Dr. Salma Ibrahim',
    kind: 'direct',
    caption: 'Endocrinology',
    readOnly: false,
    unreadCount: 1,
    messages: [
      message(
        'm-salma-1',
        'Dr. Salma Ibrahim',
        'Thanks for the referral. I started her on levothyroxine 50 mcg and will recheck TSH in 6 weeks.',
        50,
      ),
      message('m-salma-2', 'me', 'Perfect — I will keep an eye on the repeat labs.', 49),
      message(
        'm-salma-3',
        'Dr. Salma Ibrahim',
        'Repeat TSH is back: 3.1 — nicely in range. No dose change needed.',
        6,
      ),
    ],
  },
  {
    id: 'conv-youssef',
    name: 'Dr. Youssef Nabil',
    kind: 'direct',
    caption: 'Pulmonology',
    readOnly: false,
    unreadCount: 0,
    messages: [
      message(
        'm-youssef-1',
        'Dr. Youssef Nabil',
        'Spirometry slots are open Wednesday AM if you have referrals.',
        74,
      ),
      message('m-youssef-2', 'me', 'Great, sending two your way today.', 73),
    ],
  },
  {
    id: 'conv-announcements',
    name: 'All-staff announcements',
    kind: 'announcement',
    caption: 'Hospital administration',
    readOnly: true,
    unreadCount: 1,
    messages: [
      message(
        'm-ann-1',
        'Hospital administration',
        'The new sepsis pathway goes live Monday. Pocket cards are available at every nursing station.',
        30,
      ),
      message(
        'm-ann-2',
        'Hospital administration',
        'Reminder: annual fire-safety training must be completed by the end of this month.',
        8,
      ),
    ],
  },
  {
    id: 'conv-system',
    name: 'System alerts',
    kind: 'system',
    caption: 'Medora platform',
    readOnly: true,
    unreadCount: 0,
    messages: [
      message(
        'm-sys-1',
        'Medora platform',
        'Maintenance completed successfully. All services are operating normally.',
        96,
      ),
    ],
  },
];

/** Deterministic canned reply for direct conversations (mock chat). */
export function buildAutoReply(conversationName: string): string {
  return `Thanks — noted. I'll take a look and get back to you shortly. (${conversationName}, mock auto-reply)`;
}
