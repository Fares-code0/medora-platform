import { apiClient } from '@/api/client';
import {
  asRecord,
  fetchAllPages,
  malformedResponse,
  notConnected,
  readArray,
  readBoolean,
  readData,
  readEnum,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readString,
} from '@/api/http';
import {
  LAB_CATEGORIES,
  LAB_PRIORITIES,
  LAB_STATUSES,
  type AnalyteSpec,
  type LabAttachmentKind,
  type LabResultFlag,
  type LabSpecimen,
  type LabSpecimenCondition,
  type LabSpecimenType,
  type LabTest,
  type LabTimelineKind,
  type TestSpec,
} from '@/features/shared-domain/lab-studies';
import { readPatientBloodType, type Gender } from '@/features/shared-domain/patient-identity';
import { isApiError } from '@/types/api';

import { assertAnnotatable } from '../model/annotation';
import { LAB_NOT_FOUND, type LabService } from '../model/lab-service';
import { assertOrderable } from '../model/ordering';
import { assertReviewable } from '../model/review';
import type { PatientLabTrends, ServedTrend } from '../model/trends';

/**
 * The laboratory over HTTP (FE-10.7) — API §8, `backend/src/modules/labs`.
 *
 * | Port method        | Endpoint                                          |
 * | ------------------ | ------------------------------------------------- |
 * | `listCatalogue`    | `GET /lab-tests/catalogue` (active tests)         |
 * | `listLabTests`     | `GET /lab-orders`, then `GET /lab-orders/{id}` each |
 * | `getLabTest`       | `GET /lab-orders/{id}`                            |
 * | `getTrends`        | `GET /patients/{id}/lab-trends?analytes=a,b,c`    |
 * | `markReviewed`     | `POST /lab-orders/{id}/review`                    |
 * | `markManyReviewed` | `POST /lab-orders/review` (`bulk: true`)          |
 * | `orderLabs`        | `POST /lab-orders`, one per test                  |
 * | `annotate`         | not connected — the API has no annotation route   |
 *
 * ## Why the list loads each order's full document
 *
 * `GET /lab-orders` serves a summary — counts, not results — and every
 * rule this screen keeps is a rule about results: a critical value must be
 * acknowledged before review, bulk review is for all-normal results only,
 * the flag filters and the trend drawer read the values. Re-deriving those
 * from counts would be a second, weaker copy of rules that already exist,
 * so the adapter reads each order's detail (§8.3, which is not an audited
 * read) a few at a time. The cost is one request per order; the backend
 * finding that would remove it — results on the list — is recorded in the
 * FE-10 report.
 *
 * ## What the wire does not carry
 *
 * - **The review's acknowledgment.** The server records which critical
 *   values were acknowledged and the note, but serves only who reviewed
 *   and when — so `acknowledgedCriticalIds` and `note` are `null`, never
 *   an invented empty list.
 * - **Annotations.** There is no endpoint; `capabilities.annotations` is
 *   false, the list is empty because none can exist, and `annotate`
 *   refuses as not connected.
 * - **`department`** is optional on the server and shown as "—" when absent.
 */

const GENDERS: readonly Gender[] = ['female', 'male'];
const FLAGS: readonly LabResultFlag[] = [
  'normal',
  'low',
  'high',
  'critical-low',
  'critical-high',
  'abnormal',
];
const SPECIMEN_TYPES: readonly LabSpecimenType[] = [
  'Serum',
  'Plasma',
  'Whole blood',
  'Urine',
  'Swab',
  'Tissue biopsy',
  'Stool',
  'Sputum',
  'CSF',
];
const SPECIMEN_CONDITIONS: readonly LabSpecimenCondition[] = [
  'Acceptable',
  'Hemolyzed',
  'Clotted',
  'Insufficient volume',
];
const ATTACHMENT_KINDS: readonly LabAttachmentKind[] = [
  'report',
  'addendum',
  'external',
  'raw-data',
];
const TIMELINE_KINDS: readonly LabTimelineKind[] = [
  'ordered',
  'collected',
  'received',
  'processing',
  'resulted',
  'verified',
  'cancelled',
];

/** How many order documents are read at once when loading the list. */
const DETAIL_CONCURRENCY = 6;

function readStrings(dto: Record<string, unknown>, key: string, what: string): readonly string[] {
  return readArray(dto, key, what).map((entry) => {
    if (typeof entry !== 'string') throw malformedResponse(`${what}.${key}`);
    return entry;
  });
}

/** `LabTestView` (API §8.1) → a catalogue entry. */
export function toTestSpec(value: unknown): TestSpec {
  const what = 'lab test';
  const dto = asRecord(value, what);
  return {
    name: readString(dto, 'name', what),
    code: readString(dto, 'code', what),
    category: readEnum(dto, 'category', LAB_CATEGORIES, what),
    specimen: readEnum(dto, 'specimenType', SPECIMEN_TYPES, what),
    container: readString(dto, 'container', what),
    analytes: readArray(dto, 'analytes', what).map((entry): AnalyteSpec => {
      const analyte = asRecord(entry, 'lab test.analytes');
      const decimals = readOptionalNumber(analyte, 'decimals', 'lab test.analytes');
      const criticalLow = readOptionalNumber(analyte, 'criticalLow', 'lab test.analytes');
      const criticalHigh = readOptionalNumber(analyte, 'criticalHigh', 'lab test.analytes');
      const qualitative = readStrings(analyte, 'qualitativeOptions', 'lab test.analytes');
      return {
        analyte: readString(analyte, 'analyte', 'lab test.analytes'),
        unit: readString(analyte, 'unit', 'lab test.analytes'),
        low: readOptionalNumber(analyte, 'refLow', 'lab test.analytes'),
        high: readOptionalNumber(analyte, 'refHigh', 'lab test.analytes'),
        ...(decimals === null ? {} : { decimals }),
        ...(criticalLow === null ? {} : { criticalLow }),
        ...(criticalHigh === null ? {} : { criticalHigh }),
        ...(qualitative.length === 0 ? {} : { qualitative }),
      };
    }),
  };
}

function toSpecimen(value: unknown): LabSpecimen | null {
  if (value === null) return null;
  const what = 'lab order.specimen';
  const dto = asRecord(value, what);
  return {
    type: readEnum(dto, 'type', SPECIMEN_TYPES, what),
    container: readString(dto, 'container', what),
    collectionSite: readString(dto, 'collectionSite', what),
    collectedBy: readString(dto, 'collectedBy', what),
    collectedAt: readString(dto, 'collectedAt', what),
    receivedAt: readOptionalString(dto, 'receivedAt', what),
    condition: readEnum(dto, 'condition', SPECIMEN_CONDITIONS, what),
    volume: readString(dto, 'volume', what),
  };
}

/** `LabOrderDetailView` (API §8.3) → the order with its results. */
export function toLabTest(value: unknown): LabTest {
  const what = 'lab order';
  const dto = asRecord(value, what);
  const patient = asRecord(dto.patient, 'lab order.patient');
  const review = dto.review === null ? null : asRecord(dto.review, 'lab order.review');

  return {
    id: readString(dto, 'id', what),
    patient: {
      id: readString(patient, 'id', 'lab order.patient'),
      name: readString(patient, 'name', 'lab order.patient'),
      mrn: readString(patient, 'mrn', 'lab order.patient'),
      age: readNumber(patient, 'age', 'lab order.patient'),
      gender: readEnum(patient, 'gender', GENDERS, 'lab order.patient'),
      bloodType: readPatientBloodType(patient, 'lab order.patient'),
      phone: readString(patient, 'phone', 'lab order.patient'),
    },
    testName: readString(dto, 'testName', what),
    testCode: readString(dto, 'testCode', what),
    category: readEnum(dto, 'category', LAB_CATEGORIES, what),
    department: readOptionalString(dto, 'department', what) ?? '—',
    orderedBy: readString(dto, 'orderedBy', what),
    clinicalIndication: readString(dto, 'clinicalIndication', what),
    status: readEnum(dto, 'status', LAB_STATUSES, what),
    priority: readEnum(dto, 'priority', LAB_PRIORITIES, what),
    requestedDate: readString(dto, 'requestedDate', what),
    collectedDate: readOptionalString(dto, 'collectedDate', what),
    completedDate: readOptionalString(dto, 'completedDate', what),
    specimen: toSpecimen(dto.specimen),
    results: readArray(dto, 'results', what).map((entry) => {
      const result = asRecord(entry, 'lab order.results');
      const range = asRecord(result.referenceRange, 'lab order.results.referenceRange');
      return {
        id: readString(result, 'id', 'lab order.results'),
        analyte: readString(result, 'analyte', 'lab order.results'),
        value: readString(result, 'value', 'lab order.results'),
        numericValue: readOptionalNumber(result, 'numericValue', 'lab order.results'),
        unit: readString(result, 'unit', 'lab order.results'),
        referenceRange: {
          low: readOptionalNumber(range, 'low', 'lab order.results.referenceRange'),
          high: readOptionalNumber(range, 'high', 'lab order.results.referenceRange'),
          text: readString(range, 'text', 'lab order.results.referenceRange'),
        },
        flag: readEnum(result, 'flag', FLAGS, 'lab order.results'),
      };
    }),
    interpretation: readOptionalString(dto, 'interpretation', what),
    hasCriticalResult: readBoolean(dto, 'hasCriticalResult', what),
    review:
      review === null
        ? null
        : {
            reviewedAt: readString(review, 'reviewedAt', 'lab order.review'),
            reviewedBy: readString(review, 'reviewedBy', 'lab order.review'),
            acknowledgedCriticalIds: null,
            note: null,
          },
    attachments: readArray(dto, 'attachments', what).map((entry) => {
      const attachment = asRecord(entry, 'lab order.attachments');
      return {
        id: readString(attachment, 'id', 'lab order.attachments'),
        name: readString(attachment, 'name', 'lab order.attachments'),
        kind: readEnum(attachment, 'kind', ATTACHMENT_KINDS, 'lab order.attachments'),
        sizeKb: readNumber(attachment, 'sizeKb', 'lab order.attachments'),
        uploadedBy: readString(attachment, 'uploadedBy', 'lab order.attachments'),
        uploadedAt: readString(attachment, 'uploadedAt', 'lab order.attachments'),
      };
    }),
    annotations: [],
    timeline: readArray(dto, 'timeline', what).map((entry) => {
      const event = asRecord(entry, 'lab order.timeline');
      return {
        id: readString(event, 'id', 'lab order.timeline'),
        kind: readEnum(event, 'kind', TIMELINE_KINDS, 'lab order.timeline'),
        at: readString(event, 'at', 'lab order.timeline'),
        actor: readString(event, 'actor', 'lab order.timeline'),
        detail: readString(event, 'detail', 'lab order.timeline'),
      };
    }),
    createdAt: readString(dto, 'createdAt', what),
    updatedAt: readString(dto, 'updatedAt', what),
  };
}

const orderPath = (id: string) => `/lab-orders/${encodeURIComponent(id)}`;

/**
 * `LabTrendsView` (API §8.8) → the port's trends.
 *
 * The response echoes the patient so a cached answer cannot be read against
 * another chart; one that names someone else is refused, not plotted.
 */
export function toPatientLabTrends(value: unknown, patientId: string): PatientLabTrends {
  const what = 'lab trends';
  const dto = asRecord(value, what);
  if (readString(dto, 'patientId', what) !== patientId)
    throw malformedResponse(`${what}.patientId`);
  return {
    series: readArray(dto, 'series', what).map((entry): ServedTrend => {
      const series = asRecord(entry, `${what}.series`);
      return {
        analyte: readString(series, 'analyte', `${what}.series`),
        unit: readString(series, 'unit', `${what}.series`),
        referenceLow: readOptionalNumber(series, 'referenceLow', `${what}.series`),
        referenceHigh: readOptionalNumber(series, 'referenceHigh', `${what}.series`),
        referenceText: readString(series, 'referenceText', `${what}.series`),
        points: readArray(series, 'points', `${what}.series`).map((item) => {
          const point = asRecord(item, `${what}.points`);
          return {
            labId: readString(point, 'labId', `${what}.points`),
            at: readString(point, 'at', `${what}.points`),
            value: readNumber(point, 'value', `${what}.points`),
            flag: readEnum(point, 'flag', FLAGS, `${what}.points`),
          };
        }),
      };
    }),
    empty: readStrings(dto, 'empty', what),
  };
}

async function readOrder(request: Promise<unknown>): Promise<LabTest> {
  try {
    return toLabTest(readData(await request, 'lab order'));
  } catch (error) {
    if (isApiError(error) && error.kind === 'not_found') throw new Error(LAB_NOT_FOUND);
    throw error;
  }
}

/**
 * Every item, `limit` at a time, in the input's order.
 *
 * The queue stops taking items once `signal` aborts or any item fails:
 * `Promise.all` rejects on the first failure but cannot stop the other
 * workers, so without the check a cancelled or failed worklist read went on
 * issuing the rest of its (up to 2,000) detail GETs nobody would read.
 */
async function mapLimited<T, U>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<U>,
  signal?: AbortSignal,
): Promise<U[]> {
  const out = new Array<U>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (next < items.length && !failed) {
      signal?.throwIfAborted();
      const index = next;
      next += 1;
      const item = items[index] as T;
      try {
        out[index] = await fn(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * The worklist: every order's summary, then each order's detail. `signal`
 * (TanStack's, from the query function) cancels the drain and the detail
 * queue when the query is cancelled or its last observer unmounts.
 */
export async function listLabTests(
  options: { readonly signal?: AbortSignal } = {},
): Promise<readonly LabTest[]> {
  const { signal } = options;
  const transport = signal === undefined ? {} : { signal };
  const summaries = await fetchAllPages(
    (page, pageSize) =>
      apiClient.get('/lab-orders', { page, pageSize, sort: 'requestedAt:desc' }, transport),
    'lab orders',
  );
  return mapLimited(
    summaries.map(idOf),
    DETAIL_CONCURRENCY,
    (id) => readOrder(apiClient.get(orderPath(id), undefined, transport)),
    signal,
  );
}

function idOf(value: unknown): string {
  return readString(asRecord(value, 'lab order'), 'id', 'lab order');
}

export const httpLabService: LabService = {
  capabilities: { annotations: false, transmits: true },

  async listCatalogue() {
    const items = await fetchAllPages(
      (page, pageSize) => apiClient.get('/lab-tests/catalogue', { page, pageSize }),
      'lab catalogue',
    );
    return items
      .filter((item) => readBoolean(asRecord(item, 'lab test'), 'active', 'lab test'))
      .map(toTestSpec);
  },

  listLabTests,

  getLabTest(labId) {
    return readOrder(apiClient.get(orderPath(labId)));
  },

  async getTrends(patientId, analytes) {
    const body = await apiClient.get(`/patients/${encodeURIComponent(patientId)}/lab-trends`, {
      analytes: analytes.join(','),
    });
    return toPatientLabTrends(readData(body, 'lab trends'), patientId);
  },

  markReviewed(reviewable) {
    // The type makes an unacknowledged critical review unrepresentable; this refuses a cast.
    assertReviewable(reviewable);
    const { acknowledgedCriticalIds, note } = reviewable.acknowledgment;
    return readOrder(
      apiClient.post(`${orderPath(reviewable.labId)}/review`, {
        acknowledgedResultIds: acknowledgedCriticalIds,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }),
    );
  },

  async markManyReviewed(reviewables) {
    for (const reviewable of reviewables) assertReviewable(reviewable);
    const data = asRecord(
      readData(
        await apiClient.post('/lab-orders/review', {
          ids: reviewables.map((reviewable) => reviewable.labId),
          bulk: true,
        }),
        'bulk review',
      ),
      'bulk review',
    );
    // The answer is summaries; the screens hold full orders, so re-read them.
    const reviewed = readArray(data, 'reviewed', 'bulk review').map(idOf);
    return mapLimited(reviewed, DETAIL_CONCURRENCY, (id) =>
      readOrder(apiClient.get(orderPath(id))),
    );
  },

  annotate(note) {
    assertAnnotatable(note);
    return Promise.reject(notConnected('Lab result annotations'));
  },

  async orderLabs(request) {
    assertOrderable(request);
    const created: LabTest[] = [];
    for (const spec of request.specs) {
      try {
        created.push(
          await readOrder(
            apiClient.post('/lab-orders', {
              patientId: request.patient.id,
              testCode: spec.code,
              priority: request.priority,
              clinicalIndication: request.clinicalIndication,
              department: request.department,
            }),
          ),
        );
      } catch (error) {
        // One order per test: a failure part-way leaves the earlier ones
        // placed, and "nothing was ordered" would invite duplicates.
        if (created.length === 0) throw error;
        throw new Error(
          `${created.map((test) => test.id).join(', ')} placed; ${spec.name} and any later tests were not. Check the worklist before ordering again.`,
        );
      }
    }
    return created;
  },
};
