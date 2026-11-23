/**
 * `PATCH /me/profile` — API §3.2, transcribed from the frontend's
 * `profileSchema` (`features/doctor/settings/schemas.ts`).
 *
 * The contract states the bounds verbatim: fullName 2–80, specialty
 * 2–60, licenseNumber 3–40, yearsOfExperience 0–70, biography ≤600,
 * languages ≤8, education ≤8, certifications ≤8, skills ≤12, URLs full
 * `.url()`, contactEmail an email, contactPhone 7–30. Every one of them
 * is a column width or a CHECK in `04-people.prisma`, so a body the
 * schema accepts is one the database accepts.
 *
 * ## What a practitioner may not set here
 *
 * `verificationStatus`, `verifiedAt`, `practiceStatus` and `ratingAvg`
 * are **read-only on this route** and are not fields of this schema — a
 * doctor who could set their own verification status would make API
 * §3.6 decorative. `photoUrl` is absent for a different reason: it is
 * set by `PUT /me/profile/photo`, which uploads bytes, and a route that
 * accepted a URL would let anyone point their avatar at any host.
 *
 * `professionalCategory` is absent too. It is the register a number is
 * listed on (ADR-035 §4) — regulatory data collected at registration and
 * checked at verification, not a profile preference.
 */

import { z } from 'zod';

/** The frontend's `phoneRegex`, verbatim — the same one registration uses. */
const phoneRegex = /^\+?[0-9][0-9\s-]{6,18}$/;

const optionalUrl = z
  .string()
  .trim()
  .url('Enter a full URL, including https://')
  .max(500)
  .nullable()
  .optional();

/**
 * A bounded list of short strings — languages, education, certifications,
 * skills.
 *
 * Each entry is trimmed and non-empty: a list carrying `""` renders as a
 * blank chip nobody can remove, and the column is `text[]` so the
 * database will store it happily.
 */
function boundedList(max: number, entryMax = 80): z.ZodArray<z.ZodString> {
  return z.array(z.string().trim().min(1).max(entryMax)).max(max);
}

export const updateDoctorProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  title: z.string().trim().max(60).nullable().optional(),
  specialty: z.string().trim().min(2).max(60).optional(),
  /**
   * The professional registration number (ADR-035 §3). Editing it is the
   * one field on this route with a consequence beyond itself: API §3.2
   * requires the edit to flip `verificationStatus` back to `pending`,
   * because the number the clinic verified is no longer the number on
   * the row.
   */
  licenseNumber: z.string().trim().min(3).max(40).optional(),
  /** `YYYY-MM-DD`. A `date` column — no time, no zone. */
  licenseExpiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .nullable()
    .optional(),
  yearsOfExperience: z.number().int().min(0).max(70).optional(),
  biography: z.string().trim().max(600).nullable().optional(),
  languages: boundedList(8, 40).optional(),
  education: boundedList(8, 160).optional(),
  certifications: boundedList(8, 160).optional(),
  skills: boundedList(12, 60).optional(),
  contactEmail: z.string().trim().email('Enter a valid email address').max(160).optional(),
  contactPhone: z
    .string()
    .trim()
    .regex(phoneRegex, 'Enter a valid phone number')
    .max(30)
    .optional(),
  officeLocation: z.string().trim().max(80).nullable().optional(),
  officeHours: z.string().trim().max(80).nullable().optional(),
  linkedinUrl: optionalUrl,
  websiteUrl: optionalUrl,
});

export type UpdateDoctorProfileInput = z.infer<typeof updateDoctorProfileSchema>;

/**
 * The fields whose edit re-opens verification (API §3.2 — "license-field
 * edits ⇒ `verificationStatus:'pending'` + admin notification").
 *
 * A named list rather than a check inside the update, so the rule is one
 * value a reader and a test can both point at. `licenseExpiresOn` is on
 * it because an expiry is part of what was verified: a practitioner
 * extending their own registration date without re-verification would be
 * self-certifying the very thing the workflow exists to check.
 *
 * `fullName` is **not** on it, deliberately. A name correction or a
 * change after marriage is an ordinary profile edit, and forcing
 * re-verification for one would make the correction cost a practitioner
 * their verified standing — which is how a clinic ends up with
 * deliberately wrong names on file.
 */
export const LICENSE_FIELDS: readonly (keyof UpdateDoctorProfileInput)[] = [
  'licenseNumber',
  'licenseExpiresOn',
];
