import { scorePassword as score, type PasswordScore } from '@/utils/password';

/**
 * Password strength scoring for the auth surface — thin wrapper over the
 * platform `@/utils/password` util so the auth flows and the doctor Account
 * settings can't drift. Kept separate from the meter component so the
 * component file exports only a component (fast-refresh friendly).
 */

export interface StrengthResult {
  /** 0 (very weak) … 4 (very strong). */
  score: PasswordScore;
}

export function scorePassword(password: string): StrengthResult {
  return { score: score(password) };
}
