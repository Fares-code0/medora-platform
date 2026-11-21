import {
  Archive,
  Ban,
  CalendarCheck,
  CalendarClock,
  CheckCheck,
  CircleCheck,
  CircleDot,
  Clock,
  Hourglass,
  Info,
  Sparkles,
  SquareCheck,
  UserRoundX,
  type LucideIcon,
} from 'lucide-react';

import { Badge, type BadgeEmphasis, type BadgeVariant } from '@/components/ui/Badge';
import { cn } from '@/utils/cn';

/**
 * StatusBadge — UX P8 status vocabulary.
 * One platform-wide status→color mapping (from DS §8.8):
 * Confirmed/Active/Normal = success · Pending/Awaiting/Expiring = warning ·
 * Cancelled/Rejected/Critical = error · Scheduled/Info = info ·
 * Completed/Archived = neutral · AI-generated = accent violet.
 * No feature may invent a new color-status pairing — extend this map via
 * DS governance instead. Status is always dot/icon + text, never color alone.
 */
export type StatusKind =
  | 'confirmed'
  | 'active'
  | 'normal'
  | 'pending'
  | 'awaiting'
  | 'expiring'
  | 'cancelled'
  | 'rejected'
  | 'critical'
  | 'scheduled'
  | 'info'
  | 'completed'
  | 'archived'
  | 'ai';

/**
 * The full visual encoding of a status kind — ADR-0001 §12.
 *
 * Three channels, applied in this order of preference:
 *   hue      — the semantic family (alarm / caution / settled / …)
 *   emphasis — filled = live/actionable, outline = terminal/settled
 *   glyph    — only where hue+emphasis leaves two CO-OCCURRING kinds identical
 *
 * The glyph is deliberately sparse. It is not decoration and not a per-kind
 * icon set: it is spent only on the four pairs that actually collide in a
 * shared visual context, because every glyph costs ~16px in columns Wave 1
 * fought to compress. Kinds that never co-occur are allowed to share a
 * treatment — global uniqueness across all fourteen is NOT the goal, and
 * buying it would add chrome to the two most common badges on the platform
 * for no scanning benefit.
 */
export interface StatusPresentation {
  readonly variant: BadgeVariant;
  readonly emphasis: BadgeEmphasis;
  readonly icon?: LucideIcon;
}

export const STATUS_PRESENTATION: Record<StatusKind, StatusPresentation> = {
  /* success — live commitments, then the settled baseline. */
  confirmed: { variant: 'success', emphasis: 'filled' },
  active: { variant: 'success', emphasis: 'filled' },
  normal: { variant: 'success', emphasis: 'outline' },

  /*
   * warning — `pending` and `expiring` are both live and both amber, and
   * they co-occur twice (appointments Status ∥ Priority, and the refill
   * column, where Due and Pending sit in one list).
   *
   * Only `pending` is glyphed, and the asymmetry is deliberate. `expiring`
   * is overloaded: eight domain maps reach for it as the generic mid
   * severity — High priority, Urgent, Moderate, Important, Medium risk —
   * and only ONE (refill Due) means literal time expiry. An AlarmClock
   * would therefore be wrong at seven sites out of eight. Clock-vs-dot
   * still separates the pair, and the real repair is a severity kind that
   * is not borrowed from the expiry vocabulary (see DEBT-2b-01).
   *
   * `awaiting` is blocked on someone else, which is settled from our side,
   * so it takes the otherwise-empty warning-outline slot and needs no glyph.
   */
  pending: { variant: 'warning', emphasis: 'filled', icon: Clock },
  awaiting: { variant: 'warning', emphasis: 'outline' },
  expiring: { variant: 'warning', emphasis: 'filled' },

  /*
   * error — emphasis separates the live alarm from the two terminal
   * outcomes, but not those two from each other: Cancelled and No-show are
   * both terminal and sit in the same column. Glyph carries the difference,
   * and it is a real one — a cancellation is a decision, a no-show is a
   * patient who did not arrive.
   */
  critical: { variant: 'error', emphasis: 'filled' },
  cancelled: { variant: 'error', emphasis: 'outline', icon: Ban },
  rejected: { variant: 'error', emphasis: 'outline', icon: UserRoundX },

  /* info — live future-dated vs descriptive. */
  scheduled: { variant: 'info', emphasis: 'filled' },
  info: { variant: 'info', emphasis: 'outline' },

  /*
   * neutral — both terminal, so emphasis cannot separate them, and
   * `completed` was NOT moved to filled to force uniqueness: finished is
   * finished, and painting it as live to win a collision would trade a
   * correct meaning for a tidy table. Glyph does the work instead.
   */
  completed: { variant: 'neutral', emphasis: 'outline', icon: CheckCheck },
  archived: { variant: 'neutral', emphasis: 'outline', icon: Archive },

  /* Provenance, orthogonal to lifecycle. Filled is not a claim about state. */
  ai: { variant: 'ai', emphasis: 'filled', icon: Sparkles },
};

/** Hue only. Retained for callers that colour a non-Badge surface from a kind. */
export const STATUS_VARIANTS: Record<StatusKind, BadgeVariant> = Object.fromEntries(
  Object.entries(STATUS_PRESENTATION).map(([kind, p]) => [kind, p.variant]),
) as Record<StatusKind, BadgeVariant>;

export interface StatusBadgeProps {
  status: StatusKind;
  /** Display text, e.g. "Confirmed", "Awaiting patient". */
  label: string;
  className?: string;
}

/**
 * The quiet presentation (PR 4): a monochrome glyph and the label in
 * secondary text — no pill, no tint. Each kind keeps its own glyph, so the
 * status stays distinguishable without leaning on colour (DS §1.3).
 * `STATUS_PRESENTATION` above still records each kind's semantic hue for
 * callers that colour other surfaces from it.
 */
const QUIET_ICON: Record<Exclude<StatusKind, 'critical' | 'ai'>, LucideIcon> = {
  confirmed: CircleCheck,
  active: CircleDot,
  normal: SquareCheck,
  pending: Clock,
  awaiting: Hourglass,
  expiring: CalendarClock,
  cancelled: Ban,
  rejected: UserRoundX,
  scheduled: CalendarCheck,
  info: Info,
  completed: CheckCheck,
  archived: Archive,
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  /*
   * Two kinds keep their badge. `critical` is a clinical severity: its red
   * is the signal, and it must not be quietened. `ai` is provenance, not a
   * state, and carries the AI components' own colours (ADR-0005 §8).
   */
  if (status !== 'critical' && status !== 'ai') {
    const Glyph = QUIET_ICON[status];
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap text-caption font-medium text-text-secondary',
          className,
        )}
      >
        <Glyph aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-tertiary" strokeWidth={1.75} />
        {label}
      </span>
    );
  }
  const { variant, emphasis, icon } = STATUS_PRESENTATION[status];
  /*
   * Glyph replaces the dot rather than joining it. The dot is `bg-current`,
   * so it repeats the hue and adds nothing a reader can decode — which is
   * how DS §1.3's "never colour alone" was satisfied on paper while every
   * status badge stayed colour-plus-text in practice.
   */
  if (icon) {
    return (
      <Badge variant={variant} emphasis={emphasis} icon={icon} className={className}>
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant={variant} emphasis={emphasis} dot className={className}>
      {label}
    </Badge>
  );
}
