import { Alert, CriticalNotice } from '@/components/feedback';
import { Button, LinkButton } from '@/components/ui';

import { CRITICAL_ALERT_PRESENTATION, type CriticalAlert } from '../model/critical-alerts';

/**
 * The Overview's Row 0 (UX §2.1): full width, above everything the doctor
 * composed, and only when there is something to say. It is not a widget —
 * it cannot be left off, collapsed or dismissed (UX §1 principle 4, DS
 * §8.22's critical Alert), and it renders on an empty dashboard too.
 *
 * Two things it can say, and they can both be true:
 *
 * - **The check failed.** Said in the same error variant as an alert,
 *   because silence here reads as "nothing critical" — the server's own
 *   reason for answering 5xx rather than `[]` (`critical-alerts.service.ts`).
 *   Alerts from the last successful check stay listed beneath it.
 * - **There are alerts.** One line each — icon, patient, the server's
 *   summary, when it matters — and one resolving action, whose accessible
 *   name starts with its visible text and then says which alert it is.
 */
export function CriticalAlertsBanner({
  alerts,
  failed,
  retrying,
  onRetry,
}: {
  alerts: readonly CriticalAlert[];
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  if (!failed && alerts.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {failed ? (
        <Alert
          variant="error"
          critical
          title="Couldn't check for critical alerts"
          actions={
            <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>
              Check again
            </Button>
          }
        >
          Unreviewed critical results, critical alerts on today&rsquo;s patients and urgent
          reschedules could not be loaded. Until this check succeeds, look at Labs and today&rsquo;s
          appointments directly.
        </Alert>
      ) : null}
      {alerts.length > 0 ? (
        <CriticalNotice
          title={
            alerts.length === 1
              ? '1 critical alert needs your attention'
              : `${String(alerts.length)} critical alerts need your attention`
          }
        >
          <ul className="flex flex-col divide-y divide-border">
            {alerts.map((alert) => (
              <CriticalAlertRow key={alert.id} alert={alert} />
            ))}
          </ul>
        </CriticalNotice>
      ) : null}
    </div>
  );
}

function CriticalAlertRow({ alert }: { alert: CriticalAlert }) {
  const { icon: Icon, action } = CRITICAL_ALERT_PRESENTATION[alert.kind];
  return (
    <li className="flex items-center gap-3 py-2">
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={1.75} />
      {/* The text keeps a readable width; on a narrow screen the action
          wraps beneath it rather than squeezing it into a column. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 grow basis-56">
          <p className="text-body-sm text-text-primary">
            <span className="font-semibold">{alert.patientName}</span> — {alert.message}
          </p>
          {alert.detail === null ? null : (
            <p className="text-caption text-text-secondary">{alert.detail}</p>
          )}
        </div>
        <LinkButton
          href={alert.href}
          variant="ghost"
          size="sm"
          aria-label={`${action} — ${alert.patientName}: ${alert.message}`}
        >
          {action}
        </LinkButton>
      </div>
    </li>
  );
}
