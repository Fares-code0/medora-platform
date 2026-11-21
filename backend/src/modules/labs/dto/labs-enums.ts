/**
 * Prisma enum member → API wire value (ADR-023 §2), for API §8.
 *
 * Each module maps at its own serialization boundary, and
 * `Record<Enum, …>` makes exhaustiveness the compiler's problem: a sixth
 * lab status stops the build here rather than shipping a value no client
 * understands.
 *
 * **Four of these vocabularies are not lower-case.** `LabTestCategory`,
 * `LabSpecimenType`, `LabSpecimenCondition` and `LAB_DEPARTMENTS` are
 * `@map`ped to capitalised words — `Blood Bank`, `Whole blood`,
 * `Insufficient volume` — because DB §E declares them that way and the
 * frontend renders the literal (`shared-domain/lab-studies/types.ts`
 * declares each union with exactly these spellings). A mechanical
 * `.toLowerCase()` would produce `blood bank`, which no client
 * vocabulary contains, so every value below is written out.
 *
 * The reverse maps exist because query strings and request bodies arrive
 * as wire values and the repository speaks Prisma members. They are
 * derived from the forward map rather than typed twice — two
 * hand-written tables are two chances to disagree about one spelling.
 */

import type {
  LabAttachmentKind,
  LabPriority,
  LabResultFlag,
  LabSpecimenCondition,
  LabSpecimenType,
  LabStatus,
  LabTestCategory,
  LabTimelineKind,
} from '../../../generated/prisma/enums';

/**
 * Inverts a wire map. One source of truth, both directions.
 *
 * The result is `Partial`, so a lookup is typed `T | undefined` rather
 * than `T`. That is the honest type: the key is a string off a query
 * string, and `FROM_WIRE['nonsense']` really is `undefined` at runtime.
 */
function reverse<T extends string>(
  forward: Record<T, string>,
): Readonly<Partial<Record<string, T>>> {
  return Object.fromEntries(
    Object.entries(forward).map(([member, wire]) => [wire, member]),
  ) as Partial<Record<string, T>>;
}

/** API §8 header — `ordered→collected→processing→completed` (+`cancelled`). */
const LAB_STATUS_WIRE: Record<LabStatus, string> = {
  ORDERED: 'ordered',
  COLLECTED: 'collected',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

/** API §8 header — `routine|urgent|stat`. */
const LAB_PRIORITY_WIRE: Record<LabPriority, string> = {
  ROUTINE: 'routine',
  URGENT: 'urgent',
  STAT: 'stat',
};

/**
 * API §8 header — `normal|low|high|critical-low|critical-high|abnormal`,
 * and `LabResultFlag` in the frontend's shared model, verbatim.
 */
const LAB_RESULT_FLAG_WIRE: Record<LabResultFlag, string> = {
  NORMAL: 'normal',
  LOW: 'low',
  HIGH: 'high',
  CRITICAL_LOW: 'critical-low',
  CRITICAL_HIGH: 'critical-high',
  ABNORMAL: 'abnormal',
};

/** Capitalised in the database (DB §E1). Written out, never derived. */
const LAB_CATEGORY_WIRE: Record<LabTestCategory, string> = {
  HEMATOLOGY: 'Hematology',
  CHEMISTRY: 'Chemistry',
  MICROBIOLOGY: 'Microbiology',
  IMMUNOLOGY: 'Immunology',
  PATHOLOGY: 'Pathology',
  URINALYSIS: 'Urinalysis',
  HORMONES: 'Hormones',
  BLOOD_BANK: 'Blood Bank',
};

const LAB_SPECIMEN_TYPE_WIRE: Record<LabSpecimenType, string> = {
  SERUM: 'Serum',
  PLASMA: 'Plasma',
  WHOLE_BLOOD: 'Whole blood',
  URINE: 'Urine',
  SWAB: 'Swab',
  TISSUE_BIOPSY: 'Tissue biopsy',
  STOOL: 'Stool',
  SPUTUM: 'Sputum',
  CSF: 'CSF',
};

/**
 * DB §E4. The three non-`Acceptable` members are exactly the set RM
 * M14.3 blocks `processing` on, which is why `BLOCKING_CONDITIONS` in
 * `specimen-condition.ts` is derived from this map rather than retyped.
 */
const LAB_SPECIMEN_CONDITION_WIRE: Record<LabSpecimenCondition, string> = {
  ACCEPTABLE: 'Acceptable',
  HEMOLYZED: 'Hemolyzed',
  CLOTTED: 'Clotted',
  INSUFFICIENT_VOLUME: 'Insufficient volume',
};

/** DB §E6 — `report|addendum|external|raw-data`. */
const LAB_ATTACHMENT_KIND_WIRE: Record<LabAttachmentKind, string> = {
  REPORT: 'report',
  ADDENDUM: 'addendum',
  EXTERNAL: 'external',
  RAW_DATA: 'raw-data',
};

/** DB §E7 — the seven kinds API §8.3 names and `LAB_TIMELINE_META` draws. */
const LAB_TIMELINE_KIND_WIRE: Record<LabTimelineKind, string> = {
  ORDERED: 'ordered',
  COLLECTED: 'collected',
  RECEIVED: 'received',
  PROCESSING: 'processing',
  RESULTED: 'resulted',
  VERIFIED: 'verified',
  CANCELLED: 'cancelled',
};

export const labStatusToWire = (value: LabStatus): string => LAB_STATUS_WIRE[value];
export const labPriorityToWire = (value: LabPriority): string => LAB_PRIORITY_WIRE[value];
export const labResultFlagToWire = (value: LabResultFlag): string =>
  LAB_RESULT_FLAG_WIRE[value];
export const labCategoryToWire = (value: LabTestCategory): string => LAB_CATEGORY_WIRE[value];
export const labSpecimenTypeToWire = (value: LabSpecimenType): string =>
  LAB_SPECIMEN_TYPE_WIRE[value];
export const labSpecimenConditionToWire = (value: LabSpecimenCondition): string =>
  LAB_SPECIMEN_CONDITION_WIRE[value];
export const labAttachmentKindToWire = (value: LabAttachmentKind): string =>
  LAB_ATTACHMENT_KIND_WIRE[value];
export const labTimelineKindToWire = (value: LabTimelineKind): string =>
  LAB_TIMELINE_KIND_WIRE[value];

export const LAB_STATUS_FROM_WIRE = reverse(LAB_STATUS_WIRE);
export const LAB_PRIORITY_FROM_WIRE = reverse(LAB_PRIORITY_WIRE);
export const LAB_RESULT_FLAG_FROM_WIRE = reverse(LAB_RESULT_FLAG_WIRE);
export const LAB_CATEGORY_FROM_WIRE = reverse(LAB_CATEGORY_WIRE);

export const LAB_SPECIMEN_TYPE_FROM_WIRE = reverse(LAB_SPECIMEN_TYPE_WIRE);
export const LAB_SPECIMEN_CONDITION_FROM_WIRE = reverse(LAB_SPECIMEN_CONDITION_WIRE);
export const LAB_ATTACHMENT_KIND_FROM_WIRE = reverse(LAB_ATTACHMENT_KIND_WIRE);

/**
 * The wire vocabularies, for the Zod enums that validate query strings.
 *
 * Cast to a non-empty tuple because `z.enum` requires one and
 * `Object.values` cannot prove it — the same narrowing `record-enums.ts`
 * and `pharmacy-enums.ts` apply. Every map above is a `Record` over a
 * Prisma enum, so none of them can actually be empty.
 */
export const LAB_STATUS_VALUES = Object.values(LAB_STATUS_WIRE) as [string, ...string[]];
export const LAB_PRIORITY_VALUES = Object.values(LAB_PRIORITY_WIRE) as [string, ...string[]];
export const LAB_RESULT_FLAG_VALUES = Object.values(LAB_RESULT_FLAG_WIRE) as [
  string,
  ...string[],
];
export const LAB_CATEGORY_VALUES = Object.values(LAB_CATEGORY_WIRE) as [string, ...string[]];
export const LAB_SPECIMEN_TYPE_VALUES = Object.values(LAB_SPECIMEN_TYPE_WIRE) as [
  string,
  ...string[],
];
export const LAB_SPECIMEN_CONDITION_VALUES = Object.values(LAB_SPECIMEN_CONDITION_WIRE) as [
  string,
  ...string[],
];
export const LAB_ATTACHMENT_KIND_VALUES = Object.values(LAB_ATTACHMENT_KIND_WIRE) as [
  string,
  ...string[],
];
