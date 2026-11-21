import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness, dataOf } from './support/auth-app';
import { destroyLabFixtures, seedDoctor, seedPatient } from './support/lab-fixture';

/**
 * The record timeline is a total order (RA-M14.1, second site).
 *
 * ## The defect
 *
 * `occurred_at` defaults to `now()`, and Postgres `now()` is the
 * **transaction** timestamp — constant for every row written inside one
 * transaction, to the millisecond the column stores. Creating a record
 * writes `created` together with `diagnosis-added`, so that pair does not
 * merely *risk* a tie: it is always tied, and ordering by `occurred_at`
 * alone left their relative order to the executor.
 *
 * The lab timeline's instance of the same defect was closed by stamping
 * its paired events explicitly (`lab-orders-pipeline.e2e-spec.ts` asserts
 * those timestamps). The record pair is one act rather than two steps, so
 * it is closed by the projection's sort key instead — see the comment on
 * `timeline` in `record.repository.ts`.
 *
 * ## Why the events are written directly
 *
 * Driving the real API only catches the defect when the executor happens
 * to return the tied rows the wrong way round. This case **forces** it:
 * the events share one `occurred_at` and are written earliest-first, which
 * is the exact reverse of the newest-first sequence the timeline owes a
 * reader. Nothing but the tie-breaker can turn one into the other, so the
 * case fails without it and passes with it — every run, not some.
 */
let harness: AuthHarness;

const RECORDS = '/api/v1/medical-records';

interface TimelineEvent {
  id: string;
  kind: string;
  at: string;
}

interface RecordDetail {
  id: string;
  timeline: TimelineEvent[];
}

const charts: string[] = [];
let doctorToken = '';
let patient: { id: string; name: string; mrn: string };

beforeAll(async () => {
  harness = await createAuthHarness('record-timeline');

  doctorToken = await seedDoctor(harness, 'timeline-doctor');
  patient = await seedPatient(harness, doctorToken);
  charts.push(patient.id);
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (charts.length > 0) await destroyLabFixtures(harness, charts);

  await harness.reset();
  await harness.close();
});

describe('the record timeline is a total order, even when timestamps tie', () => {
  async function createRecord(): Promise<{ publicId: string; rowId: string }> {
    const publicId = dataOf<{ id: string }>(
      await request(harness.server)
        .post(RECORDS)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          patientId: patient.id,
          visitDate: '2026-05-08T09:00:00.000Z',
          visitType: 'Consultation',
          priority: 'normal',
          chiefComplaint: 'Timeline ordering',
          historyOfPresentIllness: 'N/A.',
          physicalExamination: 'N/A.',
        })
        .expect(201),
    ).id;

    const row = await harness.prisma.medicalRecord.findFirstOrThrow({
      where: { publicId },
      select: { id: true },
    });

    return { publicId, rowId: row.id };
  }

  async function timeline(publicId: string): Promise<TimelineEvent[]> {
    return dataOf<RecordDetail>(
      await request(harness.server)
        .get(`${RECORDS}/${publicId}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200),
    ).timeline;
  }

  it('sorts tied events deterministically, creation last', async () => {
    const record = await createRecord();

    // One instant for all of them, which is what a single transaction
    // produces — and written earliest-first, so insertion order is the
    // reverse of the sequence asserted below.
    const tiedAt = new Date('2026-05-08T10:00:00.000Z');
    for (const kind of ['CREATED', 'DIAGNOSIS_ADDED', 'NOTE_ADDED', 'STATUS_CHANGED'] as const) {
      await harness.prisma.recordTimelineEvent.create({
        data: { recordId: record.rowId, kind, occurredAt: tiedAt, actorName: 'Fixture' },
      });
    }

    const tied = (await timeline(record.publicId))
      .filter((event) => event.at === tiedAt.toISOString())
      .map((event) => event.kind);

    // `created` is the one event that is always a record's earliest, and
    // newest-first puts it at the bottom.
    expect(tied).toEqual(['status-changed', 'note-added', 'diagnosis-added', 'created']);
  });

  it('still orders by time first — a tie-break never outranks a later event', async () => {
    // The tie-breaker must only apply *within* an instant. If `kind`
    // leaked into the primary comparison, an early-declared kind that
    // happened later would sink below a late-declared one that happened
    // earlier, which would misreport the record's history far more
    // seriously than the tie ever did.
    const record = await createRecord();

    const earlier = new Date('2026-05-09T09:00:00.000Z');
    const later = new Date('2026-05-09T11:00:00.000Z');

    // `status-changed` is declared last but happened FIRST here;
    // `diagnosis-added` is declared earlier but happened later.
    await harness.prisma.recordTimelineEvent.create({
      data: {
        recordId: record.rowId,
        kind: 'STATUS_CHANGED',
        occurredAt: earlier,
        actorName: 'Fixture',
      },
    });
    await harness.prisma.recordTimelineEvent.create({
      data: {
        recordId: record.rowId,
        kind: 'DIAGNOSIS_ADDED',
        occurredAt: later,
        actorName: 'Fixture',
      },
    });

    const seen = (await timeline(record.publicId))
      .filter((event) => event.at === earlier.toISOString() || event.at === later.toISOString())
      .map((event) => event.kind);

    expect(seen).toEqual(['diagnosis-added', 'status-changed']);
  });
});
