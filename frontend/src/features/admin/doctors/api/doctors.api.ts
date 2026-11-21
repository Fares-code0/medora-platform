/**
 * Doctors management — mock service and store (ADM-02 / ADM-03).
 *
 * Stands in for the platform's doctor-lifecycle API. The rules it enforces
 * are the ones an administrator can otherwise talk themselves past:
 *
 * - A document cannot be approved until all three checks are ticked, and
 *   verification cannot be completed until every required document is
 *   approved and unexpired. The service re-checks both at write time, so
 *   the guarantee does not depend on the button being disabled.
 * - Every decision writes an attributed audit entry. There is no way to
 *   change a doctor's standing without leaving a name and a timestamp.
 * - Credentials are never set by an administrator. "Reset access" sends the
 *   doctor a reset link and records that it was sent; it does not, and
 *   cannot, choose a password.
 *
 * Mutations resolve to the full patched document so the query layer seeds
 * its cache instead of refetching.
 */

import { hashString, mulberry32 } from '@/features/shared-domain/patient-identity';

import { isChecklistComplete, isVerifiable, REQUIRED_DOCUMENTS } from '../doctors';
import type {
  AccountStatus,
  AdminAuditEntry,
  AdministrativeFields,
  CredentialDocument,
  DoctorInvite,
  DoctorRecord,
  DoctorStatistics,
  DocumentChecklist,
  DocumentKind,
  LoginEvent,
  VerificationStatus,
} from '../doctors.types';

const LATENCY_MS = 280;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function daysAhead(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

/* ── Seed ─────────────────────────────────────────────────────── */

/**
 * Ids match the appointment-oversight roster (`appointments/oversight.api`)
 * so the two admin screens are talking about the same people: a suspension
 * here can name the appointments it would strand there.
 */
interface DoctorSeed {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly specialty: string;
  readonly license: string;
  readonly joinedDaysAgo: number;
  readonly lastActiveHoursAgo: number;
  readonly verification: VerificationStatus;
  readonly account: AccountStatus;
  readonly patients: number;
  readonly appointments30d: number;
  /** Decision per required document, in REQUIRED_DOCUMENTS order. */
  readonly docs: readonly CredentialDocument['decision'][];
  /** Days until the licence expires; negative for an expired one. */
  readonly licenseExpiresInDays: number;
  readonly note?: string;
  readonly suspensionReason?: string;
  readonly clinic: string;
  readonly roleTemplate: string;
}

const SEEDS: readonly DoctorSeed[] = [
  {
    id: 'doc-chen',
    name: 'Dr. Amelia Chen',
    title: 'Attending Physician',
    specialty: 'General Medicine',
    license: 'GM-114-2290',
    joinedDaysAgo: 840,
    lastActiveHoursAgo: 2,
    verification: 'verified',
    account: 'active',
    patients: 218,
    appointments30d: 96,
    docs: ['approved', 'approved', 'approved'],
    licenseExpiresInDays: 540,
    clinic: 'Medora Central',
    roleTemplate: 'Attending physician',
  },
  {
    id: 'doc-ibrahim',
    name: 'Dr. Salma Ibrahim',
    title: 'Consultant Physician',
    specialty: 'General Medicine',
    license: 'GM-118-4471',
    joinedDaysAgo: 610,
    lastActiveHoursAgo: 7,
    verification: 'verified',
    account: 'active',
    patients: 174,
    appointments30d: 88,
    docs: ['approved', 'approved', 'approved'],
    licenseExpiresInDays: 300,
    clinic: 'Medora Central',
    roleTemplate: 'Consultant',
  },
  {
    id: 'doc-khalil',
    name: 'Dr. Omar Khalil',
    title: 'Consultant Cardiologist',
    specialty: 'Cardiology',
    license: 'CA-207-1183',
    joinedDaysAgo: 720,
    lastActiveHoursAgo: 26,
    verification: 'verified',
    account: 'active',
    patients: 152,
    appointments30d: 104,
    // Inside the warning window: verified today, a problem in seven weeks.
    docs: ['approved', 'approved', 'approved'],
    licenseExpiresInDays: 44,
    clinic: 'Medora Riverside',
    roleTemplate: 'Consultant',
  },
  {
    id: 'doc-nabil',
    name: 'Dr. Youssef Nabil',
    title: 'Cardiology Registrar',
    specialty: 'Cardiology',
    license: 'CA-211-6620',
    joinedDaysAgo: 26,
    lastActiveHoursAgo: 11,
    verification: 'pending',
    account: 'active',
    patients: 41,
    appointments30d: 37,
    // The degree certificate has not been approved — verification is blocked.
    docs: ['approved', 'pending', 'approved'],
    licenseExpiresInDays: 700,
    clinic: 'Medora Riverside',
    roleTemplate: 'Resident',
  },
  {
    id: 'doc-farouk',
    name: 'Dr. Nadia Farouk',
    title: 'Paediatric Consultant',
    specialty: 'Paediatrics',
    license: 'PD-330-7712',
    joinedDaysAgo: 12,
    lastActiveHoursAgo: 4,
    verification: 'pending',
    account: 'active',
    patients: 8,
    appointments30d: 14,
    // Everything approved: the one case where "Complete verification" is live.
    docs: ['approved', 'approved', 'approved'],
    licenseExpiresInDays: 900,
    clinic: 'Medora North',
    roleTemplate: 'Consultant',
  },
  {
    id: 'doc-hassan',
    name: 'Dr. Amira Hassan',
    title: 'Endocrinology Consultant',
    specialty: 'Endocrinology',
    license: 'EN-402-9931',
    joinedDaysAgo: 505,
    lastActiveHoursAgo: 72,
    verification: 'verified',
    account: 'vacation',
    patients: 133,
    appointments30d: 61,
    docs: ['approved', 'approved', 'approved'],
    licenseExpiresInDays: 410,
    clinic: 'Medora North',
    roleTemplate: 'Consultant',
  },
  {
    id: 'doc-said',
    name: 'Dr. Hana Said',
    title: 'Endocrinology Registrar',
    specialty: 'Endocrinology',
    license: 'EN-409-2205',
    joinedDaysAgo: 300,
    lastActiveHoursAgo: 400,
    verification: 'verified',
    account: 'suspended',
    patients: 77,
    appointments30d: 0,
    docs: ['approved', 'approved', 'approved'],
    licenseExpiresInDays: 150,
    suspensionReason: 'Under review following a prescribing-pattern audit.',
    clinic: 'Medora North',
    roleTemplate: 'Resident',
  },
  {
    id: 'doc-mansour',
    name: 'Dr. Tarek Mansour',
    title: 'Dermatologist',
    specialty: 'Dermatology',
    license: 'DE-515-3390',
    joinedDaysAgo: 38,
    lastActiveHoursAgo: 190,
    verification: 'docs-requested',
    account: 'active',
    patients: 19,
    appointments30d: 11,
    docs: ['approved', 'rejected', 'approved'],
    licenseExpiresInDays: 260,
    note: 'The degree certificate was illegible. A clear scan of both pages is needed.',
    clinic: 'Medora Central',
    roleTemplate: 'Locum',
  },
  {
    id: 'doc-reyes',
    name: 'Dr. Elena Reyes',
    title: 'Cardiology Fellow',
    specialty: 'Cardiology',
    license: 'CA-219-0043',
    joinedDaysAgo: 64,
    lastActiveHoursAgo: 600,
    verification: 'rejected',
    account: 'suspended',
    patients: 0,
    appointments30d: 0,
    docs: ['rejected', 'approved', 'approved'],
    licenseExpiresInDays: -20,
    note: 'The licence number could not be matched against the national register.',
    suspensionReason: 'Automatically suspended when the application was rejected.',
    clinic: 'Unassigned',
    roleTemplate: 'Locum',
  },
];

const DOCUMENT_FILENAME: Record<DocumentKind, string> = {
  'medical-license': 'medical-license.pdf',
  degree: 'degree-certificate.pdf',
  identity: 'national-id.pdf',
  insurance: 'malpractice-cover.pdf',
  reference: 'reference-letter.pdf',
  other: 'supporting-document.pdf',
};

/** The checklist implied by a decision: approved means all three were ticked. */
function checklistFor(decision: CredentialDocument['decision']): DocumentChecklist {
  if (decision === 'approved') {
    return { authentic: true, current: true, matchesIdentity: true };
  }
  if (decision === 'rejected') {
    return { authentic: false, current: true, matchesIdentity: true };
  }
  return { authentic: false, current: false, matchesIdentity: false };
}

const PREVIEW_LINES: Record<DocumentKind, readonly string[]> = {
  'medical-license': [
    'NATIONAL MEDICAL COUNCIL',
    'Certificate of Registration',
    'Register entry: full registration with licence to practise',
  ],
  degree: [
    'FACULTY OF MEDICINE',
    'Doctor of Medicine (MBBCh)',
    'Conferred with honours',
  ],
  identity: ['NATIONAL IDENTITY CARD', 'Photograph and machine-readable zone', 'Issued by the interior ministry'],
  insurance: ['MEDICAL DEFENCE UNION', 'Certificate of professional indemnity', 'Cover: clinical negligence'],
  reference: ['LETTER OF REFERENCE', 'Head of Department', 'Confirms three years of supervised practice'],
  other: ['SUPPORTING DOCUMENT', 'Submitted by the applicant', 'Not one of the required credentials'],
};

function buildDocuments(seed: DoctorSeed): CredentialDocument[] {
  const documents: CredentialDocument[] = REQUIRED_DOCUMENTS.map((kind, index) => {
    const decision = seed.docs[index] ?? 'pending';
    const reviewed = decision !== 'pending';
    return {
      id: `${seed.id}-${kind}`,
      kind,
      filename: DOCUMENT_FILENAME[kind],
      uploadedAt: daysAgo(seed.joinedDaysAgo - 1),
      expiresAt: kind === 'medical-license' ? daysAhead(seed.licenseExpiresInDays) : null,
      decision,
      checklist: checklistFor(decision),
      rejectionReason:
        decision === 'rejected' ? (seed.note ?? 'The document could not be accepted.') : null,
      reviewedBy: reviewed ? 'Marcus Reed' : null,
      reviewedAt: reviewed ? daysAgo(Math.max(1, seed.joinedDaysAgo - 3)) : null,
      previewLines: PREVIEW_LINES[kind],
    };
  });

  // Optional documents: collected, never blocking.
  documents.push({
    id: `${seed.id}-insurance`,
    kind: 'insurance',
    filename: DOCUMENT_FILENAME.insurance,
    uploadedAt: daysAgo(seed.joinedDaysAgo - 2),
    expiresAt: daysAhead(seed.licenseExpiresInDays + 30),
    decision: seed.verification === 'verified' ? 'approved' : 'pending',
    checklist: checklistFor(seed.verification === 'verified' ? 'approved' : 'pending'),
    rejectionReason: null,
    reviewedBy: seed.verification === 'verified' ? 'Marcus Reed' : null,
    reviewedAt: seed.verification === 'verified' ? daysAgo(seed.joinedDaysAgo - 4) : null,
    previewLines: PREVIEW_LINES.insurance,
  });

  return documents;
}

const DEVICES = ['Chrome · Windows', 'Safari · iPhone', 'Firefox · macOS', 'Chrome · Android'];
const CITIES = ['Cairo, EG', 'Alexandria, EG', 'Giza, EG', 'Dubai, AE'];

/**
 * Sign-in history, generated deterministically per doctor so the demo is
 * stable across reloads. One doctor is given a genuine impossible-travel
 * pair — two sign-ins from different countries eleven minutes apart — since
 * a flag that never fires teaches an administrator nothing.
 */
function buildLogins(seed: DoctorSeed): LoginEvent[] {
  const random = mulberry32(hashString(seed.id));
  const events: LoginEvent[] = [];
  for (let i = 0; i < 6; i += 1) {
    const failed = random() < 0.2;
    events.push({
      id: `${seed.id}-login-${String(i + 1)}`,
      at: hoursAgo(seed.lastActiveHoursAgo + i * 19),
      ip: `41.${String(Math.floor(random() * 200) + 20)}.${String(Math.floor(random() * 200) + 10)}.${String(Math.floor(random() * 240) + 5)}`,
      device: DEVICES[Math.floor(random() * DEVICES.length)] ?? 'Chrome · Windows',
      location: CITIES[Math.floor(random() * CITIES.length)] ?? 'Cairo, EG',
      result: failed ? 'failed' : 'success',
      impossibleTravel: false,
    });
  }

  if (seed.id === 'doc-said') {
    events.unshift(
      {
        id: `${seed.id}-login-travel-a`,
        at: hoursAgo(seed.lastActiveHoursAgo),
        ip: '185.44.19.7',
        device: 'Chrome · Windows',
        location: 'Cairo, EG',
        result: 'success',
        impossibleTravel: false,
      },
      {
        id: `${seed.id}-login-travel-b`,
        at: hoursAgo(seed.lastActiveHoursAgo - 0.18),
        ip: '203.0.113.44',
        device: 'Chrome · Linux',
        location: 'Jakarta, ID',
        result: 'blocked',
        impossibleTravel: true,
      },
    );
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

function buildStatistics(seed: DoctorSeed): DoctorStatistics {
  const random = mulberry32(hashString(`${seed.id}-stats`));
  const months = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
  return {
    patientsServed: seed.patients,
    rating: Math.round((3.8 + random() * 1.1) * 10) / 10,
    ratingDistribution: [
      Math.floor(random() * 3),
      Math.floor(random() * 4),
      Math.floor(random() * 9) + 2,
      Math.floor(random() * 22) + 8,
      Math.floor(random() * 48) + 20,
    ],
    avgResponseHours: Math.round((1 + random() * 9) * 10) / 10,
    monthlyVolume: months.map((label, index) => ({
      label,
      value: Math.max(
        0,
        Math.round(seed.appointments30d * (0.6 + random() * 0.7) - (5 - index) * 2),
      ),
    })),
  };
}

function licenceExpiryOf(documents: readonly CredentialDocument[]): string | null {
  return documents.find((entry) => entry.kind === 'medical-license')?.expiresAt ?? null;
}

/**
 * Fills the two roster fields FE-10.10 added to a record stored before they
 * existed, so a returning demo session reads the same as a fresh one.
 */
function withRosterFields(doctor: DoctorRecord): DoctorRecord {
  const stored: Partial<DoctorRecord> = doctor;
  return {
    ...doctor,
    rating: stored.rating === undefined ? (doctor.statistics?.rating ?? null) : stored.rating,
    licenseExpiresAt:
      stored.licenseExpiresAt === undefined
        ? licenceExpiryOf(doctor.documents)
        : stored.licenseExpiresAt,
  };
}

function expand(seed: DoctorSeed): DoctorRecord {
  const random = mulberry32(hashString(`${seed.id}-activity`));
  const documents = buildDocuments(seed);
  const statistics = buildStatistics(seed);
  const audit: AdminAuditEntry[] = [
    {
      id: `${seed.id}-aud-1`,
      at: daysAgo(seed.joinedDaysAgo),
      actor: 'Onboarding service',
      action: 'Application received',
      detail: `${seed.name} applied as ${seed.specialty}.`,
    },
  ];
  if (seed.verification === 'verified') {
    audit.unshift({
      id: `${seed.id}-aud-2`,
      at: daysAgo(Math.max(1, seed.joinedDaysAgo - 5)),
      actor: 'Marcus Reed',
      action: 'Verification completed',
      detail: 'All required documents approved.',
    });
  }
  if (seed.account === 'suspended' && seed.suspensionReason !== undefined) {
    audit.unshift({
      id: `${seed.id}-aud-3`,
      at: daysAgo(4),
      actor: 'Marcus Reed',
      action: 'Account suspended',
      detail: seed.suspensionReason,
    });
  }

  return {
    id: seed.id,
    name: seed.name,
    title: seed.title,
    email: `${seed.name.replace(/^Dr\.\s*/, '').toLowerCase().replace(/\s+/g, '.')}@medora.health`,
    phone: `+20 10${String(Math.floor(random() * 9))} ${String(Math.floor(random() * 900) + 100)} ${String(Math.floor(random() * 9000) + 1000)}`,
    specialty: seed.specialty,
    licenseNumber: seed.license,
    languages: seed.specialty === 'Paediatrics' ? ['Arabic', 'English', 'French'] : ['Arabic', 'English'],
    bio: `${seed.title} at ${seed.clinic}. ${seed.specialty} practice with a focus on continuity of care.`,
    joinedAt: daysAgo(seed.joinedDaysAgo),
    lastActiveAt: hoursAgo(seed.lastActiveHoursAgo),
    verification: seed.verification,
    verificationNote: seed.note ?? null,
    account: seed.account,
    suspensionReason: seed.suspensionReason ?? null,
    administrative: { roleTemplate: seed.roleTemplate, clinic: seed.clinic },
    patientsCount: seed.patients,
    appointments30d: seed.appointments30d,
    rating: statistics.rating,
    licenseExpiresAt: licenceExpiryOf(documents),
    documents,
    logins: buildLogins(seed),
    activity: {
      recordsEdited: Math.round(seed.appointments30d * 1.4),
      prescriptionsIssued: Math.round(seed.appointments30d * 0.8),
      labsReviewed: Math.round(seed.appointments30d * 0.5),
      messagesSent: Math.round(seed.appointments30d * 2.1),
      windowDays: 30,
    },
    statistics,
    audit,
  };
}

/* ── Store ────────────────────────────────────────────────────── */

const STORAGE_KEY = 'medora.admin.doctors.v1';

export interface DoctorsDocument {
  readonly doctors: readonly DoctorRecord[];
  readonly invites: readonly DoctorInvite[];
}

export const DEFAULT_DOCTORS: DoctorsDocument = {
  doctors: SEEDS.map(expand),
  invites: [
    {
      id: 'inv-1',
      email: 'rania.said@medora.health',
      specialty: 'Radiology',
      roleTemplate: 'Consultant',
      invitedAt: daysAgo(3),
      invitedBy: 'Marcus Reed',
    },
  ],
};

function load(): DoctorsDocument {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_DOCTORS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_DOCTORS;
    const stored = { ...DEFAULT_DOCTORS, ...(parsed as Partial<DoctorsDocument>) };
    return { ...stored, doctors: stored.doctors.map(withRosterFields) };
  } catch {
    return DEFAULT_DOCTORS;
  }
}

function persist(document: DoctorsDocument): DoctorsDocument {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  } catch {
    // Storage unavailable — decisions stay session-local.
  }
  return document;
}

export class DoctorsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoctorsError';
  }
}

let sequence = 0;

function writeId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(Date.now())}-${String(sequence)}`;
}

function requireDoctor(document: DoctorsDocument, id: string): DoctorRecord {
  const doctor = document.doctors.find((entry) => entry.id === id);
  if (doctor === undefined) {
    throw new DoctorsError('That doctor is no longer on the platform. Refresh and try again.');
  }
  return doctor;
}

function audited(
  doctor: DoctorRecord,
  actor: string,
  action: string,
  detail: string,
): AdminAuditEntry[] {
  return [
    { id: writeId('aud'), at: new Date().toISOString(), actor, action, detail },
    ...doctor.audit,
  ];
}

function patch(
  document: DoctorsDocument,
  id: string,
  changes: (doctor: DoctorRecord) => DoctorRecord,
): DoctorsDocument {
  return {
    ...document,
    doctors: document.doctors.map((entry) => (entry.id === id ? changes(entry) : entry)),
  };
}

export interface DocumentDecisionInput {
  readonly doctorId: string;
  readonly documentId: string;
  readonly actor: string;
  readonly reason?: string;
}

export interface VerificationInput {
  readonly doctorId: string;
  readonly actor: string;
  readonly reason?: string;
}

export interface AccountInput {
  readonly doctorId: string;
  readonly actor: string;
  readonly reason?: string;
}

export interface InviteInput {
  readonly email: string;
  readonly specialty: string;
  readonly roleTemplate: string;
  readonly actor: string;
}

export const doctorsApi = {
  list: (): Promise<DoctorsDocument> => delay(load()),

  /**
   * Ticks or unticks ONE of the three checks.
   *
   * Deliberately a single field rather than the whole checklist: an
   * administrator ticks three boxes in quick succession, and a caller that
   * posts the entire object computes it from whatever it last rendered. Two
   * clicks inside one round trip would then silently undo each other. The
   * field is applied to freshly loaded state, so they cannot.
   */
  setCheck: async ({
    doctorId,
    documentId,
    field,
    value,
  }: {
    doctorId: string;
    documentId: string;
    field: keyof DocumentChecklist;
    value: boolean;
  }): Promise<DoctorsDocument> => {
    const document = load();
    requireDoctor(document, doctorId);
    return delay(
      persist(
        patch(document, doctorId, (doctor) => ({
          ...doctor,
          documents: doctor.documents.map((entry) =>
            entry.id === documentId
              ? { ...entry, checklist: { ...entry.checklist, [field]: value } }
              : entry,
          ),
        })),
      ),
    );
  },

  /**
   * Approves one document. Refuses unless all three checks are ticked —
   * the disabled button is a courtesy, this is the rule.
   */
  approveDocument: async ({
    doctorId,
    documentId,
    actor,
  }: DocumentDecisionInput): Promise<DoctorsDocument> => {
    const document = load();
    const doctor = requireDoctor(document, doctorId);
    const target = doctor.documents.find((entry) => entry.id === documentId);
    if (target === undefined) throw new DoctorsError('That document is no longer on file.');
    if (!isChecklistComplete(target.checklist)) {
      throw new DoctorsError(
        'Tick authentic, current and matches-identity before approving this document.',
      );
    }

    const at = new Date().toISOString();
    return delay(
      persist(
        patch(document, doctorId, (entry) => ({
          ...entry,
          documents: entry.documents.map((doc) =>
            doc.id === documentId
              ? {
                  ...doc,
                  decision: 'approved' as const,
                  rejectionReason: null,
                  reviewedBy: actor,
                  reviewedAt: at,
                }
              : doc,
          ),
          audit: audited(entry, actor, 'Document approved', `${target.filename} approved.`),
        })),
      ),
    );
  },

  rejectDocument: async ({
    doctorId,
    documentId,
    actor,
    reason = '',
  }: DocumentDecisionInput): Promise<DoctorsDocument> => {
    const document = load();
    const doctor = requireDoctor(document, doctorId);
    const target = doctor.documents.find((entry) => entry.id === documentId);
    if (target === undefined) throw new DoctorsError('That document is no longer on file.');
    if (reason.trim().length === 0) {
      throw new DoctorsError('A rejection reason is required; the doctor is told what to fix.');
    }

    const at = new Date().toISOString();
    return delay(
      persist(
        patch(document, doctorId, (entry) => ({
          ...entry,
          documents: entry.documents.map((doc) =>
            doc.id === documentId
              ? {
                  ...doc,
                  decision: 'rejected' as const,
                  rejectionReason: reason.trim(),
                  reviewedBy: actor,
                  reviewedAt: at,
                }
              : doc,
          ),
          audit: audited(
            entry,
            actor,
            'Document rejected',
            `${target.filename} rejected: ${reason.trim()}`,
          ),
        })),
      ),
    );
  },

  /**
   * Completes verification. Re-checks the whole credential file rather than
   * trusting the caller: this is the decision that lets someone treat
   * patients on the platform.
   */
  completeVerification: async ({ doctorId, actor }: VerificationInput): Promise<DoctorsDocument> => {
    const document = load();
    const doctor = requireDoctor(document, doctorId);
    if (doctor.verification === 'verified') {
      throw new DoctorsError(`${doctor.name} is already verified.`);
    }
    if (!isVerifiable(doctor, Date.now())) {
      throw new DoctorsError(
        'Every required document must be approved and unexpired before verification can be completed.',
      );
    }

    return delay(
      persist(
        patch(document, doctorId, (entry) => ({
          ...entry,
          verification: 'verified' as const,
          verificationNote: null,
          audit: audited(
            entry,
            actor,
            'Verification completed',
            'All required documents approved and in date.',
          ),
        })),
      ),
    );
  },

  requestDocuments: async ({
    doctorId,
    actor,
    reason = '',
  }: VerificationInput): Promise<DoctorsDocument> => {
    const document = load();
    const doctor = requireDoctor(document, doctorId);
    if (doctor.verification === 'verified') {
      throw new DoctorsError(`${doctor.name} is already verified.`);
    }
    if (reason.trim().length === 0) {
      throw new DoctorsError('Say which documents are needed; the message goes to the doctor.');
    }

    return delay(
      persist(
        patch(document, doctorId, (entry) => ({
          ...entry,
          verification: 'docs-requested' as const,
          verificationNote: reason.trim(),
          audit: audited(entry, actor, 'Documents requested', reason.trim()),
        })),
      ),
    );
  },

  rejectApplication: async ({
    doctorId,
    actor,
    reason = '',
  }: VerificationInput): Promise<DoctorsDocument> => {
    const document = load();
    const doctor = requireDoctor(document, doctorId);
    if (doctor.verification === 'verified') {
      throw new DoctorsError(
        `${doctor.name} is verified. Suspend the account instead of rejecting the application.`,
      );
    }
    if (reason.trim().length === 0) {
      throw new DoctorsError('A rejection reason is required; it is communicated to the doctor.');
    }

    return delay(
      persist(
        patch(document, doctorId, (entry) => ({
          ...entry,
          verification: 'rejected' as const,
          verificationNote: reason.trim(),
          // A rejected application must not leave a live account behind.
          account: 'suspended' as const,
          suspensionReason: 'Automatically suspended when the application was rejected.',
          audit: audited(entry, actor, 'Application rejected', reason.trim()),
        })),
      ),
    );
  },

  /** Puts a rejected application back in the queue for a fresh look. */
  returnToReview: async ({ doctorId, actor }: VerificationInput): Promise<DoctorsDocument> => {
    const document = load();
    const doctor = requireDoctor(document, doctorId);
    if (doctor.verification !== 'rejected') {
      throw new DoctorsError('Only a rejected application can be returned to review.');
    }

    return delay(
      persist(
        patch(document, doctorId, (entry) => ({
          ...entry,
          verification: 'pending' as const,
          verificationNote: null,
          audit: audited(entry, actor, 'Returned to review', 'Application reopened for review.'),
        })),
      ),
    );
  },

  suspend: async ({ doctorId, actor, reason = '' }: AccountInput): Promise<DoctorsDocument> => {
    const document = load();
    const doctor = requireDoctor(document, doctorId);
    if (doctor.account === 'suspended') {
      throw new DoctorsError(`${doctor.name} is already suspended.`);
    }
    if (reason.trim().length === 0) {
      throw new DoctorsError('A suspension reason is required.');
    }

    return delay(
      persist(
        patch(document, doctorId, (entry) => ({
          ...entry,
          account: 'suspended' as const,
          suspensionReason: reason.trim(),
          audit: audited(entry, actor, 'Account suspended', reason.trim()),
        })),
      ),
    );
  },

  reactivate: async ({ doctorId, actor }: AccountInput): Promise<DoctorsDocument> => {
    const document = load();
    const doctor = requireDoctor(document, doctorId);
    if (doctor.account !== 'suspended') {
      throw new DoctorsError(`${doctor.name} is not suspended.`);
    }

    return delay(
      persist(
        patch(document, doctorId, (entry) => ({
          ...entry,
          account: 'active' as const,
          suspensionReason: null,
          audit: audited(entry, actor, 'Account reactivated', 'Suspension lifted.'),
        })),
      ),
    );
  },

  /**
   * Sends the doctor a credential-reset link. An administrator never sets a
   * password — the platform has no path that would let them, and this
   * records only that the link was sent.
   */
  resetAccess: async ({ doctorId, actor }: AccountInput): Promise<DoctorsDocument> => {
    const document = load();
    const doctor = requireDoctor(document, doctorId);

    return delay(
      persist(
        patch(document, doctorId, (entry) => ({
          ...entry,
          audit: audited(
            entry,
            actor,
            'Access reset sent',
            `A credential-reset link was sent to ${doctor.email}.`,
          ),
        })),
      ),
    );
  },

  /** The two administrative fields §3.3 allows an admin to change. */
  updateAdministrative: async ({
    doctorId,
    actor,
    fields,
  }: {
    doctorId: string;
    actor: string;
    fields: AdministrativeFields;
  }): Promise<DoctorsDocument> => {
    const document = load();
    const doctor = requireDoctor(document, doctorId);
    const changes: string[] = [];
    const before = doctor.administrative;
    if (fields.roleTemplate !== before?.roleTemplate) {
      changes.push(`role template ${before?.roleTemplate ?? '—'} → ${fields.roleTemplate}`);
    }
    if (fields.clinic !== before?.clinic) {
      changes.push(`clinic ${before?.clinic ?? '—'} → ${fields.clinic}`);
    }
    if (changes.length === 0) {
      throw new DoctorsError('Nothing changed.');
    }

    return delay(
      persist(
        patch(document, doctorId, (entry) => ({
          ...entry,
          administrative: fields,
          audit: audited(entry, actor, 'Administrative fields changed', changes.join(' · ')),
        })),
      ),
    );
  },

  /** Sends an onboarding invitation (§3.2). */
  invite: async ({
    email,
    specialty,
    roleTemplate,
    actor,
  }: InviteInput): Promise<DoctorsDocument> => {
    const document = load();
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      throw new DoctorsError('Enter a valid email address.');
    }
    if (document.doctors.some((doctor) => doctor.email.toLowerCase() === address)) {
      throw new DoctorsError('That address already belongs to a doctor on the platform.');
    }
    if (document.invites.some((invite) => invite.email.toLowerCase() === address)) {
      throw new DoctorsError('An invitation has already been sent to that address.');
    }

    const invite: DoctorInvite = {
      id: writeId('inv'),
      email: address,
      specialty,
      roleTemplate,
      invitedAt: new Date().toISOString(),
      invitedBy: actor,
    };
    return delay(persist({ ...document, invites: [invite, ...document.invites] }));
  },

  reset: (): Promise<DoctorsDocument> => delay(persist(DEFAULT_DOCTORS)),
} as const;
