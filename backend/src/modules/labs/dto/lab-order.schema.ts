/**
 * Request validation for the lab order (API §8.2–§8.10).
 *
 * ## The bounds are the columns', and they are stated rather than guessed
 *
 * `clinical_indication` is `VarChar(300)`, `collection_site` is
 * `VarChar(80)`, `container` `VarChar(60)`, `volume` `VarChar(20)`,
 * `value_text` `VarChar(60)`, `analyte` `VarChar(80)` (DB §E). Each
 * maximum below is that column's, so an over-long field is a 422 naming
 * the field rather than a 500 from the driver. A schema looser than the
 * column turns every long paste into a server error.
 *
 * ## A clinical indication is required, and that is a rule about the order
 *
 * `assessOrder` in `features/doctor/labs/model/ordering.ts` refuses an
 * empty one with `'no-indication'` and says why in as many words: "the
 * laboratory reads it — it decides add-on testing and reflex protocols,
 * and an order that arrives without one is a phone call back to the
 * ward". Transcribed rather than softened to optional.
 */

import { z } from 'zod';

import {
  LAB_ATTACHMENT_KIND_VALUES,
  LAB_CATEGORY_VALUES,
  LAB_PRIORITY_VALUES,
  LAB_RESULT_FLAG_VALUES,
  LAB_SPECIMEN_CONDITION_VALUES,
  LAB_SPECIMEN_TYPE_VALUES,
  LAB_STATUS_VALUES,
} from './labs-enums';

/**
 * A repeatable query parameter.
 *
 * `?status=ordered&status=collected` arrives as an array and
 * `?status=ordered` as a string; both mean the same thing to the caller,
 * so both are normalised to an array before the enum check. Without this
 * a single-valued filter is a 422 the client cannot read.
 */
function multi(values: [string, ...string[]]) {
  return z
    .union([z.enum(values), z.array(z.enum(values))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional();
}

/** An ISO instant off a query string. Refused rather than coerced loosely. */
const instant = z.coerce.date().optional();

export const labOrderListSchema = z.object({
  /** §8.2 — patient, test or `LAB-…`. */
  q: z.string().trim().min(1).max(120).optional(),
  status: multi(LAB_STATUS_VALUES),
  category: multi(LAB_CATEGORY_VALUES),
  priority: multi(LAB_PRIORITY_VALUES),
  /** A single flag: "show me the criticals" is one question, not a set. */
  flag: z.enum(LAB_RESULT_FLAG_VALUES).optional(),
  reviewStatus: z.enum(['not-required', 'unreviewed', 'reviewed']).optional(),
  patientId: z.string().trim().min(1).max(20).optional(),
  from: instant,
  to: instant,
  /**
   * Whitelisted per endpoint (API §0.2). `priority:desc` exists because
   * a worklist is worked by urgency, and it is the only non-temporal
   * order the screen offers.
   */
  sort: z
    .enum(['requestedAt:asc', 'requestedAt:desc', 'priority:desc'])
    .default('requestedAt:desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type LabOrderListQuery = z.infer<typeof labOrderListSchema>;

/**
 * `GET /lab-orders/export` — API §8.11. The worklist's filters and sort
 * without paging, bounded by `EXPORT_ROW_LIMIT`.
 */
export const labOrderExportSchema = labOrderListSchema.omit({ page: true, pageSize: true });

export type LabOrderExportQuery = z.infer<typeof labOrderExportSchema>;

/**
 * §8.4 — `{ patientId, testCode, priority, clinicalIndication, department }`.
 *
 * `testCode` rather than a test id: the contract names the LOINC code,
 * it is UNIQUE, and it is the identifier a clinician and an external
 * system both already hold.
 */
export const createLabOrderSchema = z.object({
  patientId: z.string().trim().min(1).max(20),
  testCode: z.string().trim().min(1).max(20),
  priority: z.enum(LAB_PRIORITY_VALUES).default('routine'),
  clinicalIndication: z
    .string()
    .trim()
    .min(1, 'A clinical indication is required — the lab reads it.')
    .max(300),
  /**
   * Optional: absent means the ordering doctor's own department, which
   * is the common case and the one the stepper pre-fills. Naming one is
   * how a consult orders against the department that will act on it.
   */
  department: z.string().trim().min(1).max(120).optional(),
});

export type CreateLabOrderInput = z.infer<typeof createLabOrderSchema>;

/**
 * §8.5 — the specimen document, captured with the `collected` move.
 *
 * Required **on that move only**, and the service enforces that pairing
 * rather than the schema: a specimen block sent with a `cancelled`
 * transition is a client bug worth a clear message, not a silently
 * ignored field.
 */
export const specimenSchema = z.object({
  type: z.enum(LAB_SPECIMEN_TYPE_VALUES),
  container: z.string().trim().min(1).max(60),
  collectionSite: z.string().trim().min(1).max(80),
  /**
   * Who drew it. Optional because the signed-in collector is the default
   * and the common case; naming someone else is how a phlebotomist's
   * draw is recorded by whoever enters it.
   */
  collectedBy: z.string().trim().min(1).max(120).optional(),
  collectedAt: z.coerce.date().optional(),
  receivedAt: z.coerce.date().optional(),
  condition: z.enum(LAB_SPECIMEN_CONDITION_VALUES).default('Acceptable'),
  volume: z.string().trim().min(1).max(20),
});

export type SpecimenInputDto = z.infer<typeof specimenSchema>;

export const transitionLabOrderSchema = z.object({
  to: z.enum(['collected', 'processing', 'completed', 'cancelled']),
  detail: z.string().trim().min(1).max(300).optional(),
  specimen: specimenSchema.optional(),
  /**
   * The lab's reading, written with the `completed` move.
   *
   * It may only be written there:
   * `lab_orders_interpretation_requires_completion` (M5.8) refuses an
   * interpretation on any other status, because "an interpretation of
   * results that do not exist yet is a draft opinion in a clinical
   * record". The service refuses it before the database has to.
   */
  interpretation: z.string().trim().min(1).max(4000).optional(),
});

export type TransitionLabOrderInput = z.infer<typeof transitionLabOrderSchema>;

/**
 * §8.6 — one result per analyte, entered as a batch.
 *
 * `value` is the reported string for both numeric and qualitative
 * analytes; the server parses it against the analyte's spec rather than
 * trusting a client-supplied number. **No `flag` is accepted**, and that
 * is the point of the endpoint: the flag is the server's judgement
 * against the range it snapshots, not a field a client can assert.
 */
export const enterResultsSchema = z.object({
  results: z
    .array(
      z.object({
        analyte: z.string().trim().min(1).max(80),
        value: z.string().trim().min(1).max(60),
      }),
    )
    .min(1, 'Enter at least one result.')
    // A panel is at most a few dozen analytes; a thousand-item body is a
    // client fault, and a bound here is cheaper than the 60 seconds of
    // per-row lookups it would otherwise buy.
    .max(100),
});

export type EnterResultsInput = z.infer<typeof enterResultsSchema>;

/**
 * §8.7 — mark reviewed.
 *
 * `bulk` is in the body rather than implied by the shape of `ids`,
 * because the contract names it (`bulk:false`) and because a client that
 * means "review these three individually" and a client that means
 * "clear these three normals in one action" are making different claims
 * that deserve different answers.
 */
const reviewAcknowledgment = {
  /**
   * The critical result ids the reviewer positively ticked. Required
   * alongside a critical value; ignored on the bulk path, which cannot
   * reach one.
   */
  acknowledgedResultIds: z.array(z.string().trim().min(1)).max(100).optional(),
  /** Required with an acknowledgment — a tick with no reason is not one. */
  note: z.string().trim().max(1000).optional(),
};

/** `POST /lab-orders/{id}/review` — the reference is in the path. */
export const reviewLabOrderSchema = z.object(reviewAcknowledgment);

export type ReviewLabOrderInput = z.infer<typeof reviewLabOrderSchema>;

/**
 * `POST /lab-orders/review` — the bulk path.
 *
 * `bulk` is in the body rather than implied by the route, because the
 * contract names it (`bulk:false`) and because a client sending three
 * ids with `bulk: false` is asking for something this endpoint refuses:
 * three individual reviews, each of which may need its own
 * acknowledgment, cannot share one note.
 */
export const reviewLabOrdersSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(20)).min(1).max(100),
  bulk: z.boolean().default(false),
  ...reviewAcknowledgment,
});

export type ReviewLabOrdersInput = z.infer<typeof reviewLabOrdersSchema>;

/**
 * §8.9 — attach to a record, with the identity check.
 *
 * `confirmedPatient` carries **the identity the clinician confirmed**
 * rather than a boolean, which is the property the frontend's
 * `assessAttachability` is built on: a confirmation that names an
 * identity is void by construction the moment the target changes,
 * whereas a `confirmed: true` survives the user picking a different
 * record.
 */
export const attachToRecordSchema = z.object({
  recordId: z.string().trim().min(1).max(20),
  confirmedPatient: z.object({
    name: z.string().trim().min(1).max(200),
    mrn: z.string().trim().min(1).max(40),
  }),
});

export type AttachToRecordInput = z.infer<typeof attachToRecordSchema>;

/**
 * §8.11 — an attachment's metadata. The bytes arrive base64-encoded.
 *
 * A JSON body rather than multipart: every other write in this API is
 * JSON, the `zodBody` pipe validates JSON, and a lab report is a
 * document rather than a video. The size cap below is the *encoded*
 * length, so it bounds the request before anything is decoded — a limit
 * checked after decoding is a limit that already allocated the memory.
 */
export const uploadLabAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(LAB_ATTACHMENT_KIND_VALUES),
  mimeType: z.string().trim().min(1).max(120),
  /** Base64, capped at roughly 15 MB encoded (≈11 MB of bytes). */
  content: z.string().min(1).max(15_000_000),
});

export type UploadLabAttachmentInput = z.infer<typeof uploadLabAttachmentSchema>;

/**
 * §8.8 — the trend series.
 *
 * `analytes` is a comma-separated list because the contract writes it
 * that way (`?analytes=a,b,c`), and it is capped at three because the
 * contract caps it at three: `MAX_TREND_SERIES = 3` in the frontend's
 * `trends.ts`, for the reason that file gives — three analytes with
 * three units give three reference ranges and one y-axis.
 *
 * A fourth is a 422 rather than a silent truncation: a client asking for
 * four series and getting three back, with no indication which was
 * dropped, would chart a patient's potassium and believe it was their
 * sodium.
 */
export const labTrendSchema = z.object({
  analytes: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    )
    .refine((parts) => parts.length > 0, 'Name at least one analyte.')
    .refine((parts) => parts.length <= 3, 'At most three analytes can be overlaid.'),
  from: instant,
  to: instant,
});

export type LabTrendQuery = z.infer<typeof labTrendSchema>;
