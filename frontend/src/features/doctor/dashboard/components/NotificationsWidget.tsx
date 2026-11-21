import { DashboardWidget, StatusBadge } from '@/components/patterns';
import { LinkButton, type MenuEntry } from '@/components/ui';
import { routes } from '@/routes';

import type { OverviewNotification } from '../model/mock-data';

/**
 * Notifications widget (placeholder) — recent items needing attention,
 * status-coded per the P8 vocabulary. The full feed with filters, read
 * state, and real-time arrivals is UX 2.9 (Phase 7).
 */
export function NotificationsWidget({
  items,
  loading = false,
  error,
  menu,
  className,
}: {
  items: readonly OverviewNotification[];
  loading?: boolean;
  error?: { readonly onRetry?: () => void } | undefined;
  /** The widget's ⋯ menu, from the Overview's widget grid. */
  menu?: readonly MenuEntry[] | undefined;
  className?: string | undefined;
}) {
  return (
    <DashboardWidget
      title="Notifications"
      menu={menu}
      className={className}
      loading={loading}
      error={error}
      empty={
        items.length === 0 ? (
          <p className="text-body-sm text-text-secondary">Nothing needs your attention.</p>
        ) : undefined
      }
      actions={
        <LinkButton href={routes.doctor.notifications} variant="ghost" size="sm">
          View all
        </LinkButton>
      }
    >
      <ul className="flex flex-col divide-y divide-border">
        {items.map((notification) => (
          <li key={notification.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <StatusBadge
              status={notification.status}
              label={notification.statusLabel}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              {notification.href === undefined ? (
                <p className="text-body-sm text-text-primary">{notification.text}</p>
              ) : (
                <a
                  href={notification.href}
                  className="text-body-sm text-text-primary hover:underline"
                >
                  {notification.text}
                </a>
              )}
              <p className="mt-0.5 text-caption text-text-tertiary">{notification.time}</p>
            </div>
          </li>
        ))}
      </ul>
    </DashboardWidget>
  );
}
