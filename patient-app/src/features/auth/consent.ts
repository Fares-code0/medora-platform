import { Linking } from 'react-native';

import { env } from '@/configs/env';
import { isHttpsUrl } from '@/features/emergency/dial';
import { logger } from '@/utils/logger';

/**
 * What a patient agrees to, and what this client can honestly say about
 * it — checklist E-05.
 *
 * ── The version is displayed and deliberately NOT sent ───────────────
 *
 * The row asks for "the accepted version recorded", and half of that is
 * the server's: `users.terms_accepted_at` and `privacy_accepted_at` are
 * NOT NULL by design, so an account cannot exist without an acceptance
 * timestamp — that half works today, because `POST /auth/register`
 * carries `acceptTerms` and `acceptPrivacy` and is live.
 *
 * The other half is a *version*, and the register payload has no field
 * for one (BE-01). This client therefore **shows** the version it is
 * asking about and sends nothing extra: an invented `termsVersion` on a
 * validated request is a 422 at best and an invented contract at worst,
 * which §11 of the brief forbids. When the field exists, `CONSENT_VERSION`
 * is the one place to read it from.
 *
 * ── The documents are configuration, not content ─────────────────────
 *
 * Terms and a privacy policy are legal documents that a clinic's counsel
 * writes and publishes; a developer writing them into this bundle would
 * be authoring legal text and pinning it to a store release. So they are
 * URLs the operator supplies, and unset is an honest state the screen
 * renders in words — the same rule W-11 applies to the support address.
 */

/**
 * The version of the documents this build asks about.
 *
 * A date rather than a number, because that is what a legal document is
 * versioned by in practice and what a patient can match against the
 * heading of the page they are reading.
 */
export const CONSENT_VERSION = '2026-09-01';

export type ConsentDocumentId = 'terms' | 'privacy';

export interface ConsentDocument {
  readonly id: ConsentDocumentId;
  /** `null` when the operator has published no URL for it. */
  readonly url: string | null;
}

export function consentDocuments(): readonly ConsentDocument[] {
  return [
    { id: 'terms', url: env.termsUrl },
    { id: 'privacy', url: env.privacyUrl },
  ];
}

/** True when at least one document can actually be opened. */
export function hasPublishedDocuments(): boolean {
  return consentDocuments().some((document) => document.url !== null);
}

/**
 * Opens a published document in the patient's browser.
 *
 * The scheme is checked **again** here rather than trusted from `env`.
 * Boot validation is a deployment guard; this is the call site that
 * hands a string to `Linking.openURL`, and `dial.ts` makes the same
 * argument about a phone number: the check belongs where the harm is.
 * The check itself now lives beside that one as `isHttpsUrl`, because
 * two copies of a scheme allow-list is one copy too many — but the
 * message stays here: "a consent document" is what the patient was
 * trying to read.
 *
 * Returns false rather than throwing — the caller renders a fallback,
 * and a consent screen that crashes is worse than one that cannot open
 * a page.
 */
export async function openConsentDocument(url: string): Promise<boolean> {
  if (!isHttpsUrl(url)) {
    // The URL is operator configuration, so it is never logged: a
    // misconfigured value can carry anything.
    logger.warn('Refused to open a consent document that is not an https URL');
    return false;
  }

  try {
    await Linking.openURL(url);
    return true;
  } catch {
    logger.warn('No browser available for the consent document');
    return false;
  }
}
