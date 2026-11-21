/**
 * Prisma enum member → API wire value (ADR-023 §2), for API §6.
 *
 * Each module maps at its own serialization boundary; `Record<Enum, …>`
 * makes exhaustiveness the compiler's problem, so a fifth record status
 * stops the build here rather than shipping a value no client
 * understands. The kebab-case spellings are the frontend's
 * `RecordTimelineKind` and `RecordAttachmentKind` unions verbatim — the
 * contract's §11 header calls these literals law, and `.toLowerCase()`
 * would turn `LAB_RESULT` into `lab_result`, which no client vocabulary
 * contains.
 */

import type {
  AllergySeverity,
  BloodType,
  Gender,
  MedicationStatus,
  RecordAttachmentKind,
  RecordPriority,
  RecordStatus,
  RecordTimelineKind,
} from '../../../generated/prisma/enums';

const STATUS_WIRE: Record<RecordStatus, string> = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
};

const PRIORITY_WIRE: Record<RecordPriority, string> = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  CRITICAL: 'critical',
};

const TIMELINE_WIRE: Record<RecordTimelineKind, string> = {
  CREATED: 'created',
  VITALS_RECORDED: 'vitals-recorded',
  DIAGNOSIS_ADDED: 'diagnosis-added',
  MEDICATION_PRESCRIBED: 'medication-prescribed',
  NOTE_ADDED: 'note-added',
  ATTACHMENT_ADDED: 'attachment-added',
  STATUS_CHANGED: 'status-changed',
};

const ATTACHMENT_WIRE: Record<RecordAttachmentKind, string> = {
  LAB_RESULT: 'lab-result',
  IMAGING: 'imaging',
  REFERRAL: 'referral',
  CONSENT: 'consent',
  EXTERNAL_REPORT: 'external-report',
};

const MEDICATION_WIRE: Record<MedicationStatus, string> = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  DISCONTINUED: 'discontinued',
};

const ALLERGY_WIRE: Record<AllergySeverity, string> = {
  MILD: 'mild',
  MODERATE: 'moderate',
  SEVERE: 'severe',
};

/**
 * The patient snapshot API §6.1 carries needs gender and blood type.
 *
 * A third and fourth copy of tables `modules/patients` and
 * `modules/users` also hold — M2.2 zone 1 forbids importing a sibling's,
 * and a shared kernel invented to hold two constants is the worse trade.
 * The `Record<Enum, …>` type is what keeps the copies honest.
 */
const GENDER_WIRE: Record<Gender, string> = {
  FEMALE: 'female',
  MALE: 'male',
};

const BLOOD_TYPE_WIRE: Record<BloodType, string> = {
  A_POSITIVE: 'A+',
  A_NEGATIVE: 'A-',
  B_POSITIVE: 'B+',
  B_NEGATIVE: 'B-',
  AB_POSITIVE: 'AB+',
  AB_NEGATIVE: 'AB-',
  O_POSITIVE: 'O+',
  O_NEGATIVE: 'O-',
};

export const recordStatusToWire = (value: RecordStatus): string => STATUS_WIRE[value];
export const recordPriorityToWire = (value: RecordPriority): string => PRIORITY_WIRE[value];
export const timelineKindToWire = (value: RecordTimelineKind): string => TIMELINE_WIRE[value];
export const attachmentKindToWire = (value: RecordAttachmentKind): string =>
  ATTACHMENT_WIRE[value];
export const medicationStatusToWire = (value: MedicationStatus): string => MEDICATION_WIRE[value];
export const allergySeverityToWire = (value: AllergySeverity): string => ALLERGY_WIRE[value];
export const genderToWire = (value: Gender): string => GENDER_WIRE[value];
export const bloodTypeToWire = (value: BloodType): string => BLOOD_TYPE_WIRE[value];

/** Wire → Prisma member, for turning a filter or a body into a query. */
function invert<T extends string>(table: Record<T, string>): Readonly<Record<string, T>> {
  return Object.fromEntries(
    (Object.entries(table) as [T, string][]).map(([member, wire]) => [wire, member]),
  );
}

export const RECORD_STATUS_FROM_WIRE = invert(STATUS_WIRE);
export const RECORD_PRIORITY_FROM_WIRE = invert(PRIORITY_WIRE);
export const ATTACHMENT_KIND_FROM_WIRE = invert(ATTACHMENT_WIRE);
export const MEDICATION_STATUS_FROM_WIRE = invert(MEDICATION_WIRE);
export const ALLERGY_SEVERITY_FROM_WIRE = invert(ALLERGY_WIRE);

export const RECORD_STATUS_VALUES = Object.values(STATUS_WIRE) as [string, ...string[]];
export const RECORD_PRIORITY_VALUES = Object.values(PRIORITY_WIRE) as [string, ...string[]];
export const ATTACHMENT_KIND_VALUES = Object.values(ATTACHMENT_WIRE) as [string, ...string[]];
export const MEDICATION_STATUS_VALUES = Object.values(MEDICATION_WIRE) as [string, ...string[]];
export const ALLERGY_SEVERITY_VALUES = Object.values(ALLERGY_WIRE) as [string, ...string[]];
