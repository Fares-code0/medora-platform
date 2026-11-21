/**
 * Synthetic hospital dataset for performance work (RM M32).
 *
 *   PERF_PASSWORD=… DATABASE_URL=postgresql://…/medora_perf_… \
 *     npx tsx perf/dataset/generate.ts --scale small|medium|large
 *
 * ## It refuses every database that is not a disposable benchmark one
 *
 * Three guards, all before the first write:
 *
 *  1. The database **name** must start with `medora_perf`. The test
 *     database (`medora_test`), a developer database and any production
 *     name fail here.
 *  2. `APP_ENV` must not be `production`.
 *  3. The database must hold **no user that is not synthetic**: every
 *     `users.email` must end in `@perf.medora.test`. A database with one
 *     real account in it is not a benchmark database, whatever its name.
 *
 * The schema must already be migrated and the reference data seeded
 * (`db:deploy` then `db:seed:production`) — this script writes facts, not
 * vocabularies, and reads the vocabularies the seed wrote.
 *
 * ## What it writes
 *
 * Nothing real: names from short fixed lists, phone numbers in a reserved
 * range, `@perf.medora.test` addresses. Deterministic for a given
 * `PERF_SEED`, so two runs at one scale produce the same dataset and two
 * benchmarks compare like with like. Distributions are skewed the way a
 * clinic's are rather than uniform (see `perf/README.md`).
 *
 * Accounts: `perf-doctor-NNN@perf.medora.test`, all with `PERF_PASSWORD`
 * (required; never defaulted, never logged). `perf-doctor-001` also holds
 * a `logs.view` override, so the load suite can page the audit log
 * without enrolling a second factor.
 */

import 'dotenv/config';

import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';

type Scale = 'small' | 'medium' | 'large';

interface Volumes {
  readonly doctors: number;
  readonly patients: number;
  /** Mean appointments per patient. */
  readonly appointmentsPerPatient: number;
  readonly recordsPerPatient: number;
  readonly prescriptionsPerPatient: number;
  readonly labOrdersPerPatient: number;
  /** Mean notifications per doctor. */
  readonly notificationsPerDoctor: number;
  readonly conversations: number;
  readonly messagesPerConversation: number;
  readonly auditEvents: number;
}

export const SCALES: Readonly<Record<Scale, Volumes>> = {
  small: {
    doctors: 10,
    patients: 2_000,
    appointmentsPerPatient: 5,
    recordsPerPatient: 2,
    prescriptionsPerPatient: 1.5,
    labOrdersPerPatient: 1.5,
    notificationsPerDoctor: 2_000,
    conversations: 200,
    messagesPerConversation: 20,
    auditEvents: 20_000,
  },
  medium: {
    doctors: 40,
    patients: 20_000,
    appointmentsPerPatient: 6,
    recordsPerPatient: 2,
    prescriptionsPerPatient: 1.5,
    labOrdersPerPatient: 1.5,
    notificationsPerDoctor: 5_000,
    conversations: 2_000,
    messagesPerConversation: 20,
    auditEvents: 300_000,
  },
  large: {
    doctors: 120,
    patients: 100_000,
    appointmentsPerPatient: 6,
    recordsPerPatient: 2,
    prescriptionsPerPatient: 1.5,
    labOrdersPerPatient: 1.5,
    notificationsPerDoctor: 8_000,
    conversations: 8_000,
    messagesPerConversation: 25,
    auditEvents: 1_500_000,
  },
};

const BATCH = 5_000;
const DAY = 24 * 60 * 60 * 1_000;
const EMAIL_DOMAIN = 'perf.medora.test';

const FIRST = [
  'Amira',
  'Omar',
  'Layla',
  'Karim',
  'Nour',
  'Youssef',
  'Salma',
  'Hassan',
  'Mona',
  'Tarek',
  'Dina',
  'Ali',
  'Rana',
  'Fadi',
  'Hala',
  'Sami',
];
const LAST = [
  'Haddad',
  'Mansour',
  'Khalil',
  'Saleh',
  'Nasser',
  'Farouk',
  'Aziz',
  'Rahman',
  'Darwish',
  'Hamdan',
  'Ibrahim',
  'Zaki',
];
const SPECIALTIES = [
  'Cardiology',
  'Internal Medicine',
  'Pediatrics',
  'Neurology',
  'Dermatology',
  'Orthopedics',
  'Endocrinology',
];
const COMPLAINTS = [
  'Headache for two weeks',
  'Chest pain on exertion',
  'Persistent cough',
  'Lower back pain',
  'Fatigue and weight loss',
  'Rash on forearms',
  'Follow-up of hypertension',
  'Shortness of breath',
];

/** Mulberry32 — small, fast, and the same sequence for the same seed. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function main(): Promise<void> {
  const scale = (process.argv[process.argv.indexOf('--scale') + 1] ?? 'small') as Scale;
  if (!(scale in SCALES)) throw new Error(`Unknown scale "${scale}" — small, medium or large`);

  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('DATABASE_URL is not set');
  const password = process.env['PERF_PASSWORD'];
  if (password === undefined || password.length < 12) {
    throw new Error('PERF_PASSWORD must be set (12+ characters); it is never defaulted');
  }

  const database = new URL(url).pathname.replace(/^\//, '');
  if (!database.startsWith('medora_perf')) {
    throw new Error(`Refusing database "${database}": the name must start with "medora_perf"`);
  }
  if (process.env['APP_ENV'] === 'production') throw new Error('Refusing APP_ENV=production');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return generate(prisma, scale, password).finally(() => prisma.$disconnect());
}

async function generate(prisma: PrismaClient, scale: Scale, password: string): Promise<void> {
  const real = await prisma.user.count({
    where: { NOT: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
  });
  if (real > 0) {
    throw new Error(`Refusing: the database holds ${String(real)} non-synthetic user(s)`);
  }
  if ((await prisma.user.count()) > 0) {
    throw new Error('Refusing: synthetic data is already present — drop and recreate the database');
  }

  const v = SCALES[scale];
  const random = rng(Number(process.env['PERF_SEED'] ?? 32));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  /**
   * An index in [0, n) skewed toward the front — log-uniform, so index i
   * is chosen with weight ≈ 1/(i+1): a few doctors carry long lists.
   */
  const skewed = (n: number): number => Math.min(n - 1, Math.floor(n ** random()) - 1);
  const now = Date.now();
  const started = Date.now();
  const log = (what: string, count: number) =>
    console.info(
      `${what.padEnd(22)} ${String(count).padStart(9)}  (${String(Math.round((Date.now() - started) / 1000))} s)`,
    );

  const [doctorRole, visitTypes, medications, labTests, departments, logsView] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } }),
    prisma.visitType.findMany({ select: { id: true, name: true } }),
    prisma.medication.findMany({
      select: {
        id: true,
        route: true,
        strengths: { select: { strength: true }, orderBy: { position: 'asc' } },
      },
    }),
    prisma.labTestCatalogue.findMany({ select: { id: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.permission.findUniqueOrThrow({ where: { code: 'logs.view' } }),
  ]);
  if (visitTypes.length === 0 || medications.length === 0 || labTests.length === 0) {
    throw new Error('Reference data missing — run `npm run db:seed:production` first');
  }

  // ── Doctors ────────────────────────────────────────────────────────
  const passwordHash = await hash(password);
  const doctorUsers: Prisma.UserCreateManyInput[] = [];
  for (let i = 1; i <= v.doctors; i += 1) {
    const n = String(i).padStart(3, '0');
    const first = pick(FIRST);
    const last = pick(LAST);
    doctorUsers.push({
      publicId: `usr_perf_${n}`,
      firstName: first,
      lastName: last,
      displayName: `Dr. ${first} ${last}`,
      email: `perf-doctor-${n}@${EMAIL_DOMAIN}`,
      phone: `+20 100 000 ${n.padStart(4, '0')}`,
      roleId: doctorRole.id,
      termsAcceptedAt: new Date(now - 400 * DAY),
      privacyAcceptedAt: new Date(now - 400 * DAY),
      emailVerifiedAt: new Date(now - 400 * DAY),
    });
  }
  await prisma.user.createMany({ data: doctorUsers });
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    select: { id: true, publicId: true, displayName: true },
    orderBy: { publicId: 'asc' },
  });
  await prisma.userCredential.createMany({
    data: users.map((user) => ({ userId: user.id, passwordHash })),
  });
  await prisma.doctor.createMany({
    data: users.map((user, index) => ({
      userId: user.id,
      fullName: user.displayName,
      specialty: SPECIALTIES[index % SPECIALTIES.length] as string,
      licenseNumber: `PERF-LIC-${String(index + 1).padStart(5, '0')}`,
      contactEmail: `perf-doctor-${String(index + 1).padStart(3, '0')}@${EMAIL_DOMAIN}`,
      contactPhone: `+20 100 000 ${String(index + 1).padStart(4, '0')}`,
      departmentId: (departments[index % departments.length] as { id: string }).id,
    })),
  });
  const doctors = await prisma.doctor.findMany({
    select: { id: true, userId: true },
    orderBy: { licenseNumber: 'asc' },
  });
  await prisma.userPermission.create({
    data: { userId: (users[0] as { id: string }).id, permissionId: logsView.id, allowed: true },
  });
  log('doctors', doctors.length);

  // ── Patients and their care relationships ──────────────────────────
  const mrns = new Set<string>();
  const patientRows: Prisma.PatientCreateManyInput[] = [];
  for (let i = 0; i < v.patients; i += 1) {
    let mrn: string;
    do {
      const digits = String(Math.floor(random() * 1_000_000)).padStart(6, '0');
      mrn = `${digits.slice(0, 4)}-${digits.slice(4)}`;
    } while (mrns.has(mrn));
    mrns.add(mrn);
    const age = Math.floor(random() ** 0.8 * 92);
    patientRows.push({
      publicId: `PT-${String(100_000 + i)}`,
      mrn,
      fullName: `${pick(FIRST)} ${pick(LAST)} ${pick(LAST)}`,
      dateOfBirth: new Date(now - (age * 365 + Math.floor(random() * 365)) * DAY),
      gender: random() < 0.5 ? 'FEMALE' : 'MALE',
      bloodType: pick([
        'A_POSITIVE',
        'A_NEGATIVE',
        'B_POSITIVE',
        'O_POSITIVE',
        'O_NEGATIVE',
        'AB_POSITIVE',
      ] as const),
      phone: `+20 109 ${String(100 + (i % 900))} ${String(1000 + (i % 9000))}`,
      status: pick([
        'ACTIVE',
        'ACTIVE',
        'ACTIVE',
        'UNDER_TREATMENT',
        'FOLLOW_UP',
        'DISCHARGED',
        'CRITICAL',
      ] as const),
      riskLevel: pick(['LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'CRITICAL'] as const),
      registeredAt: new Date(now - Math.floor(random() * 3 * 365) * DAY),
    });
  }
  for (let i = 0; i < patientRows.length; i += BATCH) {
    await prisma.patient.createMany({ data: patientRows.slice(i, i + BATCH) });
  }
  const patients = await prisma.patient.findMany({
    select: { id: true },
    orderBy: { publicId: 'asc' },
  });
  log('patients', patients.length);

  // A patient's primary doctor is skewed: a few doctors carry large lists.
  const primaryOf = patients.map(
    () => doctors[skewed(doctors.length)] as { id: string; userId: string },
  );
  const assignments: Prisma.PatientDoctorAssignmentCreateManyInput[] = [];
  patients.forEach((patient, index) => {
    const primary = primaryOf[index] as { id: string };
    assignments.push({ patientId: patient.id, doctorId: primary.id, role: 'primary' });
    if (random() < 0.15) {
      const other = pick(doctors);
      if (other.id !== primary.id) assignments.push({ patientId: patient.id, doctorId: other.id });
    }
  });
  for (let i = 0; i < assignments.length; i += BATCH) {
    await prisma.patientDoctorAssignment.createMany({ data: assignments.slice(i, i + BATCH) });
  }
  log('assignments', assignments.length);

  // ── Appointments: two years back, sixty days ahead ─────────────────
  let appointmentCount = 0;
  let apt = 0;
  let batch: Prisma.AppointmentCreateManyInput[] = [];
  for (const [index, patient] of patients.entries()) {
    const count = Math.round(-Math.log(1 - random()) * v.appointmentsPerPatient);
    for (let k = 0; k < count; k += 1) {
      const day = Math.floor(random() * 790) - 730;
      const startsAt = new Date(
        Math.floor((now + day * DAY) / DAY) * DAY +
          (8 + Math.floor(random() * 18) / 2) * 60 * 60 * 1_000,
      );
      const past = startsAt.getTime() < now;
      const roll = random();
      const status = past
        ? roll < 0.72
          ? 'COMPLETED'
          : roll < 0.82
            ? 'NO_SHOW'
            : 'CANCELLED'
        : roll < 0.45
          ? 'SCHEDULED'
          : roll < 0.8
            ? 'CONFIRMED'
            : 'PENDING';
      batch.push({
        publicId: `APT-${String(1_000_000 + apt++)}`,
        patientId: patient.id,
        doctorId: (primaryOf[index] as { id: string }).id,
        visitTypeId: pick(visitTypes).id,
        startsAt,
        durationMin: pick([15, 20, 30, 30, 45]),
        status,
        priority: pick(['NORMAL', 'NORMAL', 'NORMAL', 'HIGH', 'URGENT', 'LOW'] as const),
        reason: pick(COMPLAINTS),
        ...(status === 'CANCELLED'
          ? { cancelledReason: 'Patient request', cancelledAt: startsAt }
          : {}),
        ...(status === 'COMPLETED' ? { completedAt: startsAt } : {}),
      });
      if (batch.length === BATCH) {
        await prisma.appointment.createMany({ data: batch });
        appointmentCount += batch.length;
        batch = [];
      }
    }
  }
  await prisma.appointment.createMany({ data: batch });
  appointmentCount += batch.length;
  log('appointments', appointmentCount);

  // ── Records, prescriptions, lab orders ─────────────────────────────
  const recordRows: Prisma.MedicalRecordCreateManyInput[] = [];
  const rxRows: Prisma.PrescriptionCreateManyInput[] = [];
  const labRows: Prisma.LabOrderCreateManyInput[] = [];
  const poisson = (mean: number) => Math.round(-Math.log(1 - random()) * mean);
  patients.forEach((patient, index) => {
    const doctor = primaryOf[index] as { id: string; userId: string };
    for (let k = poisson(v.recordsPerPatient); k > 0; k -= 1) {
      const visitDate = new Date(now - Math.floor(random() * 700) * DAY);
      recordRows.push({
        publicId: `MR-${String(1_000_000 + recordRows.length)}`,
        patientId: patient.id,
        doctorId: doctor.id,
        visitDate,
        visitType: pick(visitTypes).name,
        chiefComplaint: pick(COMPLAINTS),
        historyOfPresentIllness: 'Synthetic history for performance testing.',
        physicalExamination: 'Synthetic examination for performance testing.',
        status: pick([
          'ACTIVE',
          'COMPLETED',
          'COMPLETED',
          'COMPLETED',
          'DRAFT',
          'ARCHIVED',
        ] as const),
        priority: pick(['NORMAL', 'NORMAL', 'NORMAL', 'HIGH', 'LOW', 'CRITICAL'] as const),
      });
    }
    for (let k = poisson(v.prescriptionsPerPatient); k > 0; k -= 1) {
      const medication = pick(medications);
      const start = new Date(now - Math.floor(random() * 600) * DAY);
      const days = pick([7, 10, 14, 30, 90]);
      const signed = random() > 0.08;
      const end = new Date(start.getTime() + days * DAY);
      rxRows.push({
        publicId: `RX-${String(1_000_000 + rxRows.length)}`,
        patientId: patient.id,
        medicationId: medication.id,
        prescribingDoctorId: doctor.id,
        strength: medication.strengths[0]?.strength ?? '500 mg',
        dosage: '1 tablet',
        frequency: 'Twice daily',
        route: medication.route,
        durationDays: days,
        quantity: days * 2,
        instructions: 'Synthetic instructions.',
        startDate: start,
        endDate: end,
        status: !signed ? 'DRAFT' : end.getTime() < now ? 'COMPLETED' : 'ACTIVE',
        ...(signed ? { signedAt: start } : {}),
      });
    }
    for (let k = poisson(v.labOrdersPerPatient); k > 0; k -= 1) {
      const requestedAt = new Date(now - Math.floor(random() * 500) * DAY);
      labRows.push({
        publicId: `LAB-${String(1_000_000 + labRows.length)}`,
        patientId: patient.id,
        testId: pick(labTests).id,
        orderedBy: doctor.id,
        clinicalIndication: 'Synthetic indication.',
        priority: pick(['ROUTINE', 'ROUTINE', 'ROUTINE', 'URGENT', 'STAT'] as const),
        status:
          requestedAt.getTime() < now - 3 * DAY
            ? 'COMPLETED'
            : pick(['ORDERED', 'COLLECTED', 'PROCESSING'] as const),
        requestedAt,
      });
    }
  });
  for (const [label, rows, write] of [
    ['medical records', recordRows, (data: never[]) => prisma.medicalRecord.createMany({ data })],
    ['prescriptions', rxRows, (data: never[]) => prisma.prescription.createMany({ data })],
    ['lab orders', labRows, (data: never[]) => prisma.labOrder.createMany({ data })],
  ] as const) {
    for (let i = 0; i < rows.length; i += BATCH) await write(rows.slice(i, i + BATCH) as never[]);
    log(label, rows.length);
  }

  // ── Notifications: skewed per doctor, most already read ────────────
  let notificationCount = 0;
  for (const [index, doctor] of doctors.entries()) {
    const total = Math.round(v.notificationsPerDoctor * (index < doctors.length / 5 ? 2.5 : 0.6));
    for (let i = 0; i < total; i += BATCH) {
      const rows: Prisma.NotificationCreateManyInput[] = [];
      for (let j = i; j < Math.min(total, i + BATCH); j += 1) {
        const createdAt = new Date(now - Math.floor(random() * 180 * DAY));
        const read = random() < 0.85;
        rows.push({
          recipientId: doctor.userId,
          title: pick([
            'Appointment request',
            'Critical lab result released',
            'Appointment confirmed',
            'New message',
          ]),
          body: 'Open Medora for details.',
          category: pick(['APPOINTMENTS', 'LABORATORY', 'MEDICAL_RECORDS', 'SYSTEM'] as const),
          priority: random() < 0.03 ? 'CRITICAL' : 'NORMAL',
          kind: pick(['UPDATE', 'ALERT', 'REMINDER'] as const),
          sender: 'Medora',
          createdAt,
          ...(read ? { readAt: createdAt } : {}),
          archived: read && random() < 0.3,
        });
      }
      await prisma.notification.createMany({ data: rows });
      notificationCount += rows.length;
    }
  }
  log('notifications', notificationCount);

  // ── Conversations between doctors ──────────────────────────────────
  const conversationIds: string[] = [];
  for (let i = 0; i < v.conversations; i += 1) {
    const created = await prisma.conversation.create({
      data: {
        kind: 'DIRECT',
        topic: `Case review ${String(i)}`,
        lastActivityAt: new Date(now - Math.floor(random() * 90) * DAY),
      },
      select: { id: true },
    });
    conversationIds.push(created.id);
  }
  const participants: Prisma.ConversationParticipantCreateManyInput[] = [];
  const pairs = conversationIds.map((conversationId) => {
    const a = doctors[skewed(doctors.length)] as { userId: string };
    let b = pick(doctors);
    if (b.userId === a.userId) b = doctors[(doctors.indexOf(b) + 1) % doctors.length] as typeof b;
    participants.push(
      { conversationId, userId: a.userId, unreadCount: Math.floor(random() * 3) },
      { conversationId, userId: b.userId, unreadCount: Math.floor(random() * 3) },
    );
    return { conversationId, authors: [a.userId, b.userId] };
  });
  await prisma.conversationParticipant.createMany({ data: participants });
  const messages: Prisma.MessageCreateManyInput[] = [];
  for (const { conversationId, authors } of pairs) {
    for (let k = poisson(v.messagesPerConversation); k > 0; k -= 1) {
      messages.push({
        conversationId,
        authorId: pick(authors),
        body: 'Synthetic clinical discussion for performance testing.',
        sentAt: new Date(now - Math.floor(random() * 90 * DAY)),
        status: 'READ',
      });
    }
  }
  for (let i = 0; i < messages.length; i += BATCH) {
    await prisma.message.createMany({ data: messages.slice(i, i + BATCH) });
  }
  log('conversations', conversationIds.length);
  log('messages', messages.length);

  // ── Audit events: the last sixty days ──────────────────────────────
  const actions = [
    'patient.view',
    'medical_record.view',
    'appointment.approve',
    'prescription.sign',
    'lab_order.review',
    'auth.login',
  ];
  for (let i = 0; i < v.auditEvents; i += BATCH) {
    const rows: Prisma.AuditEventCreateManyInput[] = [];
    for (let j = i; j < Math.min(v.auditEvents, i + BATCH); j += 1) {
      const actor = doctors[skewed(doctors.length)] as { userId: string };
      const action = pick(actions);
      rows.push({
        occurredAt: new Date(now - Math.floor(random() * 60 * DAY)),
        actorId: actor.userId,
        actorRole: 'doctor',
        category: action.startsWith('auth.') ? 'AUTHENTICATION' : 'USER_ACTION',
        eventType: action,
        severity: 'INFO',
        summary: `Synthetic ${action}`,
        target: `${action.split('.')[0] ?? 'entity'}:synthetic`,
      });
    }
    await prisma.auditEvent.createMany({ data: rows });
  }
  log('audit events', v.auditEvents);

  await prisma.$executeRawUnsafe('ANALYZE');
  console.info(`Synthetic dataset "${scale}" complete — ANALYZE run.`);
}

main().catch((error: unknown) => {
  console.error('Dataset generation failed:', error);
  process.exit(1);
});
