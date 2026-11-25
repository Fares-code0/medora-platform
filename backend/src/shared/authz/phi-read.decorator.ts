/**
 * Explicit PHI-read classification (multi-hospital §2.13; audit F-03).
 *
 * Every read route under a clinical path carries exactly one of:
 *
 * - `@PhiRead('<resource>')` — the route discloses patient identity or
 *   clinical data. `PhiReadAuditInterceptor` writes one mandatory `phi.read`
 *   event before the response is released, and refuses the response if it
 *   cannot.
 * - `@PhiRead('<resource>', { auditedByHandler: true })` — the handler itself
 *   writes the mandatory disclosure event (`patient.view`,
 *   `medical_record.view`, `file.download`, the exports, grant reads…)
 *   through `MandatoryAuditWriter`, so the interceptor adds no duplicate.
 * - `@NotPhi('<reason>')` — the route discloses no patient data (reference
 *   catalogues, aggregate counts, the caller's own account).
 *
 * `phi-read-inventory.e2e-spec.ts` fails when a read route under a clinical
 * path carries neither, so a new clinical endpoint cannot ship unaudited by
 * omission. Classification is explicit rather than inferred from a
 * capability: a capability says who may call a route, not what it returns.
 */

import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const PHI_READ_METADATA = 'medora:phi:read';
export const NOT_PHI_METADATA = 'medora:phi:not';

export interface PhiReadSpec {
  readonly resource: string;
  readonly auditedByHandler: boolean;
}

export function PhiRead(
  resource: string,
  options: { readonly auditedByHandler?: boolean } = {},
): CustomDecorator<string> {
  const spec: PhiReadSpec = { resource, auditedByHandler: options.auditedByHandler ?? false };
  return SetMetadata(PHI_READ_METADATA, spec);
}

export function NotPhi(reason: string): CustomDecorator<string> {
  return SetMetadata(NOT_PHI_METADATA, reason);
}
