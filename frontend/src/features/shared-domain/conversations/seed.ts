import type { ChatMessage, Contact, Conversation } from './types';

/**
 * PHASE 14 MOCK DATA — five contacts and five conversations built from
 * the canonical dataset (the four colleague doctors from the shared
 * roster's DOCTORS list and patient Mona Adel PT-1002). Threads reference
 * the same seeded entities as the rest of the app: Layla Mansour's
 * cardiology referral, Khaled Nassar's HbA1c (LAB-100001), Omar Farouk's
 * critical potassium (LAB-100004), and Mona's Amoxicillin course
 * (RX-200002). Timestamps are relative to "now" so recency labels stay
 * meaningful. Replaced by the messaging endpoints in a later phase.
 */

const MINUTE_MS = 60_000;

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE_MS).toISOString();
}

const H = 60;
const D = 24 * 60;

export const SEED_CONTACTS: readonly Contact[] = [
  {
    id: 'ct-omar-khalil',
    name: 'Dr. Omar Khalil',
    role: 'doctor',
    department: 'Cardiology',
    presence: 'online',
    lastActiveAt: minutesAgoIso(2),
    favorite: true,
  },
  {
    id: 'ct-salma-ibrahim',
    name: 'Dr. Salma Ibrahim',
    role: 'doctor',
    department: 'Endocrinology',
    presence: 'away',
    lastActiveAt: minutesAgoIso(45),
    favorite: true,
  },
  {
    id: 'ct-youssef-nabil',
    name: 'Dr. Youssef Nabil',
    role: 'doctor',
    department: 'Nephrology',
    presence: 'online',
    lastActiveAt: minutesAgoIso(6),
    favorite: false,
  },
  {
    id: 'ct-amira-hassan',
    name: 'Dr. Amira Hassan',
    role: 'doctor',
    department: 'Internal Medicine',
    presence: 'offline',
    lastActiveAt: minutesAgoIso(9 * H),
    favorite: false,
  },
  {
    // Named by record id, not by name (ADM-04 convention) — this id
    // reaches the PHI access log verbatim as `subjectId` whenever an
    // admin reveals this contact's identity in Communications, so it
    // must never carry the patient's own name.
    id: 'ct-pt-1002',
    name: 'Mona Adel',
    role: 'patient',
    patientId: 'PT-1002',
    department: 'Patient portal',
    presence: 'online',
    lastActiveAt: minutesAgoIso(12),
    favorite: false,
  },
];

function msg(partial: Omit<ChatMessage, 'kind' | 'status'> & Partial<ChatMessage>): ChatMessage {
  return { kind: 'text', status: 'read', ...partial };
}

/* ── cv-referral: Dr. Omar Khalil · Layla Mansour referral ───────── */

const REFERRAL_MESSAGES: readonly ChatMessage[] = [
  msg({
    id: 'm-r1',
    authorId: 'me',
    body: 'Omar, I am referring **Layla Mansour** (MRN 4485-33) to you — exertional chest tightness on top of her known CAD. Her statin lapsed in April.',
    sentAt: minutesAgoIso(1 * D + 2 * H),
  }),
  msg({
    id: 'm-r2',
    authorId: 'ct-omar-khalil',
    body: 'Thanks — I can see her Thursday morning. Any recent lipids?',
    sentAt: minutesAgoIso(1 * D + 1 * H),
  }),
  msg({
    id: 'm-r3',
    authorId: 'me',
    body: 'Last panel was `LAB-100005` — collected today, results pending. I will forward them as soon as they are released.',
    sentAt: minutesAgoIso(1 * D),
  }),
  msg({
    id: 'm-r4',
    authorId: 'ct-omar-khalil',
    body: 'Perfect. Booking guidance for her is here: https://medora.health/referrals/cardiology',
    sentAt: minutesAgoIso(50),
    status: 'delivered',
  }),
  msg({
    id: 'm-r5',
    authorId: 'ct-omar-khalil',
    body: 'Also — does she still take **Atorvastatin 80 mg**? The pharmacy record shows the course expired.',
    sentAt: minutesAgoIso(35),
    status: 'delivered',
  }),
];

/* ── cv-hba1c: Dr. Salma Ibrahim · Khaled Nassar HbA1c ───────────── */

const HBA1C_MESSAGES: readonly ChatMessage[] = [
  msg({
    id: 'm-h1',
    authorId: 'ct-salma-ibrahim',
    body: 'Did you see Khaled Nassar’s HbA1c from last week?',
    sentAt: minutesAgoIso(4 * D + 3 * H),
  }),
  msg({
    id: 'm-h2',
    authorId: 'me',
    body: 'Yes — attached the released report. Trending down since we moved him to **Metformin 850 mg** three times daily.',
    sentAt: minutesAgoIso(4 * D + 2 * H),
    attachments: [
      { id: 'att-hba1c', kind: 'file', name: 'LAB-100001-hba1c-report.pdf', sizeLabel: '184 KB' },
    ],
  }),
  msg({
    id: 'm-h3',
    authorId: 'ct-salma-ibrahim',
    body: 'Nice trajectory. Keep the dose, recheck in 3 months.',
    sentAt: minutesAgoIso(4 * D + 1 * H),
  }),
  msg({
    id: 'm-h4',
    authorId: 'me',
    body: 'Agreed — follow-up ordered. Thanks, Salma.',
    sentAt: minutesAgoIso(4 * D),
  }),
];

/* ── cv-careteam: group · Omar Farouk critical potassium ─────────── */

const CARE_TEAM_MESSAGES: readonly ChatMessage[] = [
  msg({
    id: 'm-c1',
    authorId: 'ct-youssef-nabil',
    kind: 'system',
    body: 'Dr. Youssef Nabil created this care-team thread for Omar Farouk (MRN 4472-90).',
    sentAt: minutesAgoIso(2 * D + 6 * H),
  }),
  msg({
    id: 'm-c2',
    authorId: 'ct-youssef-nabil',
    body: 'Flagging Omar Farouk — CKD stage 3, and yesterday’s metabolic panel (`LAB-100004`) came back with a **critical potassium of 6.1 mmol/L**.',
    sentAt: minutesAgoIso(2 * D + 5 * H),
  }),
  msg({
    id: 'm-c3',
    authorId: 'me',
    body: 'Seen. Repeat sample is with the lab to rule out hemolysis. Holding his ACE inhibitor in the meantime.',
    sentAt: minutesAgoIso(2 * D + 4 * H),
  }),
  msg({
    id: 'm-c4',
    authorId: 'ct-amira-hassan',
    kind: 'system',
    body: 'Dr. Amira Hassan joined the thread.',
    sentAt: minutesAgoIso(2 * D + 3 * H),
  }),
  msg({
    id: 'm-c5',
    authorId: 'ct-amira-hassan',
    body: 'Covering tonight — what is the escalation threshold?',
    sentAt: minutesAgoIso(2 * D + 2 * H),
  }),
  msg({
    id: 'm-c6',
    authorId: 'ct-youssef-nabil',
    body: 'Protocol for tonight:\n```\nK+ 5.5–5.9  recheck in 6 h, dietary restriction\nK+ 6.0–6.4  ECG + calcium gluconate if changes\nK+ ≥ 6.5    escalate to on-call nephrology\n```',
    sentAt: minutesAgoIso(2 * D + 1 * H),
  }),
  msg({
    id: 'm-c7',
    authorId: 'me',
    body: 'ECG from this morning attached — no peaked T waves.',
    sentAt: minutesAgoIso(1 * D + 6 * H),
    attachments: [{ id: 'att-ecg', kind: 'image', name: 'omar-farouk-ecg.png', sizeLabel: '1.2 MB' }],
  }),
  msg({
    id: 'm-c8',
    authorId: 'ct-youssef-nabil',
    body: 'Good. Renal diet guidance for the family: https://medora.health/guides/renal-diet',
    sentAt: minutesAgoIso(1 * D + 4 * H),
  }),
  msg({
    id: 'm-c9',
    authorId: 'ct-amira-hassan',
    body: 'Overnight recheck was **5.4 mmol/L** — trending the right way.',
    sentAt: minutesAgoIso(7 * H),
  }),
  msg({
    id: 'm-c10',
    authorId: 'ct-youssef-nabil',
    body: 'Let’s keep the hold on the ACE inhibitor until Friday’s panel, then reassess together.',
    sentAt: minutesAgoIso(3 * H),
    status: 'delivered',
  }),
  // ADM-06B Task 3: seeded for `phi-wrong-channel` — a bare record id
  // dropped into chat instead of the record system, see flag-rules.ts.
  msg({
    id: 'm-c11',
    authorId: 'ct-amira-hassan',
    body: 'Cross-check against PT-1004 before the panel on Friday.',
    sentAt: minutesAgoIso(2 * H),
    status: 'read',
  }),
];

/* ── cv-portal: patient · Amoxicillin question ────────────────────── */

const MONA_MESSAGES: readonly ChatMessage[] = [
  msg({
    id: 'm-m1',
    authorId: 'ct-pt-1002',
    body: 'Hello Doctor, I started the Amoxicillin today (RX-200002). Should I take it before or after meals?',
    sentAt: minutesAgoIso(5 * H),
  }),
  msg({
    id: 'm-m2',
    authorId: 'me',
    body: 'Hi Mona — with or without food is fine. Please complete the **full 7-day course** even if you feel better sooner.',
    sentAt: minutesAgoIso(4 * H),
  }),
  msg({
    id: 'm-m3',
    authorId: 'ct-pt-1002',
    body: 'Understood, thank you! One more thing — is drowsiness normal? I felt sleepy after the first capsule.',
    sentAt: minutesAgoIso(25),
    status: 'delivered',
  }),
  // ADM-06B Task 3: seeded so the safety-flag rules have something to
  // trip in the shared corpus — see flag-rules.ts's `prescription-
  // solicitation` rule and its own test lock in flag-rules.test.ts.
  msg({
    id: 'm-m4',
    authorId: 'ct-pt-1002',
    body: 'Could you send tramadol without a prescription? The pain is bad.',
    sentAt: minutesAgoIso(15),
    status: 'read',
  }),
  // ADM-06B Task 3: seeded for `emergency-language` — kept as the most
  // recent message in the thread so an unresolved "right now" complaint
  // reads as current, not stale.
  msg({
    id: 'm-m5',
    authorId: 'ct-pt-1002',
    body: 'I have severe chest pain right now and it is not going away.',
    sentAt: minutesAgoIso(5),
    status: 'read',
  }),
];

/* ── cv-coverage: Dr. Amira Hassan · archived hand-over ──────────── */

const COVERAGE_MESSAGES: readonly ChatMessage[] = [
  msg({
    id: 'm-v1',
    authorId: 'ct-amira-hassan',
    body: 'Hand-over notes for the weekend are in the shared folder. Anything urgent on your list?',
    sentAt: minutesAgoIso(9 * D + 5 * H),
  }),
  msg({
    id: 'm-v2',
    authorId: 'me',
    body: 'Only Amira Saleh’s thyroid panel (`LAB-100003`) — still processing, results expected Monday.',
    sentAt: minutesAgoIso(9 * D + 4 * H),
  }),
  msg({
    id: 'm-v3',
    authorId: 'ct-amira-hassan',
    body: 'Noted. Have a good weekend!',
    sentAt: minutesAgoIso(9 * D + 3 * H),
  }),
];

export const SEED_CONVERSATIONS: readonly Conversation[] = [
  {
    id: 'cv-referral',
    participantIds: ['ct-omar-khalil'],
    topic: null,
    messages: REFERRAL_MESSAGES,
    unreadCount: 2,
    pinned: true,
    starred: false,
    archived: false,
    muted: false,
    draft: '',
    lastActivityAt: minutesAgoIso(35),
  },
  {
    id: 'cv-careteam',
    participantIds: ['ct-youssef-nabil', 'ct-amira-hassan'],
    topic: 'Care team — Omar Farouk',
    messages: CARE_TEAM_MESSAGES,
    unreadCount: 1,
    pinned: false,
    starred: true,
    archived: false,
    muted: false,
    draft: '',
    lastActivityAt: minutesAgoIso(2 * H),
  },
  {
    id: 'cv-portal',
    participantIds: ['ct-pt-1002'],
    topic: null,
    messages: MONA_MESSAGES,
    unreadCount: 1,
    pinned: false,
    starred: false,
    archived: false,
    muted: false,
    draft: 'Mild drowsiness can happen in the first day or two — ',
    lastActivityAt: minutesAgoIso(5),
  },
  {
    id: 'cv-hba1c',
    participantIds: ['ct-salma-ibrahim'],
    topic: null,
    messages: HBA1C_MESSAGES,
    unreadCount: 0,
    pinned: false,
    starred: true,
    archived: false,
    muted: false,
    draft: '',
    lastActivityAt: minutesAgoIso(4 * D),
  },
  {
    id: 'cv-coverage',
    participantIds: ['ct-amira-hassan'],
    topic: null,
    messages: COVERAGE_MESSAGES,
    unreadCount: 0,
    pinned: false,
    starred: false,
    archived: true,
    muted: true,
    draft: '',
    lastActivityAt: minutesAgoIso(9 * D + 3 * H),
  },
];
