import { describe, expect, it } from 'vitest';

import {
  availableDecisions,
  canApproveDocument,
  canReactivate,
  canSuspend,
  EMPTY_FILTERS,
  EXPIRY_WARNING_DAYS,
  failedSignInCount,
  filterDoctors,
  hasImpossibleTravel,
  isChecklistComplete,
  isExpired,
  isExpiringSoon,
  isVerifiable,
  inTab,
  licenceExpiringSoon,
  LICENCE_EXPIRY_DAYS,
  matchesFilters,
  REQUIRED_DOCUMENTS,
  tabCounts,
  validateReason,
  verificationBlockers,
} from './doctors';
import type {
  CredentialDocument,
  DoctorRecord,
  DocumentKind,
  VerificationStatus,
} from './doctors.types';

/**
 * The rules behind ADM-02 / ADM-03.
 *
 * The claim worth testing is not that badges render — it is that the
 * verification workflow cannot be short-circuited. A document is not
 * approvable until all three checks are ticked; a doctor is not verifiable
 * until every required document is approved *and* in date; and a rejected
 * application cannot be re-decided without going back through review.
 */

const DAY = 86_400_000;
const NOW = new Date('2026-08-11T12:00:00.000Z').getTime();

function daysFromNow(days: number): string {
  return new Date(NOW + days * DAY).toISOString();
}

function document(
  kind: DocumentKind,
  overrides: Partial<CredentialDocument> = {},
): CredentialDocument {
  return {
    id: `doc-${kind}`,
    kind,
    filename: `${kind}.pdf`,
    uploadedAt: daysFromNow(-30),
    expiresAt: kind === 'medical-license' ? daysFromNow(400) : null,
    decision: 'approved',
    checklist: { authentic: true, current: true, matchesIdentity: true },
    rejectionReason: null,
    reviewedBy: 'Marcus Reed',
    reviewedAt: daysFromNow(-29),
    previewLines: ['PREVIEW'],
    ...overrides,
  };
}

function doctor(overrides: Partial<DoctorRecord> = {}): DoctorRecord {
  return {
    id: 'doc-a',
    name: 'Dr. A',
    title: 'Consultant',
    email: 'a@medora.health',
    phone: '+20 100 000 0000',
    specialty: 'Cardiology',
    licenseNumber: 'CA-100-0001',
    languages: ['English'],
    bio: '',
    joinedAt: daysFromNow(-100),
    lastActiveAt: daysFromNow(-1),
    verification: 'pending',
    verificationNote: null,
    account: 'active',
    suspensionReason: null,
    administrative: { roleTemplate: 'Consultant', clinic: 'Medora Central' },
    patientsCount: 10,
    appointments30d: 20,
    rating: null,
    licenseExpiresAt: null,
    documents: REQUIRED_DOCUMENTS.map((kind) => document(kind)),
    logins: [],
    activity: {
      recordsEdited: 0,
      prescriptionsIssued: 0,
      labsReviewed: 0,
      messagesSent: 0,
      windowDays: 30,
    },
    statistics: {
      patientsServed: 10,
      rating: 4.5,
      ratingDistribution: [0, 1, 2, 3, 4],
      avgResponseHours: 2,
      monthlyVolume: [],
    },
    audit: [],
    ...overrides,
  };
}

describe('the document checklist', () => {
  it('treats a document as approvable only when all three checks are ticked', () => {
    const partial = document('degree', {
      decision: 'pending',
      checklist: { authentic: true, current: true, matchesIdentity: false },
    });
    const complete = document('degree', {
      decision: 'pending',
      checklist: { authentic: true, current: true, matchesIdentity: true },
    });

    expect(isChecklistComplete(partial.checklist)).toBe(false);
    expect(canApproveDocument(partial)).toBe(false);
    expect(canApproveDocument(complete)).toBe(true);
  });

  it('does not offer to approve something already approved', () => {
    expect(canApproveDocument(document('degree'))).toBe(false);
  });

  it('separates expired from expiring-soon', () => {
    const expired = document('medical-license', { expiresAt: daysFromNow(-1) });
    const soon = document('medical-license', { expiresAt: daysFromNow(EXPIRY_WARNING_DAYS - 1) });
    const fine = document('medical-license', { expiresAt: daysFromNow(EXPIRY_WARNING_DAYS + 10) });

    expect(isExpired(expired, NOW)).toBe(true);
    expect(isExpiringSoon(expired, NOW)).toBe(false);
    expect(isExpiringSoon(soon, NOW)).toBe(true);
    expect(isExpiringSoon(fine, NOW)).toBe(false);
  });

  it('never expires a document that has no expiry', () => {
    const identity = document('identity', { expiresAt: null });

    expect(isExpired(identity, NOW)).toBe(false);
    expect(isExpiringSoon(identity, NOW)).toBe(false);
  });
});

describe('verifiability', () => {
  it('requires every required document to be present and approved', () => {
    expect(isVerifiable(doctor(), NOW)).toBe(true);

    const missing = doctor({
      documents: [document('medical-license'), document('degree')],
    });
    expect(isVerifiable(missing, NOW)).toBe(false);
    expect(verificationBlockers(missing, NOW)).toEqual([
      'Identity document has not been uploaded.',
    ]);
  });

  it('refuses an approved-but-expired licence', () => {
    const stale = doctor({
      documents: [
        document('medical-license', { expiresAt: daysFromNow(-2) }),
        document('degree'),
        document('identity'),
      ],
    });

    expect(isVerifiable(stale, NOW)).toBe(false);
    expect(verificationBlockers(stale, NOW)).toEqual(['Medical licence has expired.']);
  });

  it('names each outstanding document rather than failing silently', () => {
    const messy = doctor({
      documents: [
        document('medical-license', { decision: 'pending' }),
        document('degree', { decision: 'rejected' }),
        document('identity'),
      ],
    });

    expect(verificationBlockers(messy, NOW)).toEqual([
      'Medical licence has not been approved.',
      'Degree certificate was rejected.',
    ]);
  });
});

describe('the decision machine', () => {
  it('enables completion only when nothing is outstanding', () => {
    const ready = availableDecisions(doctor(), NOW).find((entry) => entry.decision === 'complete');
    expect(ready?.enabled).toBe(true);

    const blocked = availableDecisions(
      doctor({ documents: [document('medical-license'), document('degree')] }),
      NOW,
    ).find((entry) => entry.decision === 'complete');
    expect(blocked?.enabled).toBe(false);
    expect(blocked?.blockedBecause).toContain('Identity document');
  });

  it('offers a verified doctor no way to re-complete verification', () => {
    const decisions = availableDecisions(doctor({ verification: 'verified' }), NOW);

    expect(decisions.find((entry) => entry.decision === 'complete')?.enabled).toBe(false);
    expect(decisions.find((entry) => entry.decision === 'reject')?.enabled).toBe(false);
    expect(decisions.find((entry) => entry.decision === 'request-documents')?.enabled).toBe(false);
  });

  it('sends a rejected application back through review rather than straight to a verdict', () => {
    const decisions = availableDecisions(doctor({ verification: 'rejected' }), NOW);

    expect(decisions.map((entry) => entry.decision)).toEqual(['reinstate-review']);
  });
});

describe('account controls', () => {
  it('offers suspension and reactivation as opposites, never both', () => {
    const active = doctor({ account: 'active' });
    const suspended = doctor({ account: 'suspended' });

    expect(canSuspend(active)).toBe(true);
    expect(canReactivate(active)).toBe(false);
    expect(canSuspend(suspended)).toBe(false);
    expect(canReactivate(suspended)).toBe(true);
  });

  it('lets a doctor on vacation be suspended — leave is not a sanction', () => {
    expect(canSuspend(doctor({ account: 'vacation' }))).toBe(true);
  });
});

describe('tabs and filters', () => {
  const roster = [
    doctor({ id: '1', name: 'Dr. Pending', verification: 'pending', account: 'active' }),
    doctor({ id: '2', name: 'Dr. Verified', verification: 'verified', account: 'active' }),
    doctor({ id: '3', name: 'Dr. Suspended', verification: 'verified', account: 'suspended' }),
    doctor({ id: '4', name: 'Dr. Waiting', verification: 'docs-requested', account: 'active' }),
  ];

  it('counts the pending queue as work an administrator can actually do', () => {
    const counts = tabCounts(roster);

    // `docs-requested` is waiting on the doctor, not on the platform.
    expect(counts.pending).toBe(1);
    expect(counts.all).toBe(4);
    expect(counts.active).toBe(3);
    expect(counts.suspended).toBe(1);
    expect(inTab(roster[3] as DoctorRecord, 'pending')).toBe(false);
  });

  it('searches name, email and licence number', () => {
    const target = doctor({
      name: 'Dr. Nadia Farouk',
      email: 'nadia.farouk@medora.health',
      licenseNumber: 'PD-330-7712',
    });

    for (const query of ['farouk', 'NADIA.FAROUK@', 'pd-330']) {
      expect(matchesFilters(target, { ...EMPTY_FILTERS, query }, NOW)).toBe(true);
    }
    expect(matchesFilters(target, { ...EMPTY_FILTERS, query: 'khalil' }, NOW)).toBe(false);
  });

  it('applies specialty, verification, account and joined-range together', () => {
    const target = doctor({ specialty: 'Cardiology', joinedAt: daysFromNow(-200) });

    expect(matchesFilters(target, { ...EMPTY_FILTERS, specialty: 'Oncology' }, NOW)).toBe(false);
    expect(
      matchesFilters(target, { ...EMPTY_FILTERS, verification: 'verified' }, NOW),
    ).toBe(false);
    expect(matchesFilters(target, { ...EMPTY_FILTERS, account: 'suspended' }, NOW)).toBe(false);
    expect(matchesFilters(target, { ...EMPTY_FILTERS, joined: '90d' }, NOW)).toBe(false);
    expect(matchesFilters(target, { ...EMPTY_FILTERS, joined: '365d' }, NOW)).toBe(true);
  });

  it('floats the queue to the top of whatever is showing', () => {
    const rows = filterDoctors(roster, 'all', EMPTY_FILTERS, NOW);

    expect(rows[0]?.verification).toBe('pending');
  });
});

describe('licenceExpiringSoon', () => {
  const withLicence = (expiresAt: string | null): DoctorRecord =>
    doctor({ documents: [document('medical-license', { expiresAt })] });

  it('fires inside the horizon and not outside it', () => {
    expect(licenceExpiringSoon(withLicence(daysFromNow(LICENCE_EXPIRY_DAYS - 1)), NOW)).toBe(true);
    expect(licenceExpiringSoon(withLicence(daysFromNow(LICENCE_EXPIRY_DAYS + 1)), NOW)).toBe(false);
  });

  it('counts an already-expired licence — it is more urgent, not less', () => {
    expect(licenceExpiringSoon(withLicence(daysFromNow(-1)), NOW)).toBe(true);
  });

  it('ignores documents that do not expire', () => {
    expect(licenceExpiringSoon(withLicence(null), NOW)).toBe(false);
  });

  it('reads the medical licence only, not every document that carries a date', () => {
    // `isExpiringSoon` warns across every kind; this rule is about the
    // credential a doctor cannot practise without.
    const insured = doctor({
      documents: [document('insurance', { expiresAt: daysFromNow(LICENCE_EXPIRY_DAYS - 1) })],
    });

    expect(licenceExpiringSoon(insured, NOW)).toBe(false);
  });
});

describe('the expiring-licence filter', () => {
  it('is off by default, so the list still shows everyone', () => {
    expect(EMPTY_FILTERS.expiring).toBe(false);
  });

  it('keeps only doctors whose licence expires inside the horizon', () => {
    const soon = doctor({
      id: 'soon',
      documents: [document('medical-license', { expiresAt: daysFromNow(10) })],
    });
    const later = doctor({
      id: 'later',
      documents: [document('medical-license', { expiresAt: daysFromNow(300) })],
    });

    const kept = filterDoctors([soon, later], 'all', { ...EMPTY_FILTERS, expiring: true }, NOW);

    expect(kept.map((d) => d.id)).toEqual(['soon']);
  });
});

describe('sign-in activity', () => {
  const withLogins = doctor({
    logins: [
      {
        id: 'l1',
        at: daysFromNow(-1),
        ip: '1.1.1.1',
        device: 'Chrome',
        location: 'Cairo, EG',
        result: 'failed',
        impossibleTravel: false,
      },
      {
        id: 'l2',
        at: daysFromNow(-2),
        ip: '1.1.1.2',
        device: 'Chrome',
        location: 'Jakarta, ID',
        result: 'blocked',
        impossibleTravel: true,
      },
      {
        id: 'l3',
        at: daysFromNow(-40),
        ip: '1.1.1.3',
        device: 'Chrome',
        location: 'Cairo, EG',
        result: 'failed',
        impossibleTravel: false,
      },
    ],
  });

  it('counts unsuccessful sign-ins inside the window only', () => {
    expect(failedSignInCount(withLogins, 30, NOW)).toBe(2);
    expect(failedSignInCount(withLogins, 60, NOW)).toBe(3);
  });

  it('reports an impossible-travel pair', () => {
    expect(hasImpossibleTravel(withLogins)).toBe(true);
    expect(hasImpossibleTravel(doctor())).toBe(false);
  });
});

describe('reasons', () => {
  it('rejects empty and token reasons', () => {
    expect(validateReason('  ').ok).toBe(false);
    expect(validateReason('bad scan').ok).toBe(false);
    expect(validateReason('The certificate is cropped on page two.').ok).toBe(true);
  });
});

describe('verification statuses', () => {
  it('covers every status in the tab predicate without throwing', () => {
    const statuses: readonly VerificationStatus[] = [
      'verified',
      'pending',
      'docs-requested',
      'rejected',
    ];
    for (const verification of statuses) {
      expect(() => inTab(doctor({ verification }), 'pending')).not.toThrow();
    }
  });
});
