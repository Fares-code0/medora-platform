import { cn } from '@/utils/cn';

/**
 * Progress — DS §8.24.
 * Linear bar (8px, 4px slim) and circular ring (16/24/48). Omitting
 * `value` renders the indeterminate variant (1.2s sweep / rotation).
 * Prefer determinate whenever the total is knowable. Spinners and sweeps
 * keep animating under reduced motion — progress indication is functional.
 */
export interface ProgressProps {
  /** 0–100; omit for indeterminate. */
  value?: number | undefined;
  label?: string | undefined;
  /** Show the percentage next to the label (determinate only). */
  showValue?: boolean;
  slim?: boolean;
  'aria-label'?: string | undefined;
  className?: string;
}

export function Progress({
  value,
  label,
  showValue = false,
  slim = false,
  'aria-label': ariaLabel,
  className,
}: ProgressProps) {
  const clamped = value === undefined ? undefined : Math.min(100, Math.max(0, value));
  return (
    <div className={cn('w-full', className)}>
      {label !== undefined || (showValue && clamped !== undefined) ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label !== undefined ? (
            <span className="text-body-sm font-medium text-text-secondary">{label}</span>
          ) : (
            <span />
          )}
          {showValue && clamped !== undefined ? (
            <span className="text-caption text-text-tertiary tabular-nums">
              {Math.round(clamped)}%
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-label={label ?? ariaLabel}
        className={cn('w-full overflow-hidden rounded-pill bg-border', slim ? 'h-1' : 'h-2')}
      >
        {clamped !== undefined ? (
          <div
            className="h-full rounded-pill bg-primary transition-[width] duration-moderate ease-out"
            style={{ width: `${String(clamped)}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-progress-sweep rounded-pill bg-primary" />
        )}
      </div>
    </div>
  );
}

/** Circular progress — uploads and AI processing (DS §8.24). */
export interface CircularProgressProps {
  /** 0–100; omit for indeterminate rotation. */
  value?: number | undefined;
  size?: 16 | 24 | 48;
  'aria-label': string;
  className?: string;
}

export function CircularProgress({
  value,
  size = 24,
  'aria-label': ariaLabel,
  className,
}: CircularProgressProps) {
  const clamped = value === undefined ? undefined : Math.min(100, Math.max(0, value));
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = clamped === undefined ? circumference * 0.75 : circumference * (1 - clamped / 100);

  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={ariaLabel}
      className={cn('inline-flex', className)}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        className={cn(clamped === undefined && 'animate-spin')}
        style={clamped === undefined ? { animationDuration: '0.8s' } : undefined}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${String(size / 2)} ${String(size / 2)})`}
          className="stroke-primary transition-[stroke-dashoffset] duration-moderate ease-out"
        />
      </svg>
    </span>
  );
}
