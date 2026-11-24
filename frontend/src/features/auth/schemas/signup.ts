import { z } from 'zod';

import type { MessageKey } from '@/i18n';

import { strongPassword } from './password';

/**
 * The signup form (ADR-035 §§4–5).
 *
 * Mirrors `backend/src/modules/auth/dto/register.schema.ts` — a
 * discriminated union on `role`, with the same fields, bounds and
 * messages, so a form the client accepts is a body the server accepts.
 *
 * ## Administrator is not an option here
 *
 * The form used to offer `doctor | admin` as a radio pair, and the
 * backend accepted both. It no longer does: an administrator holds
 * `roles.manage` and `settings.manageSystem`, and a role that can rewrite
 * the permission matrix is not something a public form should hand out.
 * Administrators are provisioned by invitation.
 *
 * Removing the radio is the *cosmetic* half of that change and is worth
 * being clear about — the backend DTO has no `'admin'` value, so the
 * refusal holds against a hand-rolled request too. This union is what
 * stops a user being shown a choice the server will reject, not what
 * enforces the rule.
 *
 * ## `confirmPassword`
 *
 * Refined here and never sent. The server holds one password and has
 * nothing to compare a second copy against — its own schema says so.
 */

/** Loose international phone check — 7–15 digits, optional +, spaces/dashes. */
const phoneRegex = /^\+?[0-9][0-9\s-]{6,18}$/;

/**
 * The registers a professional number can be listed on.
 *
 * Transcribed from the backend's `PROFESSIONAL_CATEGORIES`. Deliberately
 * jurisdiction-neutral: these are the classes the first deployment's
 * register issues under, and a second regulator is a change to this array
 * rather than to any schema.
 */
export const PROFESSIONAL_CATEGORIES = [
  'physician',
  'dentist',
  'pharmacist',
  'nurse',
  'technician',
] as const;

export type ProfessionalCategory = (typeof PROFESSIONAL_CATEGORIES)[number];

/** The catalogue key of the label shown against each value. */
export const PROFESSIONAL_CATEGORY_LABELS: Readonly<Record<ProfessionalCategory, MessageKey>> = {
  physician: 'signup.category.physician',
  dentist: 'signup.category.dentist',
  pharmacist: 'signup.category.pharmacist',
  nurse: 'signup.category.nurse',
  technician: 'signup.category.technician',
};

const accountFields = {
  firstName: z.string().trim().min(1, 'validation.firstName').max(60),
  lastName: z.string().trim().min(1, 'validation.lastName').max(60),
  email: z.string().min(1, 'validation.enterEmail').email('validation.email'),
  phone: z
    .string()
    .min(1, 'validation.phone')
    .regex(phoneRegex, 'validation.phoneInvalid'),
  password: strongPassword,
  confirmPassword: z.string().min(1, 'validation.confirmYourPassword'),
  acceptTerms: z.boolean().refine((v) => v, { message: 'validation.acceptTerms' }),
  acceptPrivacy: z.boolean().refine((v) => v, { message: 'validation.acceptPrivacy' }),
} as const;

/**
 * The cross-field rule both branches share.
 *
 * Written as a plain function pair rather than a helper that wraps
 * `.refine` because Zod's refinement signature is generic over the object
 * type — a wrapper would have to reproduce that generic to stay typed,
 * which is more machinery than two call sites are worth.
 */
const passwordsMatch = (data: { password: string; confirmPassword: string }): boolean =>
  data.password === data.confirmPassword;

const passwordsMatchError = { message: 'validation.passwordMismatch', path: ['confirmPassword'] };

/**
 * Doctor signup — the account fields plus the professional block.
 *
 * All three professional fields are required, which is the change ADR-035
 * §4 makes. `licenseNumber` used to be one optional free-text box, so a
 * doctor could register holding no registration number at all — and
 * because no `doctors` row was created, no verification status either.
 * The backend now creates the professional profile from these fields with
 * `verification_status = PENDING`, which is what puts the account in the
 * verification queue.
 *
 * Note what is *not* claimed by collecting them: nothing here or on the
 * server checks the number against a register. PENDING means "unchecked",
 * and it is the honest state until an administrator with `doctors.verify`
 * says otherwise.
 */
export const doctorSignupSchema = z
  .object({
    ...accountFields,
    role: z.literal('doctor'),
    professionalRegistrationNumber: z
      .string()
      .trim()
      .min(3, 'validation.professionalNumber')
      .max(40),
    professionalCategory: z.enum(PROFESSIONAL_CATEGORIES, {
      message: 'validation.professionalCategory',
    }),
    specialty: z.string().trim().min(2, 'validation.specialty').max(60),
    registrationExpiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.dateFormat')
      .refine((value) => !Number.isNaN(Date.parse(value)), 'validation.realDate')
      .refine(
        (value) => Date.parse(`${value}T23:59:59.999Z`) > Date.now(),
        'validation.registrationExpired',
      )
      .optional()
      .or(z.literal('')),
  })
  .refine(passwordsMatch, passwordsMatchError);

/**
 * Patient signup, for completeness of the union.
 *
 * The doctor/admin SPA does not render it — the patient client is
 * `patient-app/`, with its own form. It is declared here so the shared
 * `RegisterInput` type covers both roles and the SPA cannot accidentally
 * send a shape the server rejects.
 */
export const patientSignupSchema = z
  .object({ ...accountFields, role: z.literal('patient') })
  .refine(passwordsMatch, passwordsMatchError);

export type DoctorSignupValues = z.infer<typeof doctorSignupSchema>;
export type PatientSignupValues = z.infer<typeof patientSignupSchema>;

/**
 * What `SignupPage` resolves against.
 *
 * The SPA registers doctors only, so this is the doctor schema rather
 * than a union — `react-hook-form`'s resolver needs one object shape, and
 * a union would make every field access on the form optional for no gain.
 */
export const signupSchema = doctorSignupSchema;
export type SignupValues = DoctorSignupValues;
