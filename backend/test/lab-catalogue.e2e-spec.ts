import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * The test catalogue (RM M14.1 — API §8.1).
 *
 * The verify step is "**reference + critical ranges served per
 * analyte**", and it is a real requirement rather than a completeness
 * one: the client renders a released value against the interval it was
 * judged by, and the ordering form previews it so a clinician knows what
 * the lab will call abnormal. An endpoint that served the analyte names
 * and left the thresholds out would leave the client inventing them.
 *
 * The assertions are against the **seeded** catalogue
 * (`prisma/seed/catalogues.ts` — five tests, nineteen analytes), so a
 * seed change that drops a threshold fails here.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const CATALOGUE = '/api/v1/lab-tests/catalogue';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

interface AnalyteSpecView {
  id: string;
  analyte: string;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  decimals: number;
  criticalLow: number | null;
  criticalHigh: number | null;
  qualitativeOptions: string[];
  referenceText: string;
}

interface TestCatalogueView {
  id: string;
  name: string;
  code: string;
  category: string;
  specimenType: string;
  container: string;
  active: boolean;
  analytes: AnalyteSpecView[];
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

let doctorToken = '';

async function seedDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  return dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

function get(token: string, query = ''): request.Test {
  return request(harness.server)
    .get(`${CATALOGUE}${query}`)
    .set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  harness = await createAuthHarness('lab-catalogue');
  doctorToken = await seedDoctor('catalogue-doctor');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

describe('RM M14.1 verify — reference and critical ranges per analyte', () => {
  it('serves both bounds and both thresholds for a numeric analyte', async () => {
    const response = await get(doctorToken, '?q=Basic Metabolic');
    expect(response.status).toBe(200);

    const page = dataOf<Page<TestCatalogueView>>(response);
    const panel = page.items.find((item) => item.code === '51990-0');
    expect(panel).toBeDefined();

    const potassium = panel?.analytes.find((analyte) => analyte.analyte === 'Potassium');

    // The seed's values, read back through the API. Numbers, not
    // `Decimal` objects: `{"s":1,"e":0,"d":[4]}` on the wire is
    // something no client can chart.
    expect(potassium).toMatchObject({
      unit: 'mmol/L',
      refLow: 3.5,
      refHigh: 5.1,
      criticalLow: 2.5,
      criticalHigh: 6,
      decimals: 1,
    });
  });

  it('serves a one-sided critical threshold as one-sided, not as zero', () => {
    // TSH has a `criticalHigh` and deliberately no `criticalLow`: a
    // suppressed TSH is not the emergency an extremely high one is. A
    // null coerced to 0 would make every TSH critically low.
    return get(doctorToken, '?q=Thyroid').expect(200).then((response) => {
      const panel = dataOf<Page<TestCatalogueView>>(response).items[0];
      const tsh = panel?.analytes.find((analyte) => analyte.analyte === 'TSH');

      expect(tsh?.criticalLow).toBeNull();
      expect(tsh?.criticalHigh).toBe(50);
    });
  });

  it('words the reference range once, at the analyte own precision', async () => {
    const response = await get(doctorToken, '?q=Basic Metabolic');
    const panel = dataOf<Page<TestCatalogueView>>(response).items[0];
    const potassium = panel?.analytes.find((analyte) => analyte.analyte === 'Potassium');
    const sodium = panel?.analytes.find((analyte) => analyte.analyte === 'Sodium');

    // En dash, and `decimals` digits on each side — the same function
    // the released result's `refText` is snapshotted from, so the order
    // form and the report cannot word one interval two ways.
    expect(potassium?.referenceText).toBe('3.5–5.1');
    expect(sodium?.referenceText).toBe('135–145');
  });

  it('serves every analyte of the panel, not a sample of them', async () => {
    const response = await get(doctorToken, '?q=Complete Blood');
    const panel = dataOf<Page<TestCatalogueView>>(response).items[0];

    expect(panel?.analytes.map((analyte) => analyte.analyte).sort()).toEqual([
      'Hematocrit',
      'Hemoglobin',
      'Platelets',
      'RBC',
      'WBC',
    ]);
  });

  it('carries the specimen type and container the draw needs', async () => {
    // A phlebotomist reading "EDTA (lavender top)" off the order draws
    // into the right tube; the specimen capture at §8.5 is filled from
    // these, so they are part of the catalogue rather than a nicety.
    const response = await get(doctorToken, '?q=Complete Blood');
    const panel = dataOf<Page<TestCatalogueView>>(response).items[0];

    expect(panel).toMatchObject({
      specimenType: 'Whole blood',
      container: 'EDTA (lavender top)',
    });
  });
});

describe('the catalogue listing', () => {
  it('serves the whole seeded catalogue with no query', async () => {
    const page = dataOf<Page<TestCatalogueView>>(await get(doctorToken).expect(200));

    expect(page.totalItems).toBe(5);
    expect(page.items).toHaveLength(5);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(20);
  });

  it('matches mid-word on the name, which is what a typeahead must do', async () => {
    // `contains` + insensitive is `ILIKE '%q%'`, which is what the
    // `gin_trgm_ops` index answers. `startsWith` would find nothing here.
    const page = dataOf<Page<TestCatalogueView>>(
      await get(doctorToken, '?q=metabolic').expect(200),
    );

    expect(page.items.map((item) => item.code)).toEqual(['51990-0']);
  });

  it('matches the LOINC code as well as the name', async () => {
    const page = dataOf<Page<TestCatalogueView>>(
      await get(doctorToken, '?q=4548-4').expect(200),
    );

    expect(page.items.map((item) => item.name)).toEqual(['Hemoglobin A1c']);
  });

  it('filters by category using the capitalised wire value', async () => {
    const page = dataOf<Page<TestCatalogueView>>(
      await get(doctorToken, '?category=Hormones').expect(200),
    );

    expect(page.items.map((item) => item.name)).toEqual(['Thyroid Panel']);
    expect(page.items[0]?.category).toBe('Hormones');
  });

  it('refuses a category outside the vocabulary with a 422', async () => {
    // `Blood Bank` is a member and `blood bank` is not: DB §E1 declares
    // the capitalised spelling and the frontend renders the literal, so
    // a mechanical lower-casing would produce a value no client knows.
    const response = await get(doctorToken, '?category=hormones');

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('validation_failed');
  });

  it('pages, and reports zero pages for an empty result rather than one', async () => {
    const page = dataOf<Page<TestCatalogueView>>(
      await get(doctorToken, '?q=nothing-matches-this').expect(200),
    );

    expect(page.items).toEqual([]);
    expect(page.totalItems).toBe(0);
    expect(page.totalPages).toBe(0);
  });

  it('honours page and pageSize', async () => {
    const page = dataOf<Page<TestCatalogueView>>(
      await get(doctorToken, '?page=2&pageSize=2').expect(200),
    );

    expect(page.items).toHaveLength(2);
    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(3);
  });

  it('hides a withdrawn test by default and shows it on request', async () => {
    const test = await harness.prisma.labTestCatalogue.findFirstOrThrow({
      where: { code: '4548-4' },
      select: { id: true },
    });

    await harness.prisma.labTestCatalogue.update({
      where: { id: test.id },
      data: { active: false },
    });

    try {
      const hidden = dataOf<Page<TestCatalogueView>>(
        await get(doctorToken, '?q=A1c').expect(200),
      );
      expect(hidden.items).toEqual([]);

      // A withdrawn test is still referenced by orders written before it
      // was withdrawn, so it is filtered rather than deleted.
      const shown = dataOf<Page<TestCatalogueView>>(
        await get(doctorToken, '?q=A1c&includeInactive=true').expect(200),
      );
      expect(shown.items.map((item) => item.active)).toEqual([false]);
    } finally {
      await harness.prisma.labTestCatalogue.update({
        where: { id: test.id },
        data: { active: true },
      });
    }
  });

  it('reads includeInactive=false as false, not as truthy', async () => {
    // `z.coerce.boolean()` maps every non-empty string to true, so
    // `?includeInactive=false` would *show* withdrawn tests — the
    // opposite of what was asked.
    const page = dataOf<Page<TestCatalogueView>>(
      await get(doctorToken, '?includeInactive=false').expect(200),
    );

    expect(page.items.every((item) => item.active)).toBe(true);
  });

  it('refuses a boolean that is neither true nor false', async () => {
    expect((await get(doctorToken, '?includeInactive=yes')).status).toBe(422);
  });
});

describe('the catalogue is guarded', () => {
  it('refuses an unauthenticated request', async () => {
    expect((await request(harness.server).get(CATALOGUE)).status).toBe(401);
  });

  it('refuses a patient account, which holds no lab capability', async () => {
    // A drug formulary tells an attacker which controlled substances a
    // clinic stocks; a test catalogue is less sensitive and still has no
    // reader in the patient app. `labs.review` is held by `doctor` and
    // `laboratory` and by nobody else.
    const email = testEmail('catalogue-patient');
    await request(harness.server).post(REGISTER).send({
      firstName: 'Sara',
      lastName: 'Ali',
      email,
      phone: '+20 100 555 1212',
      password: PASSWORD,
      confirmPassword: PASSWORD,
      role: 'patient',
      acceptTerms: true,
      acceptPrivacy: true,
    });
    await markVerified(harness.prisma, email);

    const token = dataOf<SessionPayload>(
      await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false }),
    ).accessToken;

    expect((await get(token)).status).toBe(403);
  });
});
