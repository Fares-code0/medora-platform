import { z } from 'zod';

import { PASSWORD_MIN_LENGTH, passwordChecks } from '@/utils/password';

/**
 * Settings form schemas (RHF + Zod). The password rule is composed from the
 * platform `@/utils/password` policy — the same checks the auth signup/reset
 * flows use — so "change password" enforces identical rules without a
 * cross-feature import.
 */

const strongPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${String(PASSWORD_MIN_LENGTH)} characters`)
  .refine(passwordChecks.lower, 'Add a lowercase letter')
  .refine(passwordChecks.upper, 'Add an uppercase letter')
  .refine(passwordChecks.digit, 'Add a number')
  .refine(passwordChecks.symbol, 'Add a symbol');

export const profileSchema = z.object({
  photo: z.string().nullable(),
  languages: z.array(z.string()).max(8, 'Up to 8 languages'),
  fullName: z.string().trim().min(2, 'Enter your full name').max(80),
  title: z.string().trim().max(60).optional().or(z.literal('')),
  specialty: z.string().trim().min(2, 'Enter your specialty').max(60),
  licenseNumber: z.string().trim().min(3, 'Enter your license number').max(40),
  employeeId: z.string().trim().max(40).optional().or(z.literal('')),
  department: z.string().trim().max(60).optional().or(z.literal('')),
  hospital: z.string().trim().max(80).optional().or(z.literal('')),
  yearsOfExperience: z.coerce
    .number({ invalid_type_error: 'Enter a number' })
    .int('Whole years only')
    .min(0, 'Cannot be negative')
    .max(70, 'That seems too high'),
  biography: z
    .string()
    .trim()
    .max(600, 'Keep it under 600 characters')
    .optional()
    .or(z.literal('')),
  education: z.array(z.string()).max(8, 'Up to 8 entries'),
  certifications: z.array(z.string()).max(8, 'Up to 8 entries'),
  skills: z.array(z.string()).max(12, 'Up to 12 skills'),
  linkedinUrl: z.string().trim().url('Enter a full URL (https://…)').optional().or(z.literal('')),
  websiteUrl: z.string().trim().url('Enter a full URL (https://…)').optional().or(z.literal('')),
  emergencyContactName: z.string().trim().max(80).optional().or(z.literal('')),
  emergencyContactPhone: z.string().trim().max(30).optional().or(z.literal('')),
  contactEmail: z.string().trim().email('Enter a valid email'),
  contactPhone: z.string().trim().min(7, 'Enter a valid phone number').max(30),
  officeLocation: z.string().trim().max(80).optional().or(z.literal('')),
  officeHours: z.string().trim().max(80).optional().or(z.literal('')),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

export const accountSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  username: z
    .string()
    .trim()
    .min(3, 'At least 3 characters')
    .max(30)
    .regex(/^[a-z0-9._-]+$/i, 'Letters, numbers, dots, dashes only'),
  phone: z.string().trim().min(7, 'Enter a valid phone number').max(30),
});

export type AccountFormValues = z.infer<typeof accountSchema>;

export const passwordSchema = z
  .object({
    current: z.string().min(1, 'Enter your current password'),
    next: strongPassword,
    confirm: z.string().min(1, 'Re-enter your new password'),
  })
  .refine((values) => values.next === values.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })
  .refine((values) => values.next !== values.current, {
    message: 'Choose a password different from your current one',
    path: ['next'],
  });

export type PasswordFormValues = z.infer<typeof passwordSchema>;
