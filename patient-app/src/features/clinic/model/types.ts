import type { AnnouncementPriority } from '@/types/vocabularies';

/**
 * "Our Clinic".
 *
 * ── Why this is one clinic and not a directory ───────────────────────
 * ADR-018 §1 fixes v1 at a single clinic ("no `clinic_id` on any table"),
 * ADR-010 scopes `clinics` and `facilities` out of the schema entirely,
 * and `schema-adr010.e2e-spec.ts:117` is an enforced test that there is no
 * `clinic_id` anywhere. There are also **no geo columns** in any of the 13
 * schema files and no PostGIS.
 *
 * So "search hospitals", "nearby facilities" and distance ranking are not
 * unbuilt features — they are **out of scope for v1** (audit AD-3), and
 * building a facilities directory to make one screen look like a booking
 * marketplace is the speculative generality ADR-018 exists to prevent.
 * What ships is one honest screen about the one clinic, sourced from the
 * `organization` slice of `platform_settings` through a PUBLIC projection
 * (BE-11) — never the admin endpoint, which sits behind
 * `can:settings.manageSystem`.
 */

export interface ClinicProfile {
  readonly name: string;
  readonly addressLine: string;
  readonly city: string | null;
  readonly country: string | null;
  readonly phone: string | null;
  readonly website: string | null;
}

export interface OpeningDay {
  /** `Weekday` enum, lowercase — the backend's literal. */
  readonly weekday: string;
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  readonly closed: boolean;
}

export interface Holiday {
  readonly id: string;
  readonly name: string;
  /** ISO-8601 date. The client formats; it never computes (audit R-12). */
  readonly date: string;
}

/**
 * A clinic announcement, as a patient may see it — checklist F-08.
 *
 * ── A projection of `announcements`, not the row ─────────────────────
 *
 * The table (`10-communication.prisma`, DB §K10) carries `authorId`,
 * `archived` and `deletedAt` besides the fields below. None of them is
 * here, for A-05's reason: a patient projection never carries a staff
 * identifier, and the two flags are the server's filter rather than
 * something to hand a client and hope it applies.
 *
 * `expiresAt` is absent for a different reason and it is worth stating:
 * deciding whether an announcement has expired is arithmetic against a
 * clock, and R-12 says this client formats and never computes. An
 * expired announcement is one the server does not send.
 *
 * Unlike `ActivityEvent`, the words here **do** come from the server,
 * and that is safe for a reason specific to this type: an announcement
 * is addressed to everyone who uses the clinic, so it cannot contain one
 * patient's information. `home/model/types.ts` explains why the activity
 * feed takes the opposite decision.
 */
export interface ClinicAnnouncement {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly priority: AnnouncementPriority;
  /** Pinned announcements sort first. The clinic decides, not the client. */
  readonly pinned: boolean;
  /** `created_at`. ISO-8601; the client formats and never computes. */
  readonly publishedAt: string;
}

export interface ClinicService {
  getProfile(): Promise<ClinicProfile>;
  getOpeningHours(): Promise<readonly OpeningDay[]>;
  getHolidays(): Promise<readonly Holiday[]>;
  /**
   * What the clinic has told everyone — checklist F-08.
   *
   * Newest first with pinned rows ahead of them, **as the server orders
   * it**: which announcement matters most is the clinic's editorial
   * decision, and a client that re-sorted would be overruling it.
   */
  listAnnouncements(): Promise<readonly ClinicAnnouncement[]>;
}
