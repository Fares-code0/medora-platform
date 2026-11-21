import type { PatientSafeDoctor } from './model/types';

/**
 * Recently viewed doctors — checklist G-10.
 *
 * ── Why this is memory, and not the durable store the row asks for ───
 * The row calls this a "non-PHI cache", and each doctor in it is indeed
 * public: the patient-safe projection is what a clinic prints on its own
 * website (`docs/PUBLIC_PROJECTIONS.md`). But the LIST is not the
 * doctors — it is *which specialists this patient looked at*, and that
 * is an inference about their health. A phone recovered from a taxi with
 * "recently viewed: oncology, oncology, haematology" on the Discover
 * screen has disclosed something, whatever the individual rows contain.
 *
 * Audit R-8 already draws that line for cached records; the same
 * reasoning reaches this list, so it lives where PHI lives — in memory,
 * for the length of a session — and is cleared with it. That is a
 * deliberate deviation from the row's suggested storage, not an
 * oversight, and it costs the patient nothing they would notice: the
 * value of a recency list is inside the browsing session that built it.
 *
 * The store is durable now (E-02), which removes the excuse rather than
 * the reason: this list still must not use it. "There was nowhere to put
 * it" was never the argument — R-8 was.
 *
 * ── Capped, and why at five ──────────────────────────────────────────
 * Five is what fits on the Discover screen above the fold without
 * pushing search down, and a recency list longer than the screen is a
 * second search results list nobody asked for.
 */

/** What is kept per doctor: enough to render a card, and nothing more. */
export interface RecentDoctor {
  readonly id: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly specialty: string;
  readonly photoUrl: string | null;
}

export const RECENT_DOCTORS_LIMIT = 5;

let recent: RecentDoctor[] = [];

/**
 * Records a view, most recent first.
 *
 * Re-viewing a doctor moves them to the front rather than adding a
 * duplicate: a patient who opens the same profile twice has one recent
 * doctor, not two.
 */
export function recordDoctorView(doctor: PatientSafeDoctor): void {
  const entry: RecentDoctor = {
    id: doctor.id,
    fullName: doctor.fullName,
    title: doctor.title,
    specialty: doctor.specialty,
    photoUrl: doctor.photoUrl,
  };
  recent = [entry, ...recent.filter((seen) => seen.id !== doctor.id)].slice(
    0,
    RECENT_DOCTORS_LIMIT,
  );
}

/** Most recent first. A copy, so a caller cannot edit the store by accident. */
export function listRecentDoctors(): readonly RecentDoctor[] {
  return [...recent];
}

/**
 * Cleared on logout and on session loss, from `SessionProvider.endSession`
 * — the same place and the same moment the PHI cache goes (T-08).
 */
export function clearRecentDoctors(): void {
  recent = [];
}
