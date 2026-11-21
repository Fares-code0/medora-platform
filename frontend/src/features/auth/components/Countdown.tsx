import { formatCountdown } from './useCountdown';

/**
 * Countdown display — renders a labelled "M:SS" line for resend gates.
 * Pair with `useCountdown` in the host page; kept presentational so the timer
 * state stays owned by the page.
 */
export interface CountdownProps {
  label: string;
  seconds: number;
}

export function Countdown({ label, seconds }: CountdownProps) {
  return (
    <p className="text-body-sm text-text-tertiary" aria-live="polite">
      {label}{' '}
      <span className="font-medium tabular-nums text-text-secondary">
        {formatCountdown(seconds)}
      </span>
    </p>
  );
}
