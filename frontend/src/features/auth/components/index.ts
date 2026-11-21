/**
 * Auth feature components — composed from the design-system library.
 * No design-system primitives are re-implemented here; these are auth-shaped
 * compositions (brand, strength meter, OTP field, timers).
 */
export { AuthCard, type AuthCardProps } from './AuthCard';
export { AuthFooter } from './AuthFooter';
export { AuthFormError, type AuthFormErrorProps } from './AuthFormError';
export { Countdown, type CountdownProps } from './Countdown';
export { LanguageSelector } from './LanguageSelector';
export { OtpInput, type OtpInputProps } from './OtpInput';
export { scorePassword, type StrengthResult } from './password-strength';
// The shared, translated meter (NEW-34) — not a copy of it. The direct path,
// not the patterns barrel, so the auth chunk does not pull in every pattern.
export {
  PasswordStrengthMeter,
  type PasswordStrengthMeterProps,
} from '@/components/patterns/PasswordStrengthMeter';
export { useCountdown, formatCountdown, type Countdown as CountdownState } from './useCountdown';
