import { z } from 'zod';

import { strongPassword } from './password.schema';

/**
 * `POST /auth/register` (RM M6.1, API §1.1, ADR-035).
 *
 * ## One endpoint, two shapes, and one role that is absent
 *
 * A discriminated union on `role` rather than a flat object with
 * conditionally-meaningful fields. The two public registrations collect
 * genuinely different information — a patient has no professional
 * register to be listed on, and a doctor's is required rather than
 * optional — and a flat schema can only express that as a cross-field
 * refinement that both clients then have to reproduce.
 *
 * Before ADR-035 this was a flat object whose `role` enum read
 * `['doctor', 'admin', 'patient']` and whose `licenseNumber` was
 * `.optional()` for all three. Two things were wrong with it, and the
 * union fixes both:
 *
 * **`admin` is gone.** It is not a value this schema accepts, so
 * `POST /auth/register` with `role: 'admin'` is a 422 with a field error
 * on `role` — the same answer `role: 'superuser'` already got. Public
 * administrator self-registration was named as a risk in
 * `registration.service.ts` from the day it shipped and deferred as
 * RA-025.1; ADR-035 §5 closes it. An administrator holds `roles.manage`
 * and `settings.manageSystem`, and a role that can rewrite the permission
 * matrix must not be obtainable from a public form. Administrators are
 * provisioned by invitation (`admin-invitation.controller.ts`).
 *
 * **A doctor's professional information is required.** It was optional
 * and unvalidated, which meant a self-registered doctor could hold no
 * registration number at all, and — because no `doctors` row was created
 * — had no `verification_status` either. Professional verification was
 * therefore unreachable for exactly the accounts it exists to check.
 *
 * ## The registration number is not a credential
 *
 * `professionalRegistrationNumber` appears here, in registration, and
 * nowhere in `login.schema.ts`. That separation is the point of ADR-035
 * §3: it is a professional identifier used for verification, not an
 * authenticator. Nothing in this module resolves an account by it.
 *
 * ## `confirmPassword`
 *
 * The frontend cross-field refinement stays on the frontend. API §1.1
 * says the server "ignores" it, and it is right to: the server has one
 * password and no second copy to compare it against. `.passthrough()` is
 * deliberately not used, so an unknown field is stripped rather than
 * rejected and a client that sends `confirmPassword` is not an error.
 *
 * ## The consent booleans
 *
 * `.literal(true)`, not `.boolean()`. `users.terms_accepted_at` is NOT
 * NULL by design (see `03-identity.prisma`) — an account with no recorded
 * consent is a compliance gap, and accepting `false` here is the one way
 * one could be created.
 */

/** Loose international phone check — the frontend's `phoneRegex`, verbatim. */
const phoneRegex = /^\+?[0-9][0-9\s-]{6,18}$/;

/**
 * The registers a professional number can be listed on (ADR-035 §4).
 *
 * Deliberately jurisdiction-neutral. These five are the categories the
 * Saudi Commission for Health Specialties issues under, which is the
 * register Medora's first deployment uses — but nothing in the platform
 * is keyed on that. The vocabulary lives in this DTO rather than in a
 * Postgres enum precisely so a second regulator is a change to this array
 * instead of a migration, and so `doctors.professional_category` can hold
 * whatever the local register calls its classes.
 *
 * No jurisdiction field accompanies it yet. One register is configured,
 * and a column recording which of one is a column that is always the same
 * value — ADR-035 §4 records the shape a second one would take rather
 * than shipping an unused discriminator.
 */
export const PROFESSIONAL_CATEGORIES = [
  'physician',
  'dentist',
  'pharmacist',
  'nurse',
  'technician',
] as const;

export type ProfessionalCategory = (typeof PROFESSIONAL_CATEGORIES)[number];

/**
 * The account half — identical for every role, because authentication is
 * identical for every role. A patient, a doctor and an invited
 * administrator all sign in with an email and a password, and all three
 * go through the same Argon2id, the same lockout and the same session
 * machinery (ADR-030 §5). Only what a role must *additionally* declare
 * differs, which is what the union below expresses.
 */
const accountFields = {
  firstName: z.string().trim().min(1, 'Enter your first name').max(60),
  lastName: z.string().trim().min(1, 'Enter your last name').max(60),
  email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
  phone: z
    .string()
    .min(1, 'Enter your phone number')
    .regex(phoneRegex, 'Enter a valid phone number'),
  password: strongPassword,
  acceptTerms: z.literal(true, { message: 'You must accept the Terms & Conditions' }),
  acceptPrivacy: z.literal(true, { message: 'You must accept the Privacy Policy' }),
} as const;

/**
 * Patient registration (ADR-030 §4).
 *
 * Account fields only. There is no date of birth and no gender here, and
 * their absence is a decision rather than an omission: those are clinical
 * attributes of a `patients` row, not of a sign-in identity, and `users`
 * has no column for either. Collecting them at registration would either
 * duplicate `patients.date_of_birth` on a second table or silently create
 * a clinical record from self-asserted data — and ADR-030 §4 keeps
 * account creation and clinical-record claiming apart precisely because
 * asserting "I am the person in PT-1042" wrongly discloses one person's
 * medical history to another. The claim flow is RA-030.1 and still open.
 *
 * No `licenseNumber` field exists on this branch at all, so a patient
 * client cannot send one even by accident — the union strips it.
 */
export const patientRegisterSchema = z.object({
  ...accountFields,
  role: z.literal('patient'),
});

/**
 * Doctor registration (ADR-035 §4).
 *
 * The professional block is required, and that requirement is what makes
 * `doctors.verification_status` reachable: `registration.service.ts`
 * creates the professional profile in the same transaction, so a
 * self-registered doctor exists in the verification queue from the
 * moment they sign up rather than waiting for a milestone that would
 * back-fill one.
 *
 * `specialty` is `doctors.specialty`, which is NOT NULL — before ADR-035
 * no `doctors` row could be created at registration because the form did
 * not collect it, and inventing a value would have put unverified data on
 * the row the verification queue reads.
 *
 * `registrationExpiresOn` is optional because not every register issues a
 * dated certificate, and a required date would force a client to invent
 * one. Where it is supplied it must be a real calendar date and in the
 * future — an already-expired registration is not a credential to
 * register with, and accepting one would seed
 * `PROFESSIONAL_REGISTRATION_EXPIRED` at creation time.
 */
export const doctorRegisterSchema = z.object({
  ...accountFields,
  role: z.literal('doctor'),
  professionalRegistrationNumber: z
    .string()
    .trim()
    .min(3, 'Enter your professional registration number')
    .max(40),
  professionalCategory: z.enum(PROFESSIONAL_CATEGORIES, {
    message: 'Select your professional category',
  }),
  specialty: z.string().trim().min(2, 'Enter your specialty').max(60),
  registrationExpiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a real date')
    .refine(
      (value) => Date.parse(`${value}T23:59:59.999Z`) > Date.now(),
      'That registration has already expired',
    )
    .optional(),
});

export const registerSchema = z.discriminatedUnion('role', [
  patientRegisterSchema,
  doctorRegisterSchema,
]);

export type PatientRegisterInput = z.infer<typeof patientRegisterSchema>;
export type DoctorRegisterInput = z.infer<typeof doctorRegisterSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
