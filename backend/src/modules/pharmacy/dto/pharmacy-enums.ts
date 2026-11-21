/**
 * Prisma enum member → API wire value (ADR-023 §2), for API §7.
 *
 * Each module maps at its own serialization boundary, and
 * `Record<Enum, …>` makes exhaustiveness the compiler's problem: an
 * eighth prescription status stops the build here rather than shipping a
 * value no client understands.
 *
 * **Three of these vocabularies are not lower-case.** `MedicationCategory`,
 * `MedicationForm` and `MedicationRoute` are `@map`ped to capitalised
 * words — `Lipid-lowering`, `Tablet`, `Oral` — because DB §F1 declares
 * them that way and the frontend's filter chips render the literal. A
 * mechanical `.toLowerCase()` would produce `lipid-lowering`, which no
 * client vocabulary contains, so every value below is written out.
 *
 * The reverse maps exist because query strings and request bodies arrive
 * as wire values and the repository speaks Prisma members. They are
 * derived from the forward map rather than typed twice — two hand-written
 * tables are two chances to disagree about one spelling.
 */

import type {
  MedicationCategory,
  MedicationForm,
  MedicationRoute,
  MedicationStatus,
  PrescriptionStatus,
  PrescriptionTimelineKind,
  RefillStatus,
  SafetyWarningKind,
  SafetyWarningSeverity,
} from '../../../generated/prisma/enums';

/**
 * Inverts a wire map. One source of truth, both directions.
 *
 * The result is `Partial`, so a lookup is typed `T | undefined` rather
 * than `T`. That is the honest type: the key is a string off a query
 * string, and `FROM_WIRE['nonsense']` really is `undefined` at runtime.
 * Typing it as total would let a caller hand an unvalidated string to
 * Prisma and get a database error instead of the 422 the Zod enum on the
 * same value already produces.
 */
function reverse<T extends string>(
  forward: Record<T, string>,
): Readonly<Partial<Record<string, T>>> {
  return Object.fromEntries(
    Object.entries(forward).map(([member, wire]) => [wire, member]),
  ) as Partial<Record<string, T>>;
}

/** ADR-002 §"Decision" — the seven values, kebab-case as declared. */
const PRESCRIPTION_STATUS_WIRE: Record<PrescriptionStatus, string> = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending-approval',
  ACTIVE: 'active',
  DISPENSED: 'dispensed',
  COMPLETED: 'completed',
  DISCONTINUED: 'discontinued',
  EXPIRED: 'expired',
};

const REFILL_STATUS_WIRE: Record<RefillStatus, string> = {
  NONE: 'none',
  AVAILABLE: 'available',
  DUE: 'due',
  PENDING: 'pending',
};

const WARNING_KIND_WIRE: Record<SafetyWarningKind, string> = {
  INTERACTION: 'interaction',
  ALLERGY: 'allergy',
  DUPLICATE: 'duplicate',
  DOSAGE: 'dosage',
};

const WARNING_SEVERITY_WIRE: Record<SafetyWarningSeverity, string> = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
};

/** DB §F7 — the eight kinds the frontend's `PrescriptionTimelineKind` lists. */
const TIMELINE_KIND_WIRE: Record<PrescriptionTimelineKind, string> = {
  PRESCRIBED: 'prescribed',
  DISPENSED: 'dispensed',
  REFILL_REQUESTED: 'refill-requested',
  REFILL_APPROVED: 'refill-approved',
  RENEWED: 'renewed',
  NOTE_ADDED: 'note-added',
  DISCONTINUED: 'discontinued',
  EXPIRED: 'expired',
};

/** Capitalised in the database (DB §F1). Written out, never derived. */
const CATEGORY_WIRE: Record<MedicationCategory, string> = {
  ANTIBIOTICS: 'Antibiotics',
  ANALGESICS: 'Analgesics',
  ANTIHYPERTENSIVES: 'Antihypertensives',
  ANTIDIABETICS: 'Antidiabetics',
  LIPID_LOWERING: 'Lipid-lowering',
  ANTICOAGULANTS: 'Anticoagulants',
  CORTICOSTEROIDS: 'Corticosteroids',
  BRONCHODILATORS: 'Bronchodilators',
  PSYCHIATRIC: 'Psychiatric',
  GASTROINTESTINAL: 'Gastrointestinal',
  OPIOIDS: 'Opioids',
  THYROID: 'Thyroid',
};

const FORM_WIRE: Record<MedicationForm, string> = {
  TABLET: 'Tablet',
  CAPSULE: 'Capsule',
  SYRUP: 'Syrup',
  INJECTION: 'Injection',
  INHALER: 'Inhaler',
  CREAM: 'Cream',
  DROPS: 'Drops',
  PATCH: 'Patch',
};

const ROUTE_WIRE: Record<MedicationRoute, string> = {
  ORAL: 'Oral',
  INTRAVENOUS: 'Intravenous',
  INTRAMUSCULAR: 'Intramuscular',
  SUBCUTANEOUS: 'Subcutaneous',
  TOPICAL: 'Topical',
  INHALATION: 'Inhalation',
  OPHTHALMIC: 'Ophthalmic',
  TRANSDERMAL: 'Transdermal',
};

/** The patient's medication-list status (DB §B8), not the Rx status. */
const MEDICATION_STATUS_WIRE: Record<MedicationStatus, string> = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  DISCONTINUED: 'discontinued',
};

export const prescriptionStatusToWire = (value: PrescriptionStatus): string =>
  PRESCRIPTION_STATUS_WIRE[value];
export const refillStatusToWire = (value: RefillStatus): string => REFILL_STATUS_WIRE[value];
export const warningKindToWire = (value: SafetyWarningKind): string => WARNING_KIND_WIRE[value];
export const warningSeverityToWire = (value: SafetyWarningSeverity): string =>
  WARNING_SEVERITY_WIRE[value];
export const timelineKindToWire = (value: PrescriptionTimelineKind): string =>
  TIMELINE_KIND_WIRE[value];
export const medicationCategoryToWire = (value: MedicationCategory): string =>
  CATEGORY_WIRE[value];
export const medicationFormToWire = (value: MedicationForm): string => FORM_WIRE[value];
export const medicationRouteToWire = (value: MedicationRoute): string => ROUTE_WIRE[value];
export const medicationStatusToWire = (value: MedicationStatus): string =>
  MEDICATION_STATUS_WIRE[value];

export const PRESCRIPTION_STATUS_FROM_WIRE = reverse(PRESCRIPTION_STATUS_WIRE);
export const REFILL_STATUS_FROM_WIRE = reverse(REFILL_STATUS_WIRE);
export const WARNING_SEVERITY_FROM_WIRE = reverse(WARNING_SEVERITY_WIRE);
export const MEDICATION_CATEGORY_FROM_WIRE = reverse(CATEGORY_WIRE);
export const MEDICATION_FORM_FROM_WIRE = reverse(FORM_WIRE);
export const MEDICATION_ROUTE_FROM_WIRE = reverse(ROUTE_WIRE);

/**
 * The wire vocabularies, for the Zod enums that validate query strings.
 *
 * Cast to a non-empty tuple because `z.enum` requires one and
 * `Object.values` cannot prove it — the same narrowing `record-enums.ts`
 * applies. Every map above is a `Record` over a Prisma enum, so none of
 * them can actually be empty.
 */
export const PRESCRIPTION_STATUS_VALUES = Object.values(PRESCRIPTION_STATUS_WIRE) as [
  string,
  ...string[],
];
export const REFILL_STATUS_VALUES = Object.values(REFILL_STATUS_WIRE) as [string, ...string[]];
export const WARNING_SEVERITY_VALUES = Object.values(WARNING_SEVERITY_WIRE) as [
  string,
  ...string[],
];
export const MEDICATION_CATEGORY_VALUES = Object.values(CATEGORY_WIRE) as [string, ...string[]];
export const MEDICATION_FORM_VALUES = Object.values(FORM_WIRE) as [string, ...string[]];
export const MEDICATION_ROUTE_VALUES = Object.values(ROUTE_WIRE) as [string, ...string[]];
