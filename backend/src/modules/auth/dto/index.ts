/**
 * Request shapes for the auth module (RM M6).
 *
 * Zod rather than class-validator, because the frontend's schemas are
 * Zod and these are transcriptions of them (see each file's header).
 * Controllers apply them with `@Body(zodBody(schema))`, which turns a
 * failure into the 422 + `fieldErrors` shape API §0.3 fixes.
 */
export {
  loginSchema,
  type LoginInput,
  otpRecoverySchema,
  type OtpRecoveryInput,
  otpResendSchema,
  type OtpResendInput,
  otpVerifySchema,
  type OtpVerifyInput,
} from './login.schema';
export {
  changePasswordSchema,
  type ChangePasswordInput,
  forgotPasswordSchema,
  type ForgotPasswordInput,
  resendVerificationSchema,
  type ResendVerificationInput,
  resetPasswordSchema,
  type ResetPasswordInput,
  verifyEmailSchema,
  type VerifyEmailInput,
  verifyPasswordSchema,
  type VerifyPasswordInput,
} from './recovery.schema';
export {
  PROFESSIONAL_CATEGORIES,
  doctorRegisterSchema,
  patientRegisterSchema,
  registerSchema,
  type DoctorRegisterInput,
  type PatientRegisterInput,
  type ProfessionalCategory,
  type RegisterInput,
} from './register.schema';
export {
  INVITABLE_ROLES,
  acceptAdminInvitationSchema,
  activateAdminInvitationSchema,
  createAdminInvitationSchema,
  type AcceptAdminInvitationInput,
  type ActivateAdminInvitationInput,
  type CreateAdminInvitationInput,
  type InvitableRole,
} from './admin-invitation.schema';
export {
  disableTwoFactorSchema,
  type DisableTwoFactorInput,
  enableTwoFactorSchema,
  type EnableTwoFactorInput,
  setupTwoFactorSchema,
  type SetupTwoFactorInput,
} from './two-factor.schema';
export {
  PASSWORD_MIN_LENGTH,
  passwordChecks,
  passwordPolicyErrors,
  strongPassword,
} from './password.schema';
