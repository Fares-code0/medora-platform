/**
 * Password policy + strength scoring — platform utility (FRONTEND_ARCHITECTURE
 * §7). Extracted here so every surface that needs it (the auth signup/reset
 * flows and the doctor Account settings) shares ONE source of truth without a
 * cross-feature import. Requirements: 8+ chars with lower, upper, digit, and
 * symbol.
 */

export const PASSWORD_MIN_LENGTH = 8;

export const passwordChecks = {
  length: (v: string) => v.length >= PASSWORD_MIN_LENGTH,
  lower: (v: string) => /[a-z]/.test(v),
  upper: (v: string) => /[A-Z]/.test(v),
  digit: (v: string) => /\d/.test(v),
  symbol: (v: string) => /[^A-Za-z0-9]/.test(v),
} as const;

/** 0 (very weak) … 4 (very strong). */
export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export function scorePassword(password: string): PasswordScore {
  if (!password) return 0;
  const met = [
    passwordChecks.length(password),
    passwordChecks.lower(password),
    passwordChecks.upper(password),
    passwordChecks.digit(password),
    passwordChecks.symbol(password),
  ].filter(Boolean).length;

  if (met <= 2) return 0;
  if (met === 3) return 1;
  if (met === 4) return 2;
  return password.length >= 12 ? 4 : 3;
}

export const PASSWORD_STRENGTH_LABELS: readonly string[] = [
  'Very weak',
  'Weak',
  'Fair',
  'Strong',
  'Very strong',
];
