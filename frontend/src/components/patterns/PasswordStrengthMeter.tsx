import { useMemo } from 'react';

import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { scorePassword } from '@/utils/password';

/**
 * Password strength meter — four-segment bar + label, built entirely from
 * design tokens so it stays theme-aware. Scoring comes from the platform
 * `@/utils/password` util (shared with the auth flows). Renders nothing
 * while the field is empty.
 *
 * **One meter, translated (NEW-34).** The auth pages and Settings → Account
 * each used to carry their own copy: the auth one read its label from the
 * catalogue, this one wrote it in English, so a doctor changing a password
 * in Arabic was told "Password strength: Fair". Both now render this file.
 */

// Tier → segment fill token. Two lowest tiers read as error, mid as warning,
// top two as success.
const TIER_COLOR = ['bg-error', 'bg-error', 'bg-warning', 'bg-success', 'bg-success'] as const;
const STRENGTH_KEY = [
  'strength.0',
  'strength.1',
  'strength.2',
  'strength.3',
  'strength.4',
] as const;

export interface PasswordStrengthMeterProps {
  password: string;
  id?: string | undefined;
}

export function PasswordStrengthMeter({ password, id }: PasswordStrengthMeterProps) {
  const t = useT();
  const score = useMemo(() => scorePassword(password), [password]);

  if (!password) return null;

  const bars = 4;
  const activeBars = Math.min(bars, score + 1);

  return (
    <div className="mt-2" id={id}>
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: bars }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-pill transition-colors duration-base',
              i < activeBars ? TIER_COLOR[score] : 'bg-border',
            )}
          />
        ))}
      </div>
      <p className="mt-1.5 text-caption text-text-tertiary" aria-live="polite">
        {t('strength.label')}: <span className="font-medium">{t(STRENGTH_KEY[score])}</span>
      </p>
    </div>
  );
}
