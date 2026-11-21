import { SEED_REPORTS_DOCUMENT } from './mock-data';
import type { ReportsDocument } from './types';

/**
 * Local persistence for the reports document (saved + scheduled reports).
 * Seeded on first run, then mutated by the mock service. Namespaced per
 * user under `medora.<userId>.` so the auth provider's
 * `clearUserPreferences` wipes it on logout (§6.4). Reads are defensive.
 * This module is the feature's single `window.localStorage` boundary.
 */

const VERSION = 'v1';

let idCounter = 0;

export function localId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${String(idCounter)}`;
}

function storageKey(userId: string): string {
  return `medora.${userId}.reports.${VERSION}`;
}

function isDocument(value: unknown): value is ReportsDocument {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate['saved']) && Array.isArray(candidate['scheduled']);
}

export function readReports(userId: string): ReportsDocument {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === null) {
      writeReports(userId, SEED_REPORTS_DOCUMENT);
      return SEED_REPORTS_DOCUMENT;
    }
    const parsed: unknown = JSON.parse(raw);
    return isDocument(parsed) ? parsed : SEED_REPORTS_DOCUMENT;
  } catch {
    return SEED_REPORTS_DOCUMENT;
  }
}

export function writeReports(userId: string, document: ReportsDocument): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(document));
  } catch {
    // Storage unavailable/full — the session keeps working in memory.
  }
}
