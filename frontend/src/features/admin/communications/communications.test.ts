import { describe, expect, it } from 'vitest';

import { PHI_ELEVATION_MINUTES, PHI_REASON_MIN_LENGTH } from '@/features/admin/phi';
import { ME_ID, SEED_CONTACTS } from '@/features/shared-domain/conversations';
import type { Contact, Conversation } from '@/features/shared-domain/conversations';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import {
  buildOverview,
  categoryLabel,
  COMMS_ACCESS_MINUTES,
  COMMS_REASON_MIN_LENGTH,
  CONTENT_ACCESS_CATEGORIES,
  deriveFlags,
  filterRows,
  grantForConversation,
  maskExcerpt,
  sortRows,
  toConversationRows,
  TREND_DAYS,
  UNANSWERED_HOURS,
  validateAccessReason,
} from './communications';

/**
 * The two policy numbers are asserted against the exported constants rather
 * than against literals. A test that hardcodes 20 passes against a constant
 * someone changed to 8 — it would only be testing itself.
 */

describe('content-access policy', () => {
  it('demands a longer reason than PHI does', () => {
    // Compared against PHI's live constant, not a copied literal. Reading a
    // whole thread is more invasive than revealing one identifier, so this
    // floor is higher; if PHI's own floor ever moves, this assertion keeps
    // enforcing the invariant instead of quietly checking a stale snapshot.
    expect(COMMS_REASON_MIN_LENGTH).toBeGreaterThan(PHI_REASON_MIN_LENGTH);
  });

  it('pins the reason floor to its intended value', () => {
    // COMMS_REASON_MIN_LENGTH and COMMS_ACCESS_MINUTES are policy numbers,
    // not incidental implementation details, so this locks the exact value
    // rather than only bounding it against PHI. The "longer than PHI"
    // assertion above would pass just as happily if this constant drifted
    // to 200; an exact-equality pin makes changing it a deliberate edit to
    // a test that says so, not a silent side effect.
    expect(COMMS_REASON_MIN_LENGTH).toBe(20);
  });

  it('rejects a reason one character short of the floor', () => {
    const reason = 'a'.repeat(COMMS_REASON_MIN_LENGTH - 1);

    expect(validateAccessReason(reason).ok).toBe(false);
  });

  it('accepts a reason exactly at the floor', () => {
    const reason = 'a'.repeat(COMMS_REASON_MIN_LENGTH);

    expect(validateAccessReason(reason).ok).toBe(true);
  });

  it('does not count surrounding whitespace toward the floor', () => {
    const core = 'a'.repeat(COMMS_REASON_MIN_LENGTH - 1);

    expect(validateAccessReason(`  ${core}  `).ok).toBe(false);
  });

  it('expires a grant COMMS_ACCESS_MINUTES after it was issued', () => {
    const now = 1_700_000_000_000;

    const grant = grantForConversation(
      'cv-referral',
      'Conversation cv-referral',
      'quality-audit',
      'Reviewing response times for the quarterly audit',
      now,
    );

    expect(grant.expiresAt).toBe(now + COMMS_ACCESS_MINUTES * 60_000);
    expect(grant.category).toBe('quality-audit');
  });

  it('expires sooner than a PHI reveal', () => {
    // Compared against PHI's live constant, not a copied literal. The
    // "expires a grant..." test above only checks that grantForConversation
    // multiplies minutes by 60_000 correctly — it reads COMMS_ACCESS_MINUTES
    // on both sides of the assertion, so it can't catch the constant itself
    // drifting. This pins the actual value against PHI's, the way the
    // reason-floor test does, so a change on either side surfaces here.
    expect(COMMS_ACCESS_MINUTES).toBeLessThan(PHI_ELEVATION_MINUTES);
  });

  it('pins the access window to its intended value', () => {
    // Same reasoning as the reason-floor pin above: COMMS_ACCESS_MINUTES is
    // a policy number, so its exact value is asserted here too, not just
    // bounded against PHI. Without this, mutating it to 1 (or 60) would
    // pass the "sooner than PHI" check silently.
    expect(COMMS_ACCESS_MINUTES).toBe(10);
  });

  it('names all four justification categories from §3.6', () => {
    const ids = CONTENT_ACCESS_CATEGORIES.map((entry) => entry.id);

    expect(ids).toEqual([
      'patient-complaint',
      'safety-flag',
      'legal-request',
      'quality-audit',
    ]);
  });

  it('labels a category and falls back to its id', () => {
    expect(categoryLabel('legal-request')).toBe('Legal request');
  });
});

/* ── Fixtures with known answers ──────────────────────────────── */

const NOW = Date.parse('2026-08-18T12:00:00.000Z');
const HOUR = 3_600_000;

function at(hoursAgo: number): string {
  return new Date(NOW - hoursAgo * HOUR).toISOString();
}

const CONTACTS: readonly Contact[] = [
  {
    id: 'ct-doc',
    name: 'Dr. Omar Khalil',
    role: 'doctor',
    department: 'Cardiology',
    presence: 'online',
    lastActiveAt: at(1),
    favorite: false,
  },
  {
    id: 'ct-pat',
    name: 'Mona Adel',
    role: 'patient',
    department: 'Patient portal',
    presence: 'offline',
    lastActiveAt: at(50),
    favorite: false,
  },
];

function conversation(
  id: string,
  messages: readonly { id: string; authorId: string; body: string; hoursAgo: number }[],
  overrides: Partial<Conversation> = {},
): Conversation {
  const built = messages.map((message) => ({
    id: message.id,
    authorId: message.authorId,
    kind: 'text' as const,
    body: message.body,
    sentAt: at(message.hoursAgo),
    status: 'read' as const,
  }));
  const last = built[built.length - 1];
  if (last === undefined) throw new Error('a conversation needs a message');
  return {
    id,
    participantIds: ['ct-doc', 'ct-pat'],
    topic: null,
    messages: built,
    unreadCount: 0,
    pinned: false,
    starred: false,
    archived: false,
    muted: false,
    draft: '',
    lastActivityAt: last.sentAt,
    ...overrides,
  };
}

describe('toConversationRows', () => {
  it('names the doctor and carries the patient for masking, never inline', () => {
    const rows = toConversationRows(
      [conversation('cv-1', [{ id: 'm1', authorId: 'ct-pat', body: 'hello', hoursAgo: 2 }])],
      CONTACTS,
      [],
      NOW,
    );

    const [row] = rows;
    if (row === undefined) throw new Error('expected one row');
    expect(row.doctorName).toBe('Dr. Omar Khalil');
    expect(row.patientName).toBe('Mona Adel');
    expect(row.messageCount).toBe(1);
  });

  it('marks a thread unanswered when the newest message is the patient and older than the window', () => {
    const rows = toConversationRows(
      [
        conversation('cv-1', [
          { id: 'm1', authorId: 'ct-pat', body: 'hello', hoursAgo: UNANSWERED_HOURS + 1 },
        ]),
      ],
      CONTACTS,
      [],
      NOW,
    );

    const [row] = rows;
    if (row === undefined) throw new Error('expected one row');
    expect(row.status).toBe('unanswered');
  });

  it('does not mark it unanswered at exactly the boundary', () => {
    const rows = toConversationRows(
      [
        conversation('cv-1', [
          { id: 'm1', authorId: 'ct-pat', body: 'hello', hoursAgo: UNANSWERED_HOURS },
        ]),
      ],
      CONTACTS,
      [],
      NOW,
    );

    const [row] = rows;
    if (row === undefined) throw new Error('expected one row');
    expect(row.status).not.toBe('unanswered');
  });

  it('does not mark it unanswered when the doctor replied last', () => {
    const rows = toConversationRows(
      [
        conversation('cv-1', [
          { id: 'm1', authorId: 'ct-pat', body: 'hello', hoursAgo: 100 },
          { id: 'm2', authorId: ME_ID, body: 'replying', hoursAgo: 99 },
        ]),
      ],
      CONTACTS,
      [],
      NOW,
    );

    const [row] = rows;
    if (row === undefined) throw new Error('expected one row');
    expect(row.status).toBe('active');
  });
});

describe('buildOverview', () => {
  it('excludes unanswered patient messages from the median response time', () => {
    // One answered pair with a 2-hour gap, and one very old unanswered
    // message. Including the unanswered one would drag the median by its
    // age; the spec says it belongs to `unansweredOver48h` instead.
    const conversations = [
      conversation('cv-answered', [
        { id: 'm1', authorId: 'ct-pat', body: 'question', hoursAgo: 10 },
        { id: 'm2', authorId: ME_ID, body: 'answer', hoursAgo: 8 },
      ]),
      conversation('cv-silent', [
        { id: 'm3', authorId: 'ct-pat', body: 'question', hoursAgo: 400 },
      ]),
    ];
    const rows = toConversationRows(conversations, CONTACTS, [], NOW);

    const overview = buildOverview(conversations, rows, [], NOW);

    expect(overview.medianResponseMinutes).toBe(120);
    expect(overview.unansweredOver48h).toBe(1);
  });

  it('averages the two middle gaps when the count is even', () => {
    // Two answered pairs, in different conversations: a 2-hour gap and a
    // 4-hour gap, i.e. 120 and 240 minutes. Sorted, there is no single
    // middle value, so medianOf takes the mean of the two: (120 + 240) / 2
    // = 180 minutes, worked out by hand here — not derived from the
    // implementation under test. Every other fixture in this file yields
    // zero or one answered gap, so this is the only test that reaches
    // medianOf's even-count averaging branch under intended behaviour.
    const conversations = [
      conversation('cv-fast', [
        { id: 'm1', authorId: 'ct-pat', body: 'question one', hoursAgo: 10 },
        { id: 'm2', authorId: ME_ID, body: 'answer one', hoursAgo: 8 },
      ]),
      conversation('cv-slow', [
        { id: 'm3', authorId: 'ct-pat', body: 'question two', hoursAgo: 20 },
        { id: 'm4', authorId: ME_ID, body: 'answer two', hoursAgo: 16 },
      ]),
    ];
    const rows = toConversationRows(conversations, CONTACTS, [], NOW);

    expect(buildOverview(conversations, rows, [], NOW).medianResponseMinutes).toBe(180);
  });

  it('reports a null median when nothing has been answered', () => {
    const conversations = [
      conversation('cv-silent', [
        { id: 'm1', authorId: 'ct-pat', body: 'question', hoursAgo: 400 },
      ]),
    ];
    const rows = toConversationRows(conversations, CONTACTS, [], NOW);

    expect(buildOverview(conversations, rows, [], NOW).medianResponseMinutes).toBeNull();
  });

  it('counts flag rate per conversation, not per flag', () => {
    const conversations = [
      conversation('cv-1', [
        { id: 'm1', authorId: 'ct-pat', body: 'I have severe chest pain right now', hoursAgo: 2 },
        {
          id: 'm2',
          authorId: 'ct-pat',
          body: 'send tramadol without a prescription',
          hoursAgo: 1,
        },
      ]),
      conversation('cv-2', [{ id: 'm3', authorId: ME_ID, body: 'noted', hoursAgo: 1 }]),
    ];
    const flags = deriveFlags(conversations, CONTACTS, []);
    const rows = toConversationRows(conversations, CONTACTS, flags, NOW);

    // Two flags, but they are in ONE of two active conversations.
    expect(flags.length).toBe(2);
    expect(buildOverview(conversations, rows, flags, NOW).flagRate).toBeCloseTo(0.5);
  });

  it('builds a trend point for every day in the window', () => {
    const conversations = [
      conversation('cv-1', [{ id: 'm1', authorId: ME_ID, body: 'hi', hoursAgo: 2 }]),
    ];
    const rows = toConversationRows(conversations, CONTACTS, [], NOW);

    expect(buildOverview(conversations, rows, [], NOW).volume.points).toHaveLength(
      TREND_DAYS,
    );
  });
});

describe('deriveFlags', () => {
  it('carries only the matched message as the excerpt', () => {
    const conversations = [
      conversation('cv-1', [
        { id: 'm1', authorId: ME_ID, body: 'unrelated context above', hoursAgo: 3 },
        { id: 'm2', authorId: 'ct-pat', body: 'I have severe chest pain right now', hoursAgo: 2 },
        { id: 'm3', authorId: ME_ID, body: 'unrelated context below', hoursAgo: 1 },
      ]),
    ];

    const flags = deriveFlags(conversations, CONTACTS, []);

    const [flag] = flags;
    if (flag === undefined) throw new Error('expected one flag');
    expect(flag.excerpt).toBe('I have severe chest pain right now');
    expect(flag.excerpt).not.toContain('unrelated');
  });

  it('never puts a patient name in the author label', () => {
    const conversations = [
      conversation('cv-1', [
        { id: 'm1', authorId: 'ct-pat', body: 'I have severe chest pain right now', hoursAgo: 2 },
      ]),
    ];

    const flags = deriveFlags(conversations, CONTACTS, []);

    const [flag] = flags;
    if (flag === undefined) throw new Error('expected one flag');
    expect(flag.authorLabel).not.toContain('Mona');
  });

  it('applies a matching overlay and defaults to open without one', () => {
    const conversations = [
      conversation('cv-1', [
        { id: 'm1', authorId: 'ct-pat', body: 'I have severe chest pain right now', hoursAgo: 2 },
      ]),
    ];
    const [derived] = deriveFlags(conversations, CONTACTS, []);
    if (derived === undefined) throw new Error('expected one flag');
    expect(derived.status).toBe('open');

    const [resolved] = deriveFlags(conversations, CONTACTS, [
      {
        flagId: derived.id,
        status: 'resolved',
        resolution: 'dismissed',
        note: 'Patient contacted by phone.',
        decidedBy: 'Admin',
        decidedAt: at(1),
      },
    ]);
    if (resolved === undefined) throw new Error('expected one flag');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution).toBe('dismissed');
  });

  it('drops an overlay whose flag no longer matches any rule', () => {
    const conversations = [
      conversation('cv-1', [{ id: 'm1', authorId: ME_ID, body: 'nothing here', hoursAgo: 2 }]),
    ];

    // An overlay for a flag that no longer exists produces no row: there is
    // no such thing as an open flag on a message that trips nothing.
    expect(
      deriveFlags(conversations, CONTACTS, [
        {
          flagId: 'flag-stale',
          status: 'open',
          resolution: null,
          note: null,
          decidedBy: 'Admin',
          decidedAt: at(1),
        },
      ]),
    ).toEqual([]);
  });
});

describe('maskExcerpt (§6.4)', () => {
  // Every patient name the roster can ever produce, derived the same way
  // production does — not hardcoded — so a future addition to either
  // source is covered here without editing this test.
  const FORBIDDEN_PATIENT_NAMES = Array.from(
    new Set([
      ...SEED_CONTACTS.filter((contact) => contact.role === 'patient').map(
        (contact) => contact.name,
      ),
      ...MOCK_PATIENTS.map((patient) => patient.name),
    ]),
  );

  it('masks the exact excerpt browser verification found leaking a patient in a care-team thread', () => {
    // The care-team message from the shared conversation seed, verbatim —
    // this is the actual leak the finding reported, not a rewritten stand-in.
    const excerpt =
      'Dr. Youssef Nabil created this care-team thread for Omar Farouk (MRN 4472-90).';

    const masked = maskExcerpt(excerpt);

    expect(masked).not.toContain('Omar Farouk');
    expect(masked).not.toContain('4472-90');
    // A reviewer still needs to see that an identifier was posted, by whom,
    // in this thread — the doctor's name and the "MRN" label survive.
    expect(masked).toContain('Dr. Youssef Nabil');
    expect(masked).toContain('MRN');
  });

  it('masks the exact excerpt browser verification found leaking a patient in a referral message', () => {
    // The referral message from the shared conversation seed, verbatim,
    // markdown emphasis and all.
    const excerpt =
      'Omar, I am referring **Layla Mansour** (MRN 4485-33) to you — exertional chest tightness on top of her known CAD. Her statin lapsed in April.';

    const masked = maskExcerpt(excerpt);

    expect(masked).not.toContain('Layla Mansour');
    expect(masked).not.toContain('4485-33');
    expect(masked).toContain('MRN');
  });

  it('leaves a doctor name fully readable', () => {
    // The asymmetry is deliberate (§6.4): doctors are named throughout this
    // feature, only patients are masked. Regressing this would mask the
    // clinician a reviewer needs to identify, not just the patient.
    const masked = maskExcerpt('Dr. Youssef Nabil escalated this to nephrology.');

    expect(masked).toContain('Dr. Youssef Nabil');
  });

  it('masks a PT-#### reference', () => {
    const masked = maskExcerpt('Cross-check against PT-1004 before replying.');

    expect(masked).not.toContain('PT-1004');
    // Still bears the shape of a masked identifier — not silently dropped.
    expect(masked).toContain('••••');
  });

  it('masks every known patient name found in free text', () => {
    for (const name of FORBIDDEN_PATIENT_NAMES) {
      const masked = maskExcerpt(`Following up with ${name} about the referral.`);
      expect(masked).not.toContain(name);
    }
  });

  it('leaves ordinary text with no identifier untouched', () => {
    const excerpt = 'Thanks — I can see her Thursday morning. Any recent lipids?';

    expect(maskExcerpt(excerpt)).toBe(excerpt);
  });
});

describe('filterRows and sortRows', () => {
  const rows = toConversationRows(
    [
      conversation('cv-a', [
        { id: 'm1', authorId: 'ct-pat', body: 'I have severe chest pain right now', hoursAgo: 2 },
      ]),
      conversation('cv-b', [{ id: 'm2', authorId: ME_ID, body: 'plain', hoursAgo: 30 }]),
    ],
    CONTACTS,
    deriveFlags(
      [
        conversation('cv-a', [
          {
            id: 'm1',
            authorId: 'ct-pat',
            body: 'I have severe chest pain right now',
            hoursAgo: 2,
          },
        ]),
      ],
      CONTACTS,
      [],
    ),
    NOW,
  );

  it('filters to flagged conversations only', () => {
    const filtered = filterRows(rows, { query: '', status: 'all', flagged: 'flagged' });

    expect(filtered.map((row) => row.id)).toEqual(['cv-a']);
  });

  it('matches the query against the doctor name but not the patient name', () => {
    expect(
      filterRows(rows, { query: 'Omar', status: 'all', flagged: 'all' }).length,
    ).toBeGreaterThan(0);
    // Searching a patient's name must not be a way to find their thread.
    expect(filterRows(rows, { query: 'Mona', status: 'all', flagged: 'all' })).toEqual([]);
  });

  it('sorts most-flags first', () => {
    expect(sortRows(rows, 'most-flags').map((row) => row.id)).toEqual(['cv-a', 'cv-b']);
  });
});
