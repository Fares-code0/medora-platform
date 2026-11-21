import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Alert, CriticalNotice } from '@/components/feedback';
import { Badge, Button } from '@/components/ui';

import { alertDestination, ALERT_SEVERITY_VARIANT } from './overview';
import type { SecurityAlert } from './overview.types';

/**
 * Row 0 (§3.1) — unresolved security alerts, error-toned and undismissable.
 *
 * The failure branch is the point of this component. §3.1 is explicit that a
 * failed security fetch shows a warning rather than an empty slot: an absent
 * banner reads as "nothing is wrong", which is exactly the wrong thing to
 * tell an administrator when the truth is "we could not check".
 */
export interface SecurityAlertsBannerProps {
  alerts: readonly SecurityAlert[];
  isError: boolean;
  onRetry: () => void;
}

export function SecurityAlertsBanner({ alerts, isError, onRetry }: SecurityAlertsBannerProps) {
  if (isError) {
    return (
      <Alert
        variant="warning"
        title="Security status unavailable"
        actions={
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        }
      >
        The platform could not be checked for unresolved security events. This is not a report that
        there are none.
      </Alert>
    );
  }

  if (alerts.length === 0) return null;

  return (
    <CriticalNotice
      icon={ShieldAlert}
      title={`${String(alerts.length)} unresolved security ${alerts.length === 1 ? 'alert' : 'alerts'}`}
    >
      <ul className="flex flex-col divide-y divide-border">
        {alerts.map((alert) => (
          <li key={alert.id} className="flex items-center gap-3 py-2">
            <Badge variant={ALERT_SEVERITY_VARIANT[alert.severity]}>
              {alert.severity === 'critical' ? 'Critical' : 'Warning'}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">{alert.summary}</span>
            {/*
             * A router Link rather than LinkButton: LinkButton is a plain
             * anchor (router-agnostic by design), and an in-app destination
             * reached through one costs a full document load. This is the
             * same inline-action register `SuspensionImpact` uses to link out
             * of an Alert.
             */}
            <Link
              to={alertDestination(alert)}
              aria-label={`Investigate: ${alert.summary}`}
              className="touch-target shrink-0 rounded-control text-caption font-semibold text-primary [--touch-y:14px] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Investigate
            </Link>
          </li>
        ))}
      </ul>
    </CriticalNotice>
  );
}
