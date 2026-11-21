/**
 * PHI elevation — the policy half of ADM-10 (UX §1.5.1, §1.5.6).
 *
 * Pure and storage-free on purpose. An elevation grant is deliberately
 * NOT persisted: it must not survive a reload, a new tab, or a re-login,
 * because "I justified this an hour ago" is not a justification for now.
 * The provider keeps grants in memory; the *log* of what was revealed is
 * what persists, through `administrationApi.phiAccess`.
 */

import {
  formatExpiry,
  grantFor as grantForAccess,
  isLive,
  pruneGrants,
  validateReason as validateAccessReason,
  type AccessGrant,
  type ReasonValidation,
} from '@/features/shared-domain/audited-access';

import type { PhiJustificationCategory } from '../administration.types';

/** How long one justified reveal stays open before it re-masks itself. */
export const PHI_ELEVATION_MINUTES = 15;

/** Free-text reason floor — short enough not to obstruct, long enough to mean something. */
export const PHI_REASON_MIN_LENGTH = 12;

export interface PhiCategoryMeta {
  readonly id: PhiJustificationCategory;
  readonly label: string;
  readonly description: string;
}

export const PHI_JUSTIFICATION_CATEGORIES: readonly PhiCategoryMeta[] = [
  {
    id: 'clinical-review',
    label: 'Clinical review',
    description: 'Supporting a clinician handling this patient right now.',
  },
  {
    id: 'patient-request',
    label: 'Patient request',
    description: 'The patient asked for this record or correction themselves.',
  },
  {
    id: 'safety-investigation',
    label: 'Safety investigation',
    description: 'Investigating a flagged incident, complaint, or safety alert.',
  },
  {
    id: 'billing-dispute',
    label: 'Billing dispute',
    description: 'Resolving a disputed charge or insurance claim.',
  },
  {
    id: 'legal-request',
    label: 'Legal or regulatory request',
    description: 'Responding to a subpoena, regulator, or formal audit.',
  },
];

export function categoryLabel(id: PhiJustificationCategory): string {
  return PHI_JUSTIFICATION_CATEGORIES.find((entry) => entry.id === id)?.label ?? id;
}

/**
 * PHI's grant is the shared grant narrowed to PHI's own category union, so a
 * grant carrying a category PHI does not recognise stays a type error.
 */
export type PhiGrant = AccessGrant<PhiJustificationCategory>;

/**
 * PHI's policy, applied. The window and the minimum reason length are PHI's
 * choices and stay declared here; the shared module takes them as arguments
 * precisely so a second consumer can choose differently.
 */
export function grantFor(
  subjectId: string,
  subjectLabel: string,
  category: PhiJustificationCategory,
  reason: string,
  now: number,
  minutes: number = PHI_ELEVATION_MINUTES,
): PhiGrant {
  return grantForAccess(subjectId, subjectLabel, category, reason, now, minutes);
}

export function validateReason(reason: string): ReasonValidation {
  return validateAccessReason(reason, PHI_REASON_MIN_LENGTH);
}

export { formatExpiry, isLive, pruneGrants, type ReasonValidation };
